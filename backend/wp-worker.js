import dotenv from "dotenv";
dotenv.config();

import db from "./db.js";
import { sleep, log } from "./utils.js";
import { publishWordPress } from "./services/wordpress.js";
import { translateText } from "./services/translate.js";
import { uploadImageToWordPress } from './services/wpMedia.js';


const POLL_MS = 5000;
const BATCH_SIZE = 3;
const WORKER_ID = `wp-worker-${Math.floor(Math.random() * 10000)}`;

function nowStr() {
  return new Date().toISOString();
}



async function claimAndProcessWpBatch() {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `
      SELECT * FROM wp_posts
      WHERE status = 'scheduled'
        AND scheduled_at <= NOW()
      ORDER BY scheduled_at ASC
      LIMIT ?
      FOR UPDATE
      `,
      [BATCH_SIZE]
    );

    if (!rows.length) {
      await conn.commit();
      return 0;
    }

    const ids = rows.map(r => r.id);

    await conn.query(
      `
      UPDATE wp_posts
      SET status = 'processing', updated_at = NOW()
      WHERE id IN (?)
      `,
      [ids]
    );

    await conn.commit();

    for (const post of rows) {
      await processWpPost(post);
    }

    return rows.length;

  } catch (err) {
    await conn.rollback();
    log("❌ WP Worker claim error", err);
    return 0;
  } finally {
    conn.release();
  }
}



// async function processWpPost(post) {
//   try {
//     log(nowStr(), WORKER_ID, "Publishing WP post", post.id);

//     const [sites] = await db.query(
//       "SELECT * FROM wordpress_sites WHERE client_id = ?",
//       [post.client_id]
//     );

//     if (!sites.length) {
//       throw new Error("No WordPress sites connected for client");
//     }

//     for (const wp of sites) {
//       const siteUrl =
//         wp.site_path
//           ? `${wp.site_url.replace(/\/$/, "")}${wp.site_path}`
//           : wp.site_url.replace(/\/$/, "");

//       let title = post.title;
//       let content = post.content;
//       let excerpt = post.excerpt || "";

//       // 🌐 Single translation call
//       if (wp.language !== "English") {
//         const translated = await translateText({
//           payload: { title, content, excerpt },
//           language: wp.language
//         });

//         title = translated.title;
//         content = translated.content;
//         excerpt = translated.excerpt;
//       }

//       let categories = [];

//       if (post.master_category_id) {
//         const [mapping] = await db.query(
//           `
//     SELECT wp_category_id
//     FROM site_category_mapping
//     WHERE master_category_id = ?
//       AND site_id = ?
//     `,
//           [post.master_category_id, wp.id]
//         );

//         if (mapping.length) {
//           categories = [mapping[0].wp_category_id];
//         }
//       }


//       log(
//         "📤 Publishing to",
//         wp.language,
//         "→",
//         siteUrl,
//         "media:",
//         wp.default_media_id || "none"
//       );

//       const result = await publishWordPress({
//         site_url: siteUrl,
//         username: wp.username,
//         app_password: wp.app_password,
//         title,
//         content,
//         excerpt,
//         status: "future",
//         scheduled_at: post.scheduled_at,
//         featured_media_id: wp.default_media_id,
//         categories   // 👈 ADD THIS
//       });

//       if (!result.success) {
//         throw new Error(`Failed on ${wp.language}`);
//       }

//       log("✅ Published", wp.language, "→", result.url);
//     }

//     await db.query(
//       `UPDATE wp_posts
//        SET status='published',
//            updated_at=NOW()
//        WHERE id=?`,
//       [post.id]
//     );

//   } catch (err) {
//     await db.query(
//       `
//       UPDATE wp_posts
//       SET status='failed',
//           error_message=?,
//           updated_at=NOW()
//       WHERE id=?
//       `,
//       [err.message?.substring(0, 2000), post.id]
//     );

//     log("❌ WP multisite publish failed:", post.id, err.message);
//   }
// }


