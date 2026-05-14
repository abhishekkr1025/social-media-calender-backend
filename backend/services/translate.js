import axios from "axios";

const TRANSLATE_SERVICE_URL = "http://prod.panditjee.com:5010/translate";

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
        timeout: 180000
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


// import axios from "axios";

// const TRANSLATE_SERVICE_URL = "http://prod.panditjee.com:5010/translate";
// const TRANSLATE_TIMEOUT_MS = 300000; // 5 minutes

// /**
//  * Batch translate article into multiple languages
//  *
//  * @param {Object} payload   { title, content, excerpt }
//  * @param {Array}  languages ["Hindi", "Tamil", "French"]
//  *
//  * @returns {Object}
//  * {
//  *   Hindi:  { title, content, excerpt },
//  *   Tamil:  { title, content, excerpt }
//  * }
//  */
// export async function translateBatch({ payload, languages }) {

//   /* ---------------------------
//      🛡 Guard Clauses
//   ----------------------------*/

//   if (!payload || typeof payload !== "object") {
//     return {};
//   }

//   if (!Array.isArray(languages) || languages.length === 0) {
//     return {};
//   }

//   // Remove empty fields to reduce token usage
//   const cleanPayload = Object.fromEntries(
//     Object.entries(payload).filter(
//       ([_, value]) => typeof value === "string" && value.trim() !== ""
//     )
//   );

//   if (!Object.keys(cleanPayload).length) {
//     return {};
//   }

//   try {

//     console.log("🌍 Translating into:", languages.join(", "));

//     const response = await axios.post(
//       TRANSLATE_SERVICE_URL,
//       {
//         text: cleanPayload,   // structured object
//         languages             // array of languages
//       },
//       {
//         timeout: TRANSLATE_TIMEOUT_MS,
//         headers: {
//           "Content-Type": "application/json"
//         }
//       }
//     );

//     /**
//      * Expected Response:
//      * {
//      *   translations: {
//      *     Hindi:  { title: "...", content: "...", excerpt: "..." },
//      *     Tamil:  { ... }
//      *   }
//      * }
//      */

//     const translations = response.data?.translations;

//     if (!translations || typeof translations !== "object") {
//       console.warn("⚠ Invalid translation response format");
//       return {};
//     }

//     // Safety: ensure all requested languages exist
//     const safeTranslations = {};

//     for (const lang of languages) {
//       if (translations[lang]) {
//         safeTranslations[lang] = {
//           ...cleanPayload,
//           ...translations[lang]
//         };
//       } else {
//         console.warn(`⚠ Missing translation for ${lang}`);
//       }
//     }

//     return safeTranslations;

//   } catch (err) {

//     console.error(
//       "❌ Batch translation failed:",
//       err.response?.data || err.message
//     );

//     // Return empty map so worker can fallback to English
//     return {};
//   }
// }

