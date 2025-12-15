import { TwitterApi } from "twitter-api-v2";
import axios from "axios";
import { log } from "../utils.js";
import { fileTypeFromBuffer } from "file-type";

export async function publishTwitter({
  oauth_token,
  oauth_token_secret,
  status,
  media_urls = []   // ✅ ARRAY
}) {
  try {
    if (!oauth_token || !oauth_token_secret) {
      throw new Error("Missing OAuth credentials");
    }

    const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: oauth_token,
      accessSecret: oauth_token_secret,
    });

    const rwClient = client.readWrite;

    const mediaIds = [];
    let hasVideo = false;

    // Twitter limits
    const urls = media_urls.slice(0, 4);

    for (const url of urls) {
      log("📥 Downloading media:", url);

      const mediaResponse = await axios.get(url, { responseType: "arraybuffer" });
      const buffer = Buffer.from(mediaResponse.data);

      const detected = await fileTypeFromBuffer(buffer);
      let mimeType = detected?.mime || mediaResponse.headers["content-type"];

      if (!mimeType) mimeType = "application/octet-stream";

      log("📄 Detected MIME:", mimeType);

      const isVideo = mimeType.startsWith("video/");
      const isImage = mimeType.startsWith("image/");

      // ❌ Twitter rules: video OR images, not both
      if (isVideo && mediaIds.length > 0) {
        throw new Error("Twitter does not allow mixing images and video");
      }
      if (hasVideo && isImage) {
        throw new Error("Twitter does not allow mixing images and video");
      }

      // 🎞 VIDEO (only 1 allowed)
      if (isVideo) {
        log("🎞 Uploading video via chunked upload");

        const mediaId = await rwClient.v1.uploadMedia(buffer, {
          mimeType,            // ✅ FIXED (no `type`)
          longVideo: true,     // ✅ REQUIRED for mp4
          chunkLength: 5 * 1024 * 1024
        });

        mediaIds.push(mediaId);
        hasVideo = true;
        break; // only one video allowed
      }

      // 🖼 IMAGE
      if (isImage) {
        log("🖼 Uploading image");

        const mediaId = await rwClient.v1.uploadMedia(buffer, {
          mimeType
        });

        mediaIds.push(mediaId);
      } else {
        throw new Error(`Unsupported media type: ${mimeType}`);
      }
    }

    // 🐦 Publish Tweet
    const payload = {
      text: status
    };

    if (mediaIds.length > 0) {
      payload.media = { media_ids: mediaIds };
    }

    log("📤 Posting tweet:", payload);

    const tweet = await rwClient.v2.tweet(payload);

    log("✅ Tweet posted:", tweet.data.id);

    return {
      success: true,
      external_post_id: tweet.data.id,
      raw: tweet
    };

  } catch (error) {
    log("❌ Twitter publish error:", error);
    return {
      success: false,
      error: error?.response?.data || error?.message || error
    };
  }
}