async function processWpPost(post) {
  try {
    log(nowStr(), WORKER_ID, "🚀 Publishing WP post", post.id);

    // 🔹 Fetch all WordPress sites for client
    const [sites] = await db.query(
      "SELECT * FROM wordpress_sites WHERE client_id = ?",
      [post.client_id]
    );

    if (!sites.length) {
      throw new Error("No WordPress sites connected for client");
    }

    // 🔁 Loop through each site
    for (const wp of sites) {

      const siteUrl = wp.site_path
        ? `${wp.site_url.replace(/\/$/, "")}${wp.site_path}`
        : wp.site_url.replace(/\/$/, "");


      // 2. Build credentials ← MUST be here before tags
      const credentials = Buffer.from(
        `${wp.username}:${wp.app_password}`
      ).toString("base64");

      let title = post.title;
      let content = post.content;
      let excerpt = post.excerpt || "";

      // =====================================================
      // 🌐 TRANSLATION
      // =====================================================
      if (wp.language && wp.language !== "English") {
        log("🌍 Translating for", wp.language);

        try {
          const translated = await translateText({
            payload: { title, content, excerpt },
            language: wp.language
          });

          if (translated) {
            title = translated.title || title;
            content = translated.content || content;
            excerpt = translated.excerpt || excerpt;
          }

        } catch (translationError) {
          log("⚠ Translation failed for", wp.language, translationError.message);
          throw new Error(`Translation failed for ${wp.language}`);
        }
      }

      // =====================================================
      // 📂 CATEGORY RESOLUTION (Master → Site Mapping)
      // =====================================================
      let categories = [];

      if (post.master_category_id) {

        const [mappingRows] = await db.query(
          `
          SELECT wp_category_id
          FROM site_category_mapping
          WHERE master_category_id = ?
            AND site_id = ?
          `,
          [post.master_category_id, wp.id]
        );

        if (mappingRows.length) {
          categories = mappingRows.map(r => r.wp_category_id);
        } else {
          log(
            "⚠ No category mapping found for site:",
            wp.id,
            "master_category:",
            post.master_category_id
          );
        }
      }



      let tagIds = [];
if (post.tags && post.tags.trim()) {
  const tagNames = post.tags.split(",").map(t => t.trim()).filter(Boolean);

  for (const tagName of tagNames) {
    try {
      const searchRes = await fetch(
        `${siteUrl}/wp-json/wp/v2/tags?search=${encodeURIComponent(tagName)}&per_page=5`,
        { headers: { Authorization: `Basic ${credentials}` } }  // ← add credentials variable before this
      );
      const existing = await searchRes.json();
      const match = existing.find(
        t => t.name.toLowerCase() === tagName.toLowerCase()
      );

      if (match) {
        tagIds.push(match.id);
      } else {
        const createRes = await fetch(`${siteUrl}/wp-json/wp/v2/tags`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: tagName }),
        });
        const newTag = await createRes.json();
        if (newTag.id) tagIds.push(newTag.id);
      }
    } catch (tagErr) {
      log(`⚠ Tag error for "${tagName}":`, tagErr.message);
    }
  }
}


      // =====================================================
      // 📤 PUBLISH
      // =====================================================
      log(
        "📤 Publishing to",
        wp.language,
        "→",
        siteUrl,
        "categories:",
        categories.length ? categories : "none",
        "media:",
        wp.default_media_id || "none"
      );


      // Upload custom image if provided, otherwise fall back to site default
      let featured_media_id = wp.default_media_id || 0;

      if (post.featured_image_url) {
          log('🖼 Uploading custom image for post', post.id, '→', wp.language);
         const uploadedId = await uploadImageToWordPress(
         siteUrl,
         wp.username,
         wp.app_password,
         post.featured_image_url
       );
       if (uploadedId) {
        featured_media_id = uploadedId;
        log('✅ Custom image uploaded, media_id:', uploadedId);
       } else {
        log('⚠ Custom image upload failed, using site default');
       }
}

