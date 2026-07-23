// services/pinterest.js
import axios from "axios";
import { log } from "../utils.js";

const APP_ID = process.env.PINTEREST_APP_ID;
const APP_SECRET = process.env.PINTEREST_APP_SECRET;

const basicAuthHeader = () =>
  "Basic " + Buffer.from(`${APP_ID}:${APP_SECRET}`).toString("base64");

// Exchange a refresh token for a fresh access token
export async function refreshPinterestToken(refresh_token) {
  const resp = await axios.post(
    "https://api.pinterest.com/v5/oauth/token",
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token,
    }),
    {
      headers: {
        Authorization: basicAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  // { access_token, expires_in, refresh_token?, ... }
  return resp.data;
}

// Publish a Pin
export async function publishPinterest({
  access_token,
  board_id,
  title,
  description,
  link = null,
  image_url, // ✅ required — Pinterest pins must have media
}) {
  try {
    if (!access_token) throw new Error("Missing Pinterest access token");
    if (!board_id) throw new Error("Missing board_id");
    if (!image_url) throw new Error("image_url is required to create a Pin");

    const payload = {
      board_id,
      title: title || undefined,
      description: description || undefined,
      link: link || undefined,
      media_source: {
        source_type: "image_url",
        url: image_url,
      },
    };

    log("📌 Creating Pin:", payload);

    const resp = await axios.post(
      "https://api.pinterest.com/v5/pins",
      payload,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
      }
    );

    log("✅ Pin created:", resp.data.id);

    return {
      success: true,
      external_post_id: resp.data.id,
      raw: resp.data,
    };
  } catch (error) {
    log("❌ Pinterest publish error:", error?.response?.data || error?.message);

    return {
      success: false,
      error: error?.response?.data || error?.message || error,
    };
  }
}