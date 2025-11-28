// routes/twitter.js
import express from "express";
import OAuth from "oauth-1.0a";
import crypto from "crypto";
import axios from "axios";
import db from "../db.js";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

const TW_KEY = process.env.TWITTER_API_KEY;
const TW_SECRET = process.env.TWITTER_API_SECRET;
const CALLBACK = process.env.TWITTER_REDIRECT_URI;

// OAuth 1.0a client
const oauth = OAuth({
  consumer: { key: TW_KEY, secret: TW_SECRET },
  signature_method: "HMAC-SHA1",
  hash_function(base, key) {
    return crypto.createHmac("sha1", key).update(base).digest("base64");
  },
});

// Step 1: Redirect user to Twitter login
router.get("/twitter/login/:clientId", async (req, res) => {
  const { clientId } = req.params;

  console.log("Twitter connect request for client:", clientId);

  try {
    const request = {
      url: "https://api.twitter.com/oauth/request_token",
      method: "POST",
      data: {
        // MUST include clientId in the callback or save in DB/session
        oauth_callback: `${CALLBACK}?clientId=${clientId}`
      },
    };

    const auth = oauth.authorize(request);

    const resp = await axios.post(request.url, null, {
      headers: oauth.toHeader(auth),
    });

    const params = new URLSearchParams(resp.data);

    const oauthToken = params.get("oauth_token");

    // Step: Build authorize redirect
    const authorizeUrl =
      `https://api.twitter.com/oauth/authorize?oauth_token=${oauthToken}&force_login=true`;

    // Step: Force logout → then redirect to authorize
    // const logoutUrl = `https://twitter.com/logout?redirect_after_logout=${encodeURIComponent(authorizeUrl)}`;

    console.log("Redirecting user to:", authorizeUrl);

    // THIS ensures the user is logged out and sees the login screen
    res.redirect(authorizeUrl);

  } catch (err) {
    console.error("Twitter Login Error:", err.response?.data || err.message);
    res.status(500).send("Twitter error: " + err.message);
  }
});


// Step 2: Callback after user authorizes
router.get("/twitter/callback", async (req, res) => {
  const { oauth_token, oauth_verifier, clientId } = req.query;

  //  console.log(clientId);

  // Retrieve clientId from session
  //   const clientId = req.session.twitterClientId;

  // ¸
  try {
    const request = {
      url: "https://api.twitter.com/oauth/access_token",
      method: "POST",
      data: { oauth_token, oauth_verifier },
    };

    const auth = oauth.authorize(request);

    const resp = await axios.post(request.url, null, {
      headers: oauth.toHeader(auth),
    });

    const params = new URLSearchParams(resp.data);

    const access = params.get("oauth_token");
    const secret = params.get("oauth_token_secret");
    const user_id = params.get("user_id");
    const screen_name = params.get("screen_name");
    console.log(`clientId: ${clientId}`)


    // Store OAuth credentials in DB
    await db.query(
      `INSERT INTO twitter_accounts
        (client_id, twitter_user_id, username, oauth_token, oauth_token_secret)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE oauth_token = VALUES(oauth_token)`,
      [clientId, user_id, screen_name, access, secret]
    );

    // req.session.twitterClientId = null;

    res.send("🎉 Twitter Connected!");
  } catch (err) {
    console.log("TW ERROR:", err.response?.data || err.message);
    res.send("❌ Twitter Connection Failed.");
  }
});

export default router;