const result = await publishWordPress({
  site_url: siteUrl,
  username: wp.username,
  app_password: wp.app_password,
  title,
  content,
  excerpt,
  status: "future",
  scheduled_at: post.scheduled_at,
  featured_media_id,
  categories,
  slug: post.slug || undefined,   // ← ADD
  tags: tagIds.length > 0 ? tagIds : undefined,  // ← ADD
});



      if (!result.success) {
        throw new Error(
          `Publish failed on ${wp.language}: ${JSON.stringify(result.error)}`
        );
      }

      // ✅ Save translation to DB
      await db.query(
        `INSERT INTO wp_post_translations
     (wp_post_id, site_id, language, title, content, excerpt, external_post_id, wp_url, status)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published')
   ON DUPLICATE KEY UPDATE
     wp_url = VALUES(wp_url),
     external_post_id = VALUES(external_post_id),
     status = 'published'`,
        [
          post.id,
          wp.id,
          wp.language,
          title,
          content,
          excerpt,
          result.external_post_id,
          result.url
        ]
      );

      log("✅ Published", wp.language, "→", result.url);
    }

    // =====================================================
    // ✅ MARK POST AS PUBLISHED
    // =====================================================
    await db.query(
      `
      UPDATE wp_posts
      SET status='published',
          updated_at=NOW()
      WHERE id=?
      `,
      [post.id]
    );

    log("🎉 WP Post published successfully:", post.id);

  } catch (err) {

    await db.query(
      `
      UPDATE wp_posts
      SET status='failed',
          error_message=?,
          updated_at=NOW()
      WHERE id=?
      `,
      [err.message?.substring(0, 2000), post.id]
    );

    log("❌ WP multisite publish failed:", post.id, err.message);
  }
}






async function runWpWorker() {
  log("🚀 WordPress Worker started", WORKER_ID);

  while (true) {
    try {
      const processed = await claimAndProcessWpBatch();
      if (processed === 0) {
        await sleep(POLL_MS);
      } else {
        await sleep(1000);
      }
    } catch (err) {
      log("❌ WP Worker loop error", err);
      await sleep(POLL_MS);
    }
  }
}

runWpWorker();


// import dotenv from "dotenv";
// dotenv.config();

// import db from "./db.js";
// import pLimit from "p-limit";
// import { sleep, log } from "./utils.js";
// import { publishWordPress } from "./services/wordpress.js";
// import { translateBatch } from "./services/translate.js";

// const POLL_MS = 5000;
// const POST_CONCURRENCY = 5;     // Posts processed in parallel
// const SITE_CONCURRENCY = 4;     // Sites per post in parallel
// const CLAIM_LIMIT = 10;         // Rows claimed per poll
// const MAX_RETRIES = 5;

// const WORKER_ID = `wp-worker-${Math.floor(Math.random() * 10000)}`;

// const postLimit = pLimit(POST_CONCURRENCY);

// /* -------------------------------------------------- */
// /* 🧠 Claim posts atomically (multi-worker safe)      */
// /* -------------------------------------------------- */

// async function claimPosts(limit = CLAIM_LIMIT) {
//   const conn = await db.getConnection();

//   try {
//     await conn.beginTransaction();

//     await conn.query(
//       `
//       UPDATE wp_posts
//       SET status='processing',
//           worker_id=?,
//           locked_at=NOW()
//       WHERE status='scheduled'
//         AND scheduled_at <= NOW()
//       ORDER BY scheduled_at ASC
//       LIMIT ?
//       `,
//       [WORKER_ID, limit]
//     );

//     const [rows] = await conn.query(
//       `
//       SELECT * FROM wp_posts
//       WHERE worker_id=? AND status='processing'
//       `,
//       [WORKER_ID]
//     );

//     await conn.commit();
//     return rows;

//   } catch (err) {
//     await conn.rollback();
//     log("❌ Claim error:", err);
//     return [];
//   } finally {
//     conn.release();
//   }
// }

// /* -------------------------------------------------- */
// /* 🚀 Process single post                            */
// /* -------------------------------------------------- */

// async function processWpPost(post) {

//   const siteLimit = pLimit(SITE_CONCURRENCY);

//   try {

//     log("📦 Processing post:", post.id);

//     const [sites] = await db.query(
//       "SELECT * FROM wordpress_sites WHERE client_id = ?",
//       [post.client_id]
//     );

//     if (!sites.length) {
//       throw new Error("No WordPress sites configured");
//     }

//     /* ------------------------------
//        🧠 Extract unique languages
//     --------------------------------*/

