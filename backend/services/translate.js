import axios from "axios";

/**
 * Translate text using internal AI service
 * @param {string} text
 * @param {string} language - e.g. "Hindi", "Tamil", "Telugu"
 */
export async function translateText({ text, language }) {
  if (!text || !language || language.toLowerCase() === "english") {
    return text;
  }

  const response = await axios.post("http://20.40.44.179:5010/translate", {
    user_id: "wp-scheduler",
    prompt: text,
    language,
    mode: "translate" // 🔥 IMPORTANT
  });

  return response.data.response.trim();
}

