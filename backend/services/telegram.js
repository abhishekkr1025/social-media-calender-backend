import axios from "axios";
import { log } from "../utils.js";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

export async function publishTelegram({
  chat_id,
  text,
  media_url = null
}) {
  try {
    if (!chat_id) throw new Error("Missing chat_id");

    // ───────────────────────────────
    // 📸 MEDIA POST
    // ───────────────────────────────
    if (media_url) {
      const isVideo = media_url.endsWith(".mp4");

      const endpoint = isVideo ? "sendVideo" : "sendPhoto";

      const payload = {
        chat_id,
        caption: text || "",
        parse_mode: "HTML"
      };

      payload[isVideo ? "video" : "photo"] = media_url;

      const res = await axios.post(`${BASE_URL}/${endpoint}`, payload);

      log("✅ Telegram media sent:", res.data.result.message_id);

      return {
        success: true,
        external_post_id: res.data.result.message_id
      };
    }

    // ───────────────────────────────
    // 📝 TEXT POST
    // ───────────────────────────────
    const res = await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id,
      text,
      parse_mode: "HTML"
    });

    log("✅ Telegram message sent:", res.data.result.message_id);

    return {
      success: true,
      external_post_id: res.data.result.message_id
    };

  } catch (error) {
    log("❌ Telegram publish error:", error.message);

    return {
      success: false,
      error: error?.response?.data || error.message
    };
  }
}
