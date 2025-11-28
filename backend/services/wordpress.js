// services/wordpressPublish.js
import axios from "axios";

export async function publishWordPress({ site_url, username, app_password, title, content }) {

  try {
    const post = await axios.post(
      `${site_url}/wp-json/wp/v2/posts`,
      {
        title,
        content,
        status: "publish",
      },
      {
        auth: {
          username,
          password: app_password,
        }
      }
    );

    return {
      success: true,
      postId: post.data.id,
      url: post.data.link,
    };

  } catch (err) {
    return {
      success: false,
      error: err.response?.data || err.message
    };
  }
}
