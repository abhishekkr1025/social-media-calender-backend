import axios from "axios";

const TRANSLATE_SERVICE_URL = "http://20.40.44.179:5010/translate";

export async function translateText({ text, language }) {
  // Skip translation if not needed
  if (!text || !language || language === "English") {
    return text;
  }

  try {
    const res = await axios.post(
      TRANSLATE_SERVICE_URL,
      {
        text,        // ✅ REQUIRED
        language     // ✅ REQUIRED
      },
      {
        timeout: 60000
      }
    );

    return res.data.translated_text || text;
  } catch (err) {
    console.error(
      "❌ Translation service error:",
      err.response?.data || err.message
    );
    return text; // graceful fallback
  }
}
