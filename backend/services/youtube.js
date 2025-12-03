// services/youtube.js
import axios from "axios";
import { log } from "../utils.js";
import { google } from "googleapis";
import { publishTwitter } from "./twitter.js";

/**
 * Publishes a video to YouTube using stored refresh token.
 *
 * @param {string} clientId
 * @param {string} title
 * @param {string} description
 * @param {string} videoUrl - Public URL of the video to download & upload
 * @returns {object}
 */

const YT_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";

// Refresh YouTube token
export async function refreshYouTubeToken(refresh_token) {
  try {
    const response = await axios.post("https://oauth2.googleapis.com/token", {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token,
      grant_type: "refresh_token"
    });

    return {
      success: true,
      access_token: response.data.access_token,
      expires_in: response.data.expires_in
    };

  } catch (err) {
    log("❌ YouTube token refresh failed:", err.response?.data || err.message);
    return {
      success: false,
      error: err.response?.data || err.message
    };
  }
}

// export async function publishYouTube({
//   youtube_channel_id,
//   access_token,
//   refresh_token,
//   title,
//   description,
//   video_url,
//   twitter_credentials // { oauth_token, oauth_token_secret }
// }) {
//   try {
//     if (!refresh_token) {
//       throw new Error("Missing YouTube refresh_token");
//     }

//     // ───────────────────────────────────────────────
//     // 1️⃣ Refresh access token (always required)
//     // ───────────────────────────────────────────────
//     const refreshResp = await axios.post(
//       "https://oauth2.googleapis.com/token",
//       new URLSearchParams({
//         client_id: process.env.GOOGLE_CLIENT_ID,
//         client_secret: process.env.GOOGLE_CLIENT_SECRET,
//         refresh_token: refresh_token,
//         grant_type: "refresh_token",
//       })
//     );

//     const newAccessToken = refreshResp.data.access_token;

//     log("🔄 YouTube access token refreshed");

//     // ───────────────────────────────────────────────
//     // 2️⃣ Download the video file
//     // ───────────────────────────────────────────────
//     log("📥 Downloading video from:", video_url);

//     const videoResponse = await axios.get(video_url, {
//       responseType: "arraybuffer",
//     });

//     const videoBuffer = Buffer.from(videoResponse.data);

//     log("📹 Video downloaded, size:", videoBuffer.length);

//     // ───────────────────────────────────────────────
//     // 3️⃣ Step 1: Initiate YouTube Resumable Upload
//     // ───────────────────────────────────────────────
//     log("⏳ Initializing YouTube upload...");

//     const initiateResp = await axios.post(
//       "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
//       {
//         snippet: {
//           title,
//           description,
//           tags: ["Social Media Scheduler", "Automation"],
//         },
//         status: {
//           privacyStatus: "public",
//         },
//       },
//       {
//         headers: {
//           Authorization: `Bearer ${newAccessToken}`,
//           "Content-Type": "application/json; charset=UTF-8",
//           "X-Upload-Content-Length": videoBuffer.length,
//           "X-Upload-Content-Type": "video/mp4",
//         },
//       }
//     );

//     const uploadUrl = initiateResp.headers["location"];

//     if (!uploadUrl) {
//       throw new Error("Failed to get upload URL from YouTube");
//     }

//     log("📡 Upload URL obtained");

//     // ───────────────────────────────────────────────
//     // 4️⃣ Step 2: Upload video binary to upload URL
//     // ───────────────────────────────────────────────
//     log("⬆ Uploading video to YouTube...");

//     const uploadResp = await axios.put(uploadUrl, videoBuffer, {
//       headers: {
//         "Content-Length": videoBuffer.length,
//         "Content-Type": "video/mp4",
//       },
//     });

//     const youtubeVideoId = uploadResp.data.id;
//     const youtubeVideoUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;



//     log("🎉 YouTube Upload Complete:", youtubeVideoUrl);

//     // ───────────────────────────────────────────────
//     // ⭐ NEW: Publish to Twitter after YouTube success
//     // ───────────────────────────────────────────────
//     if (twitter_credentials?.oauth_token && twitter_credentials?.oauth_token_secret) {
//       log("🐦 Posting video link to Twitter...");

//       await publishTwitter({
//         oauth_token: twitter_credentials.oauth_token,
//         oauth_token_secret: twitter_credentials.oauth_token_secret,
//         status: `${description}\n\n🎥 Watch here: ${youtubeVideoUrl}`,
//         media_url: "" // Optional — If you want to attach original video thumbnail/media
//       });
//     }

//     return {
//       success: true,
//       youtube_video_id: uploadResp.data.id,
//       youtube_url: `https://www.youtube.com/watch?v=${uploadResp.data.id}`,
//     };
//   } catch (err) {
//     log("❌ YouTube publish error:", err.response?.data || err.message);

