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

export async function publishYouTube({
  youtube_channel_id,
  access_token,
  refresh_token,
  title,
  description,
  video_url,
  twitter_credentials // { oauth_token, oauth_token_secret }
}) {
  try {
    if (!refresh_token) {
      throw new Error("Missing YouTube refresh_token");
    }

    // ───────────────────────────────────────────────
    // 1️⃣ Refresh access token (always required)
    // ───────────────────────────────────────────────
    const refreshResp = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refresh_token,
        grant_type: "refresh_token",
      })
    );

    const newAccessToken = refreshResp.data.access_token;

    log("🔄 YouTube access token refreshed");

    // ───────────────────────────────────────────────
    // 2️⃣ Download the video file
    // ───────────────────────────────────────────────
    log("📥 Downloading video from:", video_url);

    const videoResponse = await axios.get(video_url, {
      responseType: "arraybuffer",
    });

    const videoBuffer = Buffer.from(videoResponse.data);

    log("📹 Video downloaded, size:", videoBuffer.length);

    // ───────────────────────────────────────────────
    // 3️⃣ Step 1: Initiate YouTube Resumable Upload
    // ───────────────────────────────────────────────
    log("⏳ Initializing YouTube upload...");

    const initiateResp = await axios.post(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        snippet: {
          title,
          description,
          tags: ["Social Media Scheduler", "Automation"],
        },
        status: {
          privacyStatus: "public",
        },
      },
      {
        headers: {
          Authorization: `Bearer ${newAccessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": videoBuffer.length,
          "X-Upload-Content-Type": "video/mp4",
        },
      }
    );

    const uploadUrl = initiateResp.headers["location"];

    if (!uploadUrl) {
      throw new Error("Failed to get upload URL from YouTube");
    }

    log("📡 Upload URL obtained");

    // ───────────────────────────────────────────────
    // 4️⃣ Step 2: Upload video binary to upload URL
    // ───────────────────────────────────────────────
    log("⬆ Uploading video to YouTube...");

    const uploadResp = await axios.put(uploadUrl, videoBuffer, {
      headers: {
        "Content-Length": videoBuffer.length,
        "Content-Type": "video/mp4",
      },
    });

    const youtubeVideoId = uploadResp.data.id;
    const youtubeVideoUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;



    log("🎉 YouTube Upload Complete:", youtubeVideoUrl);

    // ───────────────────────────────────────────────
    // ⭐ NEW: Publish to Twitter after YouTube success
    // ───────────────────────────────────────────────
    if (twitter_credentials?.oauth_token && twitter_credentials?.oauth_token_secret) {
      log("🐦 Posting video link to Twitter...");

      await publishTwitter({
        oauth_token: twitter_credentials.oauth_token,
        oauth_token_secret: twitter_credentials.oauth_token_secret,
        status: `${description}\n\n🎥 Watch here: ${youtubeVideoUrl}`,
        media_url: "" // Optional — If you want to attach original video thumbnail/media
      });
    }

    return {
      success: true,
      youtube_video_id: uploadResp.data.id,
      youtube_url: `https://www.youtube.com/watch?v=${uploadResp.data.id}`,
    };
  } catch (err) {
    log("❌ YouTube publish error:", err.response?.data || err.message);

    return {
      success: false,
      error: err.response?.data || err.message,
    };
  }
}

/**
 * Publishes an image + caption as a YouTube Community Post.
 *
 * @param {string} refresh_token  - Stored YouTube refresh token
 * @param {string} caption        - Text caption for the community post
 * @param {string} [image_url]    - Optional public URL of the image to attach
 * @returns {object}
 */
