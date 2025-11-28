// services/facebook.js
import axios from 'axios';
import { log } from '../utils.js';

export async function publishFacebook({ pageId, pageAccessToken, message, image_url }) {
  try {
    const resp = await axios.post(
      `https://graph.facebook.com/${process.env.FB_API_VERSION}/${pageId}/photos`,
      null,
      {
        params: {
          url: image_url,
          caption: message,
          access_token: pageAccessToken
        }
      }
    );

    return {
      success: true,
      external_post_id: resp.data.post_id || resp.data.id,
      raw: resp.data
    };
  } catch (err) {
    log('facebook publish error', err.response?.data || err.message);
    return {
      success: false,
      error: err.response?.data || err.message
    };
  }
}
