import express from "express";
import axios from "axios";
import db from "../db.js";
import dotenv from "dotenv";

dotenv.config();
const router = express.Router();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;


router.get("/telegram/connect/:clientId", async (req, res) => {
  const { clientId } = req.params;

  try {
    const response = await axios.get(`${BASE_URL}/getUpdates`);
    const updates = response.data.result;

    if (!updates.length) {
      return res.send("❌ No Telegram updates found. Post once in the channel.");
    }

    // ✅ Take the latest update
    const lastUpdate = updates[updates.length - 1];

    // ✅ Support CHANNEL + GROUP + DM
    const chat =
      lastUpdate.message?.chat ||
      lastUpdate.channel_post?.chat;

    if (!chat) {
      return res.send("❌ No valid Telegram chat found.");
    }

    const chatId = chat.id;
    const username = chat.username || chat.title || null;

    await db.query(
      `INSERT INTO telegram_accounts (client_id, chat_id, username)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE chat_id = VALUES(chat_id)`,
      [clientId, chatId, username]
    );

    res.json({
      success: true,
      chat_id: chatId,
      username
    });

  } catch (err) {
    console.error("Telegram connect error:", err.message);
    res.status(500).json({ error: "Telegram connection failed" });
  }
});


export default router;
