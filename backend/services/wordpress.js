import axios from "axios";


async function uploadFeaturedImage({ site_url, username, app_password, file }) {
  const formData = new FormData();
  formData.append("file", file.buffer, file.originalname);

  const res = await axios.post(
    `${site_url}/wp-json/wp/v2/media`,
    formData,
    {
      headers: {
        "Content-Disposition": `attachment; filename="${file.originalname}"`,
        ...formData.getHeaders()
      },
      auth: {
        username,
        password: app_password
      }
    }
  );

  return res.data.id; // media_id
}

/**
 * Publish a WordPress blog post
 */
export async function publishWordPress({
  site_url,
  username,
  app_password,

  title,
  content,

  excerpt = "",
  status = "publish",          // publish | draft | future
  slug = null,
  categories = [],             // category IDs
  tags = [],                   // tag IDs
  featured_media = null,       // media ID
  scheduled_at = null          // "YYYY-MM-DD HH:mm:ss"
}) {
  try {
    const payload = {
      title,
      content,
      excerpt,
      status,
    };

    if (slug) payload.slug = slug;
    if (categories.length) payload.categories = categories;
    if (tags.length) payload.tags = tags;
    if (featured_media) payload.featured_media = featured_media;

    // 🕒 Scheduled post
    if (status === "future" && scheduled_at) {
      payload.date = scheduled_at;
    }

    const response = await axios.post(
      `${site_url.replace(/\/$/, "")}/wp-json/wp/v2/posts`,
      payload,
      {
        auth: {
          username,
          password: app_password
        },
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

    return {
      success: true,
      external_post_id: response.data.id,
      url: response.data.link,
      raw: response.data
    };

  } catch (err) {
    return {
      success: false,
      error: err.response?.data || err.message
    };
  }
}
