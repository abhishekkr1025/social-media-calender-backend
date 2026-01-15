import axios from "axios";

const TRANSLATE_SERVICE_URL = "http://20.40.44.179:5010/translate";

/**
 * Batch translation helper
 *
 * @param {Object} payload  { title, content, excerpt }
 * @param {String} language Target language (e.g. Hindi, Tamil)
 * @returns {Object}        Translated payload
 */
export async function translateText({ payload, language }) {
  // ✅ Guard clauses
  if (!payload || !language || language === "English") {
    return payload;
  }

  // Remove empty fields to avoid unnecessary translation
  const cleanPayload = Object.fromEntries(
    Object.entries(payload).filter(
      ([_, value]) => typeof value === "string" && value.trim() !== ""
    )
  );

  if (Object.keys(cleanPayload).length === 0) {
    return payload;
  }

  try {
    const res = await axios.post(
      TRANSLATE_SERVICE_URL,
      {
        text: cleanPayload, // 👈 send structured object
        language
      },
      {
        timeout: 60000
      }
    );

    /**
     * Expected response:
     * {
     *   translated_text: {
     *     title: "...",
     *     content: "...",
     *     excerpt: "..."
     *   }
     * }
     */

    const translated = res.data?.translated_text;

    // 🔐 Safety: merge original + translated
    return {
      ...payload,
      ...(typeof translated === "object" ? translated : {})
    };

  } catch (err) {
    console.error(
      "❌ Translation service error:",
      err.response?.data || err.message
    );

    // 🛟 Graceful fallback (return original text)
    return payload;
  }
}
