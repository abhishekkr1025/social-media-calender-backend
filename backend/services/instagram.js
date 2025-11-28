// services/instagram.js
import axios from 'axios';
import { log } from '../utils.js';

const FB_API_VERSION = process.env.FB_API_VERSION || 'v24.0';

export async function publishInstagram({ instagramAccountId, accessToken, image_url, caption }) {
  try {
    // 1) create media
    const createResp = await axios.post(
      `https://graph.facebook.com/${FB_API_VERSION}/${instagramAccountId}/media`,
      null,
      {
        params: {
          image_url,
          caption,
          access_token: accessToken
        },
        timeout: 20000
      }
    );

    const creation_id = createResp.data.id;
    if (!creation_id) throw new Error('No creation_id returned');

    // 2) publish
    const publishResp = await axios.post(
      `https://graph.facebook.com/${FB_API_VERSION}/${instagramAccountId}/media_publish`,
      null,
      {
        params: {
          creation_id,
          access_token: accessToken
        },
        timeout: 20000
      }
    );

    const igPostId = publishResp.data.id;
    return {
      success: true,
      external_post_id: igPostId,
      raw: { createResp: createResp.data, publishResp: publishResp.data }
    };

  } catch (err) {
    log('instagram publish error', err.response?.data || err.message);
    return { success: false, error: err.response?.data || err.message };
  }
}
