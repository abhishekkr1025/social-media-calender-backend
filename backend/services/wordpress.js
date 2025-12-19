import axios from "axios";
import FormData from "form-data";

// /**
//  * Upload featured image to WordPress Media Library
//  */
async function uploadFeaturedImage({ site_url, username, app_password, file }) {
  const formData = new FormData();
  formData.append("file", file.buffer, file.originalname);

  const mediaUrl = `${site_url}/wp-json/wp/v2/media`
  console.log("media url: ", mediaUrl)

  const res = await axios.post(
    mediaUrl,
    formData,
    {
      headers: {
        ...formData.getHeaders(),
        "Content-Disposition": `attachment; filename="${file.originalname}"`
      },
      auth: {
        username,
        password: app_password
      }
    }
  );

  return res.data.id; // media_id
}

async function uploadFeaturedImageFromUrl({
  site_url,
  username,
  app_password,
  image_url
}) {
  const imageRes = await axios.get(image_url, {
    responseType: "arraybuffer"
  });

  const formData = new FormData();
  formData.append("file", imageRes.data, image_url.split("/").pop());

  const res = await axios.post(
    `${site_url.replace(/\/$/, "")}/wp-json/wp/v2/media`,
    formData,
    {
      headers: {
        ...formData.getHeaders()
      },
      auth: {
        username,
        password: app_password
      }
    }
  );

  return res.data.id;
}


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


async function publishWordPress({
  site_url,
  username,
  app_password,
  title,
  content,
  excerpt = "",
  status = "publish",
  featured_media = null,
  scheduled_at = null
}) {
  const payload = {
    title,
    content,
    excerpt,
    status
  };

  if (featured_media) {
    payload.featured_media = featured_media; // 🔥 THIS IS REQUIRED
  }

  if (status === "future" && scheduled_at) {
    const iso = normalizeWpDate(scheduled_at);
    payload.date = iso;
    payload.date_gmt = new Date(iso).toISOString();
  }

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

export {
  publishWordPress,
  uploadFeaturedImage,
  uploadFeaturedImageFromUrl
}