//     return {
//       success: false,
//       error: err.response?.data || err.message,
//     };
//   }
// }

export async function publishYouTube({
  youtube_channel_id,
  access_token,
  refresh_token,
  title,
  description,
  video_url,
  twitter_credentials
}) {
  try {
    if (!refresh_token) throw new Error("Missing YouTube refresh_token");

    //-------------------------------------------------------
    // 1️⃣ Refresh YouTube Access Token
    //-------------------------------------------------------
    const refreshResp = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token,
        grant_type: "refresh_token"
      })
    );

    const newAccessToken = refreshResp.data.access_token;
    log("🔄 YouTube token refreshed");

    //-------------------------------------------------------
    // 2️⃣ Download the Uploaded Video File
    //-------------------------------------------------------
    log("📥 Downloading video...");

    const videoResponse = await axios.get(video_url, {
      responseType: "arraybuffer"
    });

    const videoBuffer = Buffer.from(videoResponse.data);

    //-------------------------------------------------------
    // 3️⃣ Initiate YouTube Resumable Upload
    //-------------------------------------------------------
    log("⏳ Initializing YouTube upload...");

    const initiateResp = await axios.post(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        snippet: {
          title,
          description,
          tags: ["Social Media Scheduler", "Automation"]
        },
        status: {
          privacyStatus: "public"
        }
      },
      {
        headers: {
          Authorization: `Bearer ${newAccessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": videoBuffer.length,
          "X-Upload-Content-Type": "video/mp4"
        }
      }
    );

    const uploadUrl = initiateResp.headers.location;
    if (!uploadUrl) throw new Error("Failed to obtain YouTube upload URL");

    //-------------------------------------------------------
    // 4️⃣ Upload Binary Video to Google Upload URL
    //-------------------------------------------------------
    log("⬆ Uploading video chunks...");

    const uploadResp = await axios.put(uploadUrl, videoBuffer, {
      headers: {
        "Content-Length": videoBuffer.length,
        "Content-Type": "video/mp4"
      }
    });

    const youtubeVideoId = uploadResp.data.id;
    const youtubeVideoUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;

    log("🎉 YouTube Upload Success:", youtubeVideoUrl);

    //-------------------------------------------------------
    // 5️⃣ WAIT for processing to finish (so link is usable)
    //-------------------------------------------------------
    log("⏳ Waiting for YouTube video processing...");

    let processed = false;
    for (let i = 0; i < 12; i++) { // ~60 seconds total
      const check = await axios.get(
        `https://www.googleapis.com/youtube/v3/videos?part=status&id=${youtubeVideoId}&key=${process.env.GOOGLE_API_KEY}`
      );

      if (check.data.items[0]?.status?.uploadStatus === "processed") {
        processed = true;
        break;
      }

      await new Promise((r) => setTimeout(r, 5000));
    }

    if (!processed) log("⚠️ Still processing but continuing...");

    //-------------------------------------------------------
    // 6️⃣ Retrieve Thumbnail URL
    //-------------------------------------------------------
    let thumbnailUrl = null;

    log("📸 Checking thumbnail availability...");

    for (let i = 0; i < 10; i++) {
      const videoData = await axios.get(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${youtubeVideoId}&key=${process.env.GOOGLE_API_KEY}`
      );

      const thumbs = videoData?.data?.items?.[0]?.snippet?.thumbnails;

      if (thumbs?.maxres?.url || thumbs?.high?.url || thumbs?.medium?.url) {
        thumbnailUrl = thumbs.maxres?.url || thumbs.high?.url || thumbs.medium?.url;
        break;
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    if (!thumbnailUrl) {
      log("⚠️ No thumbnail yet — using YouTube link as preview fallback");
    }

    //-------------------------------------------------------
    // 7️⃣ Post to Twitter with Thumbnail + YouTube Link
    //-------------------------------------------------------
    if (twitter_credentials?.oauth_token && twitter_credentials?.oauth_token_secret) {
      log("🐦 Posting to Twitter...");
      
      await publishTwitter({
        oauth_token: twitter_credentials.oauth_token,
        oauth_token_secret: twitter_credentials.oauth_token_secret,
        status: `${title}\n\n${description}\n\n🎥 Watch here: ${youtubeVideoUrl}`,
        media_url: thumbnailUrl || youtubeVideoUrl
      });
    }

    return {
      success: true,
      youtube_video_id: youtubeVideoId,
      youtube_url: youtubeVideoUrl,
      thumbnail: thumbnailUrl
    };

  } catch (err) {
    log("❌ YouTube publish error:", err.response?.data || err.message);

    return {
      success: false,
      error: err.response?.data || err.message
    };
  }
}

