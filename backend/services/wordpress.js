import axios from "axios";
import FormData from "form-data";
import { translateText } from "./translate.js";

// /**
//  * Upload featured image to WordPress Media Library
//  */
// async function uploadFeaturedImage({ site_url, username, app_password, file }) {
//   const formData = new FormData();
//   formData.append("file", file.buffer, file.originalname);

//   const mediaUrl = `${site_url}/wp-json/wp/v2/media`
//   console.log("media url: ", mediaUrl)

//   const res = await axios.post(
//     mediaUrl,
//     formData,
//     {
//       headers: {
//         ...formData.getHeaders(),
//         "Content-Disposition": `attachment; filename="${file.originalname}"`
//       },
//       auth: {
//         username,
//         password: app_password
//       }
//     }
//   );

//   return res.data.id; // media_id
// }

// async function uploadFeaturedImageFromUrl({
//   site_url,
//   username,
//   app_password,
//   image_url
// }) {
//   const imageRes = await axios.get(image_url, {
//     responseType: "arraybuffer"
//   });

//   const formData = new FormData();
//   formData.append("file", imageRes.data, image_url.split("/").pop());

//   const res = await axios.post(
//     `${site_url.replace(/\/$/, "")}/wp-json/wp/v2/media`,
//     formData,
//     {
//       headers: {
//         ...formData.getHeaders()
//       },
//       auth: {
//         username,
//         password: app_password
//       }
//     }
//   );

//   return res.data.id;
// }

// const HARDCODED_IMAGE_URL =
//   "https://panditjeewebsitestorage.blob.core.windows.net/banners/Apara%20Ekadashi.jpg";


// const featured_media = await uploadFeaturedImageFromUrl({
//   site_url,
//   username,
//   app_password,
//   image_url: HARDCODED_IMAGE_URL
// });


function normalizeWpDate(scheduled_at) {
  if (scheduled_at instanceof Date) {
    return scheduled_at.toISOString().slice(0, 19);
  }
  // if (typeof scheduled_at === "string") {
  //   return scheduled_at.replace(" ", "T");
  // }
  return null;
}


// /**
//  * Publish / Schedule WordPress blog post
//  */
// export async function publishWordPress({
//   site_url,
//   username,
//   app_password,

//   title,
//   content,
//   excerpt = "",

//   status = "publish",          // publish | draft | future
//   slug = null,
//   categories = [],
//   tags = [],

//   file = null,                // uploaded image file
//   scheduled_at = null         // "YYYY-MM-DD HH:mm:ss"
// }) {
//   try {
//     let featured_media = null;

//     // 🖼 Upload featured image if provided
//     if (file) {
//       featured_media = await uploadFeaturedImage({
//         site_url,
//         username,
//         app_password,
//         file
//       });
//     }

//     const payload = {
//       title,
//       content,
//       excerpt,
//       status
//     };

//     if (slug) payload.slug = slug;
//     if (categories.length) payload.categories = categories;
//     if (tags.length) payload.tags = tags;
//     if (featured_media) payload.featured_media = featured_media;

//     // 🕒 Scheduled post handling
//     if (status === "future" && scheduled_at) {
//       const localISO = normalizeWpDate(scheduled_at);

//       payload.date = localISO;
//       payload.date_gmt = new Date(localISO).toISOString();
//     }
  
//     const postUrl = `${site_url}/wp-json/wp/v2/posts`
//     log("Post Url: ",postUrl)

//     const response = await axios.post(
//       postUrl,
//       payload,
//       {
//         auth: {
//           username,
//           password: app_password
//         },
//         headers: {
//           "Content-Type": "application/json"
//         }
//       }
//     );

//     return {
//       success: true,
//       external_post_id: response.data.id,
//       url: response.data.link,
//       raw: response.data
//     };

//   } catch (err) {
//     return {
//       success: false,
//       error: err.response?.data || err.message
//     };
//   }
// }

const DEFAULT_FEATURED_MEDIA_ID = 264857;

async function publishWordPress({
  site_url,
  username,
  app_password,
  title,
  content,
  excerpt = "",
  status = "publish",
  scheduled_at = null,
  featured_media_id = null   // 👈 NEW
}) {
const payload = {
  title,
  content: `<p>${content}</p>`,
  status
};

if (excerpt && excerpt.trim()) {
  payload.excerpt = `<p>${excerpt}</p>`;
}

// ✅ Only add featured_media if it exists
if (featured_media_id) {
  payload.featured_media = featured_media_id;
}



  if (status === "future" && scheduled_at) {
    const iso = normalizeWpDate(scheduled_at);
    payload.date = iso;
    payload.date_gmt = new Date(iso).toISOString();
  }

 console.log("FINAL PAYLOAD:", JSON.stringify(payload, null, 2));


  const response = await axios.post(
    `${site_url.replace(/\/$/, "")}/wp-json/wp/v2/posts`,
    payload,
    {
      auth: {
        username,
        password: app_password
      }
    }
  );

  return {
    success: true,
    external_post_id: response.data.id,
    url: response.data.link,
    raw: response.data
  };
}

