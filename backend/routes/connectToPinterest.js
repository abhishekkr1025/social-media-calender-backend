// routes/connectToPinterest.js
import express from "express";
import axios from "axios";
import db from "../db.js";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

const APP_ID = process.env.PINTEREST_APP_ID;
const APP_SECRET = process.env.PINTEREST_APP_SECRET;
const REDIRECT_URI = process.env.PINTEREST_REDIRECT_URI;

// Scopes needed to read the account, list boards, and publish pins
const SCOPES = ["user_accounts:read", "boards:read", "pins:read", "pins:write"].join(",");

const basicAuthHeader = () =>
  "Basic " + Buffer.from(`${APP_ID}:${APP_SECRET}`).toString("base64");

// Step 1: Redirect user to Pinterest login / consent
router.get("/pinterest/login/:clientId", (req, res) => {
  const { clientId } = req.params;

  console.log("Pinterest connect request for client:", clientId);

  const authorizeUrl =
    "https://www.pinterest.com/oauth/?" +
    new URLSearchParams({
      client_id: APP_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: SCOPES,
      state: clientId, // ← clientId carried through OAuth state
    }).toString();

  console.log("Redirecting user to:", authorizeUrl);
  res.redirect(authorizeUrl);
});

// Step 2: Callback after user authorizes
router.get("/pinterest/callback", async (req, res) => {
  const { code, state: clientId, error } = req.query;

  if (error) {
    console.log("Pinterest auth error:", error);
    return res.send("❌ Pinterest Connection Cancelled.");
  }

  try {
    // 1️⃣ Exchange authorization code for tokens
    const tokenResp = await axios.post(
      "https://api.pinterest.com/v5/oauth/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
      {
        headers: {
          Authorization: basicAuthHeader(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const {
      access_token,
      refresh_token,
      expires_in, // seconds (access token, ~30 days)
    } = tokenResp.data;

    const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

    // 2️⃣ Fetch the connected user account
    const me = await axios.get("https://api.pinterest.com/v5/user_account", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const pinterestUserId = me.data.id || null;
    const username = me.data.username || null;

    // 3️⃣ Grab the first board as a default (optional convenience)
    let defaultBoardId = null;
    try {
      const boards = await axios.get(
        "https://api.pinterest.com/v5/boards?page_size=25",
        { headers: { Authorization: `Bearer ${access_token}` } }
      );
      defaultBoardId = boards.data?.items?.[0]?.id || null;
    } catch (boardErr) {
      console.log("Could not fetch boards:", boardErr.response?.data || boardErr.message);
    }

    // 4️⃣ Store credentials
    await db.query(
      `INSERT INTO pinterest_accounts
        (client_id, pinterest_user_id, username, access_token, refresh_token, token_expires_at, default_board_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        pinterest_user_id = VALUES(pinterest_user_id),
        username          = VALUES(username),
        access_token      = VALUES(access_token),
        refresh_token     = VALUES(refresh_token),
        token_expires_at  = VALUES(token_expires_at),
        default_board_id  = VALUES(default_board_id)`,
      [clientId, pinterestUserId, username, access_token, refresh_token, tokenExpiresAt, defaultBoardId]
    );

    console.log(`✅ Pinterest connected for client ${clientId} (@${username})`);
    res.send("🎉 Pinterest Connected!");
  } catch (err) {
    console.log("PIN ERROR:", err.response?.data || err.message);
    res.send("❌ Pinterest Connection Failed.");
  }
});

export default router;