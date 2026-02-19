import axios from "axios";
import { log } from "../utils.js";
import FormData from "form-data";



const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

// export async function publishTelegram({ chat_id, text, media_url }) {
//   try {
//     if (!chat_id) throw new Error("Missing chat_id");

//     const safeChatId =
//       typeof chat_id === "string" && chat_id.startsWith("-")
//         ? Number(chat_id)
//         : chat_id;

//     const safeText =
//       text && text.length > 4000
//         ? text.slice(0, 3997) + "..."
//         : text;

//     if (media_url) {
//       const isVideo = media_url.endsWith(".mp4");

//       const payload = {
//         chat_id: safeChatId,
//         caption: safeText
//       };

//       payload[isVideo ? "video" : "photo"] = media_url;

//       const res = await axios.post(
//         `${BASE_URL}/${isVideo ? "sendVideo" : "sendPhoto"}`,
//         payload
//       );

//       return { success: true, external_post_id: res.data.result.message_id };
//     }

//     const res = await axios.post(`${BASE_URL}/sendMessage`, {
//       chat_id: safeChatId,
//       text: safeText
//     });

//     return { success: true, external_post_id: res.data.result.message_id };

//   } catch (error) {
//     log("❌ Telegram publish error:", error.response?.data || error.message);
//     return {
//       success: false,
//       error: error.response?.data || error.message
//     };
//   }
// }

export async function publishTelegram({ chat_id, text, media_url }) {
  try {
    if (!chat_id) throw new Error("Missing chat_id");

    const safeText =
      text && text.length > 4000
        ? text.slice(0, 3997) + "..."
        : text;

    if (media_url) {
      const isVideo = media_url.includes(".mp4"); // safer check

      // Download media
      const mediaResponse = await axios.get(media_url, {
        responseType: "arraybuffer"
      });

      const form = new FormData();

      form.append("chat_id", String(chat_id));
      form.append("caption", safeText || "");

      form.append(
        isVideo ? "video" : "photo",
        Buffer.from(mediaResponse.data), // 🔥 IMPORTANT
        {
          filename: isVideo ? "video.mp4" : "image.jpg",
          contentType: mediaResponse.headers["content-type"]
        }
      );

      const res = await axios.post(
        `${BASE_URL}/${isVideo ? "sendVideo" : "sendPhoto"}`,
        form,
        {
          headers: {
            ...form.getHeaders()
          }
        }
      );

      return { success: true, external_post_id: res.data.result.message_id };
    }

    const res = await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id,
      text: safeText
    });

    return { success: true, external_post_id: res.data.result.message_id };

  } catch (error) {
    log("❌ Telegram publish error:", error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}