async function publishToMultisite({
  post,
  wordpressSites   // fetched from DB
}) {
  const results = [];

  for (const site of wordpressSites) {
    const siteUrl = `${site.site_url}${site.site_path}`;

    let title = post.title;
    let content = post.content;
    let excerpt = post.excerpt;

    // 🌐 Translate if needed
    if (site.language !== "English") {
      title = await translateText({ text: title, language: site.language });
      content = await translateText({ text: content, language: site.language });
      excerpt = excerpt
        ? await translateText({ text: excerpt, language: site.language })
        : "";
    }

    const result = await publishWordPress({
      site_url: siteUrl,
      username: site.username,
      app_password: site.app_password,
      title,
      content,
      excerpt,
      status: post.status === "scheduled" ? "future" : "publish",
      scheduled_at: post.scheduled_at
    });

    results.push({
      site: site.language,
      success: result.success,
      url: result.url
    });
  }

  return results;
}




export {
  publishWordPress, publishToMultisite  
}


// import axios from "axios";

// /* =========================================================
//    🔹 Utilities
// ========================================================= */

// function normalizeSiteUrl(site_url, site_path = "") {
//   const base = site_url.replace(/\/$/, "");
//   const path = site_path ? site_path.replace(/\/$/, "") : "";
//   return `${base}${path}`;
// }

// function normalizeWpDate(scheduled_at) {
//   if (!scheduled_at) return null;

//   if (scheduled_at instanceof Date) {
//     return scheduled_at.toISOString().slice(0, 19);
//   }

//   if (typeof scheduled_at === "string") {
//     return scheduled_at.replace(" ", "T");
//   }

//   return null;
// }

// /* =========================================================
//    🔹 Core: Publish WordPress Post
// ========================================================= */

// export async function publishWordPress({
//   site_url,
//   site_path = "",
//   username,
//   app_password,
//   title,
//   content,
//   excerpt = "",
//   status = "publish",            // publish | future
//   scheduled_at = null,
//   featured_media_id = null,
//   categories = [],
//   tags = [],
//   slug = null
// }) {

//   try {

//     const fullSiteUrl = normalizeSiteUrl(site_url, site_path);

//     const payload = {
//       title,
//       content,
//       status
//     };

//     if (excerpt?.trim()) {
//       payload.excerpt = excerpt;
//     }

//     if (featured_media_id) {
//       payload.featured_media = featured_media_id;
//     }

//     if (categories.length) {
//       payload.categories = categories;
//     }

//     if (tags.length) {
//       payload.tags = tags;
//     }

//     if (slug) {
//       payload.slug = slug;
//     }

//     // 🕒 Scheduling
//     if (status === "future" && scheduled_at) {
//       const iso = normalizeWpDate(scheduled_at);

//       if (!iso) {
//         throw new Error("Invalid scheduled_at format");
//       }

//       payload.date = iso;
//       payload.date_gmt = new Date(iso).toISOString();
//     }

//     const endpoint = `${fullSiteUrl}/wp-json/wp/v2/posts`;

//     const response = await axios.post(
//       endpoint,
//       payload,
//       {
//         timeout: 30000,
//         auth: {
//           username,
//           password: app_password
//         },
//         headers: {
//           "Content-Type": "application/json"
//         }
//       }
//     );

//     return {
//       success: true,
//       external_post_id: response.data.id,
//       url: response.data.link,
//       raw: response.data
//     };

//   } catch (err) {

//     return {
//       success: false,
//       error: err.response?.data || err.message
//     };
//   }
// }

// /* =========================================================
//    🔹 Multisite Publisher (NO TRANSLATION HERE)
// ========================================================= */

// export async function publishToMultisite({
//   post,
//   wordpressSites,
//   translations = {}    // 👈 pass batch translations from worker
// }) {

//   const results = [];

//   for (const site of wordpressSites) {

//     const article =
//       site.language === "English"
//         ? post
//         : translations[site.language] || post;

//     const result = await publishWordPress({
//       site_url: site.site_url,
//       site_path: site.site_path,
//       username: site.username,
//       app_password: site.app_password,
//       title: article.title,
//       content: article.content,
//       excerpt: article.excerpt,
//       status: post.status === "scheduled" ? "future" : "publish",
//       scheduled_at: post.scheduled_at,
//       featured_media_id: site.default_media_id
//     });

//     results.push({
//       language: site.language,
//       success: result.success,
//       url: result.url,
//       error: result.error || null
//     });
//   }

//   return results;
// }