//     const languages = [
//       ...new Set(
//         sites
//           .map(s => s.language)
//           .filter(l => l && l !== "English")
//       )
//     ];

//     /* ------------------------------
//        🌍 Single translation call
//     --------------------------------*/

//     let translations = {};

//     if (languages.length > 0) {
//       translations = await translateBatch({
//         payload: {
//           title: post.title,
//           content: post.content,
//           excerpt: post.excerpt || ""
//         },
//         languages
//       });
//     }

//     log(`translations: ${translations}`)

//     /* ------------------------------
//        🚀 Publish in parallel
//     --------------------------------*/

//     const publishResults = await Promise.allSettled(
//       sites.map(site =>
//         siteLimit(async () => {

//           const article =
//             site.language === "English"
//               ? {
//                   title: post.title,
//                   content: post.content,
//                   excerpt: post.excerpt || ""
//                 }
//               : translations[site.language] || {
//                   title: post.title,
//                   content: post.content,
//                   excerpt: post.excerpt || ""
//                 };

//           const result = await publishWordPress({
//             site_url: `${site.site_url.replace(/\/$/, "")}${site.site_path || ""}`,
//             username: site.username,
//             app_password: site.app_password,
//             title: article.title,
//             content: article.content,
//             excerpt: article.excerpt,
//             status: "future",
//             scheduled_at: post.scheduled_at,
//             featured_media_id: site.default_media_id
//           });

//           if (!result.success) {
//             throw new Error(`${site.language} failed`);
//           }

//           log("✅ Published:", site.language, result.url);

//           return {
//             language: site.language,
//             url: result.url,
//             external_post_id: result.external_post_id
//           };
//         })
//       )
//     );

//     /* ------------------------------
//        ❌ Check failures
//     --------------------------------*/

//     const failed = publishResults.filter(r => r.status === "rejected");

//     if (failed.length > 0) {
//       throw new Error(`${failed.length} site(s) failed`);
//     }

//     /* ------------------------------
//        ✅ Mark success
//     --------------------------------*/

//     await db.query(
//       `
//       UPDATE wp_posts
//       SET status='published',
//           worker_id=NULL,
//           locked_at=NULL,
//           updated_at=NOW()
//       WHERE id=?
//       `,
//       [post.id]
//     );

//     log("🎉 Post fully published:", post.id);

//   } catch (err) {

//     log("❌ Post failed:", post.id, err.message);

//     await db.query(
//       `
//       UPDATE wp_posts
//       SET status = CASE
//                      WHEN retry_count + 1 >= ?
//                      THEN 'failed'
//                      ELSE 'scheduled'
//                    END,
//           retry_count = retry_count + 1,
//           worker_id = NULL,
//           locked_at = NULL,
//           error_message = ?,
//           updated_at = NOW()
//       WHERE id = ?
//       `,
//       [
//         MAX_RETRIES,
//         err.message.substring(0, 2000),
//         post.id
//       ]
//     );
//   }
// }

// /* -------------------------------------------------- */
// /* 🔄 Lock recovery (crash-safe)                     */
// /* -------------------------------------------------- */

// async function recoverStaleLocks() {
//   await db.query(
//     `
//     UPDATE wp_posts
//     SET status='scheduled',
//         worker_id=NULL,
//         locked_at=NULL
//     WHERE status='processing'
//       AND locked_at < NOW() - INTERVAL 10 MINUTE
//     `
//   );
// }

// /* -------------------------------------------------- */
// /* 🔁 Main worker loop                               */
// /* -------------------------------------------------- */

// async function runWpWorker() {

//   log("🚀 High-Concurrency WP Worker started:", WORKER_ID);

//   while (true) {

//     try {

//       await recoverStaleLocks();

//       const posts = await claimPosts();

//       if (!posts.length) {
//         await sleep(POLL_MS);
//         continue;
//       }

//       await Promise.allSettled(
//         posts.map(post =>
//           postLimit(() => processWpPost(post))
//         )
//       );

//     } catch (err) {
//       log("❌ Worker loop error:", err);
//       await sleep(POLL_MS);
//     }
//   }
// }

// runWpWorker();

