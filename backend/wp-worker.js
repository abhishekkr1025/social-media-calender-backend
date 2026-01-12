import dotenv from "dotenv";
dotenv.config();

import db from "./db.js";
import { sleep, log } from "./utils.js";
import { publishWordPress } from "./services/wordpress.js";
import { translateText } from "./services/translate.js";


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

async function processWpPost(post) {
  try {
    log(nowStr(), WORKER_ID, "Publishing WP post", post.id);

    // 🔹 Load ALL WordPress sites for client
    const [sites] = await db.query(
      "SELECT * FROM wordpress_accounts WHERE client_id = ?",
      [post.client_id]
    );

    if (!sites.length) {
      throw new Error("No WordPress sites connected for client");
    }

    for (const wp of sites) {
      const siteUrl = `${wp.site_url}${wp.site_path}`;

      let title = post.title;
      let content = post.content;
      let excerpt = post.excerpt;

      // 🌐 Translate per site language
      if (wp.language !== "English") {
        title = await translateText({ text: title, language: wp.language });
        content = await translateText({ text: content, language: wp.language });
        excerpt = excerpt
          ? await translateText({ text: excerpt, language: wp.language })
          : "";
      }

      const result = await publishWordPress({
        site_url: siteUrl,
        username: wp.username,
        app_password: wp.app_password,
        title,
        content,
        excerpt,
        status: "future",
        scheduled_at: post.scheduled_at
      });

      if (!result.success) {
        throw new Error(
          `Failed on ${wp.language}: ${JSON.stringify(result.error)}`
        );
      }

      log(
        "✅ Published",
        wp.language,
        "→",
        result.url
      );
    }

    // ✅ Mark main post as published only AFTER all sites succeed
    await db.query(
      `UPDATE wp_posts
       SET status='published',
           updated_at=NOW()
       WHERE id=?`,
      [post.id]
    );

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