export async function publishYouTubeCommunityPost({
  refresh_token,
  caption,
  image_url
}) {
  try {
    if (!refresh_token) throw new Error("Missing YouTube refresh_token");

    // ── 1. Refresh access token ──────────────────────────────────────
    const refreshResp = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token,
        grant_type:    "refresh_token"
      })
    );

    const newAccessToken = refreshResp.data.access_token;
    log("🔄 YouTube token refreshed for community post");

    // ── 2. Build post body ───────────────────────────────────────────
    const snippetPayload = { textOriginal: caption };

    if (image_url) {
      log("🖼 Attaching image URL:", image_url);
      snippetPayload.images = [{ url: image_url }];
    }

    // ── 3. Create community post ─────────────────────────────────────
    log("📢 Creating YouTube community post...");

    const postResp = await axios.post(
      "https://www.googleapis.com/youtube/v3/posts?part=snippet",
      { snippet: snippetPayload },
      {
        headers: {
          Authorization:  `Bearer ${newAccessToken}`,
          "Content-Type": "application/json"
        },
        responseType: "json"
      }
    );

    const postId  = postResp.data?.id;
    const postUrl = postId ? `https://www.youtube.com/post/${postId}` : null;

    log("🎉 YouTube Community Post created:", postUrl || postResp.data);

    return { success: true, post_id: postId, post_url: postUrl };

  } catch (err) {
    let errorDetail;
    if (err?.response?.data instanceof Buffer) {
      errorDetail = err.response.data.toString("utf8").substring(0, 800);
    } else if (err?.response?.data) {
      errorDetail = JSON.stringify(err.response.data).substring(0, 800);
    } else {
      errorDetail = err.message;
    }

    log("❌ YouTube community post error:", errorDetail);
    log("❌ HTTP status:", err?.response?.status);

    return { success: false, error: errorDetail };
  }
}

// export async function publishYouTube({
//   youtube_channel_id,
//   access_token,
//   refresh_token,
//   title,
//   description,
//   video_url,
//   twitter_credentials
// }) {
//   try {
//     if (!refresh_token) throw new Error("Missing YouTube refresh_token");

//     //-------------------------------------------------------
//     // 1️⃣ Refresh Access Token
//     //-------------------------------------------------------
//     const refreshResp = await axios.post(
//       "https://oauth2.googleapis.com/token",
//       new URLSearchParams({
//         client_id: process.env.GOOGLE_CLIENT_ID,
//         client_secret: process.env.GOOGLE_CLIENT_SECRET,
//         refresh_token,
//         grant_type: "refresh_token"
//       })
//     );

//     const newAccessToken = refreshResp.data.access_token;
//     log("🔄 YouTube token refreshed");

//     //-------------------------------------------------------
//     // 2️⃣ Download Uploaded File
//     //-------------------------------------------------------
//     log("📥 Downloading video...");

//     const videoResponse = await axios.get(video_url, { responseType: "arraybuffer" });
//     const videoBuffer = Buffer.from(videoResponse.data);

//     //-------------------------------------------------------
//     // 3️⃣ Initiate Resumable Upload
//     //-------------------------------------------------------
//     log("⏳ Initializing YouTube upload...");

//     const initiateResp = await axios.post(
//       "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
//       {
//         snippet: {
//           title,
//           description,
//           tags: ["Social Media Scheduler", "Automation"]
//         },
//         status: {
//           privacyStatus: "public"
//         }
//       },
//       {
//         headers: {
//           Authorization: `Bearer ${newAccessToken}`,
//           "Content-Type": "application/json; charset=UTF-8",
//           "X-Upload-Content-Length": videoBuffer.length,
//           "X-Upload-Content-Type": "video/mp4"
//         }
//       }
//     );

//     const uploadUrl = initiateResp.headers.location;
//     if (!uploadUrl) throw new Error("Failed to obtain YouTube upload URL");

//     //-------------------------------------------------------
//     // 4️⃣ Upload Binary File
//     //-------------------------------------------------------
//     log("⬆ Uploading video...");

//     const uploadResp = await axios.put(uploadUrl, videoBuffer, {
//       headers: {
//         "Content-Length": videoBuffer.length,
//         "Content-Type": "video/mp4"
//       }
//     });

