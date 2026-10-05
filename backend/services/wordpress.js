import axios from "axios";
import FormData from "form-data";
import { translateText } from "./translate.js";


function normalizeWpDate(scheduled_at) {
  if (scheduled_at instanceof Date) {
    return scheduled_at.toISOString().slice(0, 19);
  }
 
  return null;
}

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
  featured_media_id = null,
  categories = [],
  slug, tags ,   // 👈 NEW
  author = null   // ← NEW
}) {
const payload = {
  title,
  content: content,
  status
};

if (excerpt && excerpt.trim()) {
  payload.excerpt = excerpt;
}

// ✅ Only add featured_media if it exists
if (featured_media_id) {
  payload.featured_media = featured_media_id;
}

if (categories && categories.length) {
  payload.categories = categories;
}

if (slug && slug.trim()) {
    payload.slug = slug.trim();
  }

  if (tags && tags.length > 0) {
    payload.tags = tags;
  }

   if (author) {
    payload.author = author;
  }



  if (status === "future" && scheduled_at) {
    const iso = normalizeWpDate(scheduled_at);
    payload.date = iso;
    payload.date_gmt = new Date(iso).toISOString();
  }

//  console.log("FINAL PAYLOAD:", JSON.stringify(payload, null, 2));


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





