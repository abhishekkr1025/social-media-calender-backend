import { TwitterApi } from "twitter-api-v2";
import axios from "axios";
import { log } from "../utils.js";
import { fileTypeFromBuffer } from "file-type";

export async function publishTwitter({
  oauth_token,
  oauth_token_secret,
  status,
  media_url
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

    let mediaId = null;

    // ───────────────────────────────
    // 1️⃣ DOWNLOAD MEDIA
    // ───────────────────────────────
    if (media_url) {
      log("📥 Downloading media:", media_url);

      const mediaResponse = await axios.get(media_url, { responseType: "arraybuffer" });
      const buffer = Buffer.from(mediaResponse.data);

      // Try to detect mime from file itself
      const detected = await fileTypeFromBuffer(buffer);

      let mimeType = detected?.mime || mediaResponse.headers["content-type"];

      if (!mimeType) {
        mimeType = "application/octet-stream";
      }

      log("📄 Final MIME Type:", mimeType);

      const isVideo = mimeType.startsWith("video/");
      const isImage = mimeType.startsWith("image/");

      // ───────────────────────────────
      // 2️⃣ UPLOAD VIDEO
      // ───────────────────────────────
      if (isVideo) {
        log("🎞 Uploading MP4 via CHUNKED upload...");

        mediaId = await client.v1.uploadMedia(buffer, {
          type: "video/mp4",
          chunkLength: 5 * 1024 * 1024, // 5MB
        });

        log("🎥 Video uploaded, ID:", mediaId);
      }

      // ───────────────────────────────
      // 3️⃣ UPLOAD IMAGE
      // ───────────────────────────────
      else if (isImage) {
        log("🖼 Uploading image...");

        mediaId = await client.v1.uploadMedia(buffer, {
          mimeType,
        });

        log("🖼 Image uploaded, ID:", mediaId);
      }

      // ❌ Unknown media
      else {
        throw new Error(`Unsupported media type: ${mimeType}`);
      }
    }

    // ───────────────────────────────
    // 4️⃣ PUBLISH TWEET
    // ───────────────────────────────
    const payload = { text: status };

    if (mediaId) {
      payload.media = { media_ids: [mediaId] };
    }

    log("📤 Posting tweet:", payload);

    const tweet = await client.v2.tweet(payload);

    log("✅ Tweet posted:", tweet.data.id);

    return {
      success: true,
      tweetId: tweet.data.id,
    };

  } catch (error) {
    log("❌ Twitter publish error:", error);
    return {
      success: false,
      error: error?.response?.data || error?.message || error
    };
  }
}
