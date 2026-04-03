import axios from "axios";
import FormData from "form-data";
import db from "../db.js";
import { log } from "../utils.js";
import fs from "fs";


export async function publishPanditjee({
  access_token,
  influencerUserId,
  caption,
  media_url = null,   // ✅ worker will pass URL
  scheduleId          // ✅ IMPORTANT (panditjee_scheduled_posts.id)
}) {
  try {
    // ───────────────────────────────
    // VALIDATION
    // ───────────────────────────────
    if (!access_token) throw new Error("Missing access token");
    if (!influencerUserId) throw new Error("Missing influencerUserId");
    if (!caption) throw new Error("Caption is required");

    // ───────────────────────────────
    // MARK PROCESSING
    // ───────────────────────────────
    if (scheduleId) {
      await db.query(
        `UPDATE panditjee_scheduled_posts
         SET status = 'processing'
         WHERE id = ?`,
        [scheduleId]
      );
    }

    // ───────────────────────────────
    // BUILD FORM DATA
    // ───────────────────────────────
    const form = new FormData();

    form.append("influencerUserId", String(influencerUserId));
    form.append("caption", caption);

    // ───────────────────────────────
    // DOWNLOAD MEDIA (if exists)
    // ───────────────────────────────
    


 if (media_url) {
  let buffer;
  let mimeType = "application/octet-stream";

  // Extract filename with extension from URL
  const urlPath = media_url.split("?")[0]; // strip query params if any
  const originalFilename = urlPath.split("/").pop() || "upload"; // e.g. "video.mp4"

  if (media_url.startsWith("http")) {
    log("📥 Downloading remote media:", media_url);

    const res = await axios.get(media_url, {
      responseType: "arraybuffer"
    });

    buffer = Buffer.from(res.data);
    mimeType = res.headers["content-type"] || mimeType;

  } else {
    log("📂 Reading local file:", media_url);

    buffer = fs.readFileSync(media_url);
    mimeType = "image/jpeg";
  }

  form.append("imagePost", buffer, {
    filename: originalFilename,  // ✅ e.g. "video.mp4" instead of "upload"
    contentType: mimeType
  });
}

    // ───────────────────────────────
    // CALL API
    // ───────────────────────────────
    log("📤 Posting to Panditjee");

    const response = await axios.post(
      `${process.env.PANDITJEE_API_BASE}/api/influencer/posts/create`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${access_token}`
        }
      }
    );

    const apiData = response.data?.data?.[0];

    log("✅ Panditjee success:", apiData);

    // ───────────────────────────────
    // ✅ UPDATE DB ON SUCCESS
    // ───────────────────────────────
    if (scheduleId) {
      await db.query(
        `UPDATE panditjee_scheduled_posts
         SET
           status = 'posted',
           post_id = ?,
           influencer_user_id = ?,
           short_url = ?,
           posted_at = NOW(),
           error = NULL
         WHERE id = ?`,
        [
          apiData?.postId,
          apiData?.influencerUserId,
          apiData?.postUrl,
          scheduleId
        ]
      );
    }

    return {
      success: true,
      external_post_id: apiData?.postId || null,
      raw: response.data
    };

  } catch (error) {
    const errData = error?.response?.data || error?.message || error;

    log("❌ Panditjee error:", errData);

    // ───────────────────────────────
    // ❌ UPDATE DB ON FAILURE
    // ───────────────────────────────
    if (scheduleId) {
      await db.query(
        `UPDATE panditjee_scheduled_posts
         SET
           status = 'failed',
           error = ?
         WHERE id = ?`,
        [
          typeof errData === "string"
            ? errData
            : JSON.stringify(errData),
          scheduleId
        ]
      );
    }

    return {
      success: false,
      error: errData
    };
  }
}