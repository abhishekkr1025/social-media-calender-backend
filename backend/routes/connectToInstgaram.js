// routes/instagram.js
import express from "express";
import axios from "axios";
import db from "../db.js";
import dotenv from "dotenv";
import cors from 'cors';

dotenv.config();

const router = express.Router();

const FB_API_VERSION = "v24.0";
const APP_ID = process.env.FACEBOOK_APP_ID;
const APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const REDIRECT_URI = process.env.FB_REDIRECT_URI;

// // ✅ Allow CORS requests from your frontend
router.use( 
  cors({
     origin: [
    'http://localhost:5173',
    'http://prod.panditjee.com',
    'http://prod.panditjee.com:5000'
  ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  })
);

// STEP 1: Redirect user to Facebook login
router.get("/instagram/login/:clientId", (req, res) => {
  const { clientId } = req.params;

const url = `https://www.facebook.com/${FB_API_VERSION}/dialog/oauth
?client_id=${APP_ID}
&redirect_uri=${REDIRECT_URI}?clientId=${clientId}
&scope=instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,email`
.replace(/\s+/g, '');


  res.redirect(url);
});

// STEP 2: Meta redirects here with CODE
router.get("/instagram/callback", async (req, res) => {
  const { code, clientId } = req.query;

  try {
    // STEP A: Exchange code → short-lived token
    const tokenResp = await axios.get(
      `https://graph.facebook.com/${FB_API_VERSION}/oauth/access_token`,
      {
        params: {
          client_id: APP_ID,
          redirect_uri: `${REDIRECT_URI}?clientId=${clientId}`,
          client_secret: APP_SECRET,
          code,
        },
      }
    );

    const shortToken = tokenResp.data.access_token;

    // STEP B: Exchange short → long-lived token
    const longResp = await axios.get(
      `https://graph.facebook.com/${FB_API_VERSION}/oauth/access_token`,
      {
        params: {
          grant_type: "fb_exchange_token",
          client_id: APP_ID,
          client_secret: APP_SECRET,
          fb_exchange_token: shortToken,
        },
      }
    );

    const longToken = longResp.data.access_token;

    // STEP C: Fetch pages user manages
    const pagesResp = await axios.get(
      `https://graph.facebook.com/${FB_API_VERSION}/me/accounts`,
      { params: { access_token: longToken } }
    );

    let foundIG = null;

    for (const page of pagesResp.data.data) {
      // Check if page has IG business account
      const igResp = await axios.get(
        `https://graph.facebook.com/${FB_API_VERSION}/${page.id}`,
        {
          params: {
            fields: "instagram_business_account",
            access_token: longToken,
          },
        }
      );

      if (igResp.data.instagram_business_account) {
        foundIG = {
          instagram_id: igResp.data.instagram_business_account.id,
          page_id: page.id,
        };
        break;
      }
    }

    if (!foundIG) {
      return res.send(
        "⚠ No Instagram Business Account linked to this Facebook profile."
      );
    }

    // STEP D: Save to DB
    await db.query(
      `INSERT INTO instagram_accounts 
        (client_id, instagram_account_id, access_token, token_expires_at, username)
       VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 60 DAY), NULL)
       ON DUPLICATE KEY UPDATE access_token = VALUES(access_token)`,
      [clientId, foundIG.instagram_id, longToken]
    );

    res.send("🎉 Instagram Connected Successfully!");
  } catch (err) {
    console.log("IG Connect Error:", err.response?.data || err.message);
    res.send("❌ Instagram Connection Failed.");
  }
});

export default router;
