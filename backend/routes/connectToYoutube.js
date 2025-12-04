// routes/connectToYoutube.js
import express from "express";
import axios from "axios";
import db from "../db.js";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const router = express.Router();

// Google OAuth Config
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

router.use(
    cors({
        origin: "http://localhost:5173",
        methods: ["GET", "POST"],
        credentials: true,
    })
);

/**
 * ------------------------------------------------------
 * STEP 1: Redirect user to Google OAuth (YouTube access)
 * ------------------------------------------------------
 */
router.get("/youtube/login/:clientId", (req, res) => {
    const { clientId } = req.params;

    const scope = [
        "https://www.googleapis.com/auth/youtube",
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile"
    ].join(" ");


    const authUrl =
        `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${GOOGLE_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI)}` +
        `&state=${clientId}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scope)}` +
        `&access_type=offline` +
        `&include_granted_scopes=true` +
        `&prompt=select_account consent`;

    // force asking permissions

    res.redirect(authUrl);
});

/**
 * ------------------------------------------------------
 * STEP 2: Google redirects here with "code"
 * ------------------------------------------------------
 */
router.get("/youtube/callback", async (req, res) => {
    const { code, state: clientId } = req.query;

    try {
        // Exchange code → access token + refresh token
        const tokenResp = await axios.post(
            "https://oauth2.googleapis.com/token",
            {
                code,
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri: `${GOOGLE_REDIRECT_URI}`,
                grant_type: "authorization_code",
            }
        );

        const { access_token, refresh_token, expires_in } = tokenResp.data;

        if (!refresh_token) {
            return res.send("❌ No refresh token received. You must add &prompt=consent to always get it.");
        }


        console.log("🔍 Fetching YouTube channel with token:", access_token);

        // Get channel info
        const profileResp = await axios.get(
            "https://www.googleapis.com/youtube/v3/channels",
            {
                params: {
                    part: "snippet",
                    mine: true
                },
                headers: {
                    Authorization: `Bearer ${access_token}`
                }
            }
        );

        console.log("YT API Response:", profileResp.data);


        const channel = profileResp.data.items?.[0];
        if (!channel) {
            return res.send("❌ Unable to fetch YouTube channel.");
        }

        const ytChannelId = channel.id;
        const ytChannelName = channel.snippet.title;

        // Save account in DB
        await db.query(
            `INSERT INTO youtube_accounts
        (client_id, youtube_channel_id, channel_name, access_token, refresh_token, token_expires_at)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))
       ON DUPLICATE KEY UPDATE
         access_token = VALUES(access_token),
         refresh_token = VALUES(refresh_token),
         token_expires_at = VALUES(token_expires_at)`,
            [clientId, ytChannelId, ytChannelName, access_token, refresh_token, expires_in]
        );

        res.send("🎉 YouTube Connected Successfully!");

    } catch (err) {
        console.error("YT OAuth Error:", err.response?.data || err.message);
        res.send("❌ YouTube Connection Failed.");
    }
});

export default router;