//     const youtubeVideoId = uploadResp.data.id;
//     const youtubeVideoUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;

//     log("🎉 YouTube Upload Success:", youtubeVideoUrl);

//     //-------------------------------------------------------
//     // 5️⃣ Wait for Processing (poll status)
//     //-------------------------------------------------------
//     log("⏳ Waiting for YouTube processing...");

//     let processed = false;
//     for (let i = 0; i < 20; i++) { // ~100 sec max
//       const check = await axios.get(
//         `https://www.googleapis.com/youtube/v3/videos`,
//         {
//           params: { id: youtubeVideoId, part: "status" },
//           headers: { Authorization: `Bearer ${newAccessToken}` }
//         }
//       );

//       const state = check.data.items[0]?.status?.uploadStatus;
//       log(`📌 Processing status: ${state}`);

//       if (state === "processed" || state === "uploaded") {
//         processed = true;
//         break;
//       }

//       await new Promise(res => setTimeout(res, 5000));
//     }

//     if (!processed) log("⚠️ Still processing — continuing...");

//     //-------------------------------------------------------
//     // 6️⃣ Fetch Thumbnail
//     //-------------------------------------------------------
//     let thumbnailUrl = null;
//     log("📸 Checking thumbnail...");

//     for (let i = 0; i < 10; i++) {
//       const videoInfo = await axios.get(
//         `https://www.googleapis.com/youtube/v3/videos`,
//         {
//           params: { id: youtubeVideoId, part: "snippet" },
//           headers: { Authorization: `Bearer ${newAccessToken}` }
//         }
//       );

//       const thumbs = videoInfo?.data?.items?.[0]?.snippet?.thumbnails;

//       thumbnailUrl =
//         thumbs?.maxres?.url ||
//         thumbs?.high?.url ||
//         thumbs?.medium?.url ||
//         null;

//       if (thumbnailUrl) break;

//       await new Promise(res => setTimeout(res, 2000));
//     }

//     if (!thumbnailUrl) {
//       log("⚠️ Thumbnail not ready — fallback to video URL");
//       thumbnailUrl = youtubeVideoUrl;
//     }

//     //-------------------------------------------------------
//     // 7️⃣ Post to Twitter (Optional)
//     //-------------------------------------------------------
//     if (twitter_credentials?.oauth_token && twitter_credentials?.oauth_token_secret) {
//       log("🐦 Posting video link to Twitter...");

//       await publishTwitter({
//         oauth_token: twitter_credentials.oauth_token,
//         oauth_token_secret: twitter_credentials.oauth_token_secret,
//         status: `${title}\n\n${description}\n\n🎥 Watch here: ${youtubeVideoUrl}`,
//         media_url: thumbnailUrl
//       });
//     }

//     //-------------------------------------------------------
//     // 🎉 DONE
//     //-------------------------------------------------------
//     return {
//       success: true,
//       youtube_video_id: youtubeVideoId,
//       youtube_url: youtubeVideoUrl,
//       thumbnail: thumbnailUrl
//     };

//   } catch (err) {
//     log("❌ YouTube publish error:", err.response?.data || err.message);

//     return {
//       success: false,
//       error: err.response?.data || err.message
//     };
//   }
// }


// export async function publishYouTube({
//   youtube_channel_id,
//   access_token,
//   refresh_token,
//   title,
//   description,
//   video_url,
//   twitter_credentials
// }) {
//   try {
//     if (!refresh_token) throw new Error("Missing YouTube refresh_token");

//     //-------------------------------------------------------
//     // 1️⃣ Refresh Access Token
//     //-------------------------------------------------------
//     const refreshResp = await axios.post(
//       "https://oauth2.googleapis.com/token",
//       new URLSearchParams({
//         client_id: process.env.GOOGLE_CLIENT_ID,
//         client_secret: process.env.GOOGLE_CLIENT_SECRET,
//         refresh_token,
//         grant_type: "refresh_token"
//       })
//     );

