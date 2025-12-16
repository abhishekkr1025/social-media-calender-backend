import { TwitterApi } from "twitter-api-v2";
import axios from "axios";
import { log } from "../utils.js";
import { fileTypeFromBuffer } from "file-type";

export async function publishTwitter({
  oauth_token,
  oauth_token_secret,
  status,
  media_url = null   // ✅ SINGLE MEDIA
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
    let mediaId = null;

    // ───────────────────────────────
    // 1️⃣ DOWNLOAD MEDIA (if exists)
    // ───────────────────────────────
    if (media_url) {
      log("📥 Downloading media:", media_url);

      const mediaResponse = await axios.get(media_url, {
        responseType: "arraybuffer"
      });

      const buffer = Buffer.from(mediaResponse.data);

      const detected = await fileTypeFromBuffer(buffer);
      let mimeType = detected?.mime || mediaResponse.headers["content-type"];

      if (!mimeType) {
        mimeType = "application/octet-stream";
      }

      log("📄 Detected MIME:", mimeType);

      const isVideo = mimeType.startsWith("video/");
      const isImage = mimeType.startsWith("image/");

      // ───────────────────────────────
      // 2️⃣ UPLOAD VIDEO
      // ───────────────────────────────
      if (isVideo) {
        log("🎞 Uploading video via chunked upload");

        mediaId = await rwClient.v1.uploadMedia(buffer, {
          mimeType,
          longVideo: true,
          chunkLength: 5 * 1024 * 1024
        });

        log("🎥 Video uploaded:", mediaId);
      }

      // ───────────────────────────────
      // 3️⃣ UPLOAD IMAGE
      // ───────────────────────────────
      else if (isImage) {
        log("🖼 Uploading image");

        mediaId = await rwClient.v1.uploadMedia(buffer, {
          mimeType
        });

        log("🖼 Image uploaded:", mediaId);
      } else {
        throw new Error(`Unsupported media type: ${mimeType}`);
      }
    }

    // ───────────────────────────────
    // 4️⃣ POST TWEET
    // ───────────────────────────────
    const payload = { text: status };

    if (mediaId) {
      payload.media = { media_ids: [mediaId] };
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
