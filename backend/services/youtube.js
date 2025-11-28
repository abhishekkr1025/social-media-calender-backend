// services/youtube.js
import axios from "axios";
import { log } from "../utils.js";
import { google } from "googleapis";

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
  video_url
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

    log("🎉 YouTube Upload Complete:", uploadResp.data.id);

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