//     const newAccessToken = refreshResp.data.access_token;
//     log("🔄 YouTube token refreshed");

//     //-------------------------------------------------------
//     // 2️⃣ Download File to Upload
//     //-------------------------------------------------------
//     log("📥 Downloading video...");
//     const videoResponse = await axios.get(video_url, { responseType: "arraybuffer" });
//     const videoBuffer = Buffer.from(videoResponse.data);

//     //-------------------------------------------------------
//     // 3️⃣ Start Resumable Upload Session
//     //-------------------------------------------------------
//     log("⏳ Initializing YouTube upload...");

//     const initiateResp = await axios.post(
//       "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
//       {
//         snippet: {
//           title,
//           description,
//           tags: ["Social Media Scheduler", "Automation"]
//         },
//         status: { privacyStatus: "public" }
//       },
//       {
//         headers: {
//           Authorization: `Bearer ${newAccessToken}`,
//           "Content-Type": "application/json; charset=UTF-8",
//           "X-Upload-Content-Length": videoBuffer.length,
//           "X-Upload-Content-Type": "video/mp4"
//         }
//       }
//     );

//     const uploadUrl = initiateResp.headers.location;
//     if (!uploadUrl) throw new Error("Failed to obtain upload URL from YouTube");

//     //-------------------------------------------------------
//     // 4️⃣ Upload File in One Request
//     //-------------------------------------------------------
//     log("⬆ Uploading video...");

//     const uploadResp = await axios.put(uploadUrl, videoBuffer, {
//       headers: {
//         "Content-Length": videoBuffer.length,
//         "Content-Type": "video/mp4"
//       }
//     });

//     const youtubeVideoId = uploadResp.data.id;
//     const youtubeVideoUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;

//     log("🎉 YouTube Upload Complete:", youtubeVideoUrl);

//     //-------------------------------------------------------
//     // 5️⃣ Get Thumbnail Once (No Polling)
//     //-------------------------------------------------------
//     let thumbnailUrl = youtubeVideoUrl; // default if not ready

//     try {
//       const metaResp = await axios.get(
//         "https://www.googleapis.com/youtube/v3/videos",
//         {
//           params: { id: youtubeVideoId, part: "snippet" },
//           headers: { Authorization: `Bearer ${newAccessToken}` }
//         }
//       );

//       const thumbs = metaResp?.data?.items?.[0]?.snippet?.thumbnails;
//       thumbnailUrl =
//         thumbs?.maxres?.url ||
//         thumbs?.high?.url ||
//         thumbs?.medium?.url ||
//         youtubeVideoUrl;

//     } catch {
//       log("⚠️ Thumbnail not ready yet — using fallback");
//     }

//     //-------------------------------------------------------
//     // 6️⃣ Post to Twitter (Optional)
//     //-------------------------------------------------------
//     if (twitter_credentials?.oauth_token && twitter_credentials?.oauth_token_secret) {
//       log("🐦 Posting video link to Twitter...");

//       await publishTwitter({
//         oauth_token: twitter_credentials.oauth_token,
//         oauth_token_secret: twitter_credentials.oauth_token_secret,
//         status: `${title}\n\n${description}\n\n🎥 Watch: ${youtubeVideoUrl}`,
//         media_url: thumbnailUrl
//       });
//     }

//     //-------------------------------------------------------
//     // 🎉 Return Success Response
//     //-------------------------------------------------------
//     return {
//       success: true,
//       youtube_video_id: youtubeVideoId,
//       youtube_url: youtubeVideoUrl,
//       thumbnail: thumbnailUrl
//     };

//   } catch (err) {
//     log("❌ YouTube publish error:", err.response?.data || err.message);

//     return {
//       success: false,
//       error: err.response?.data || err.message
//     };
//   }
// }



