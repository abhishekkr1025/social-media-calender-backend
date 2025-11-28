// routes/linkedin.js
import express from "express";
import axios from "axios";
import db from "../db.js";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI;

// STEP 1: Redirect user → LinkedIn OAuth
// router.get("/linkedin/login/:clientId", (req, res) => {
//   const { clientId } = req.params;

// //   const url =
// //     `https://www.linkedin.com/oauth/v2/authorization?` +
// //     `response_type=code&` +
// //     `client_id=${CLIENT_ID}&` +
// //     `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
// //     `scope=openid%20profile%20email%20w_member_social&` +
// //     `state=${clientId}`; // ← pass clientId safely

//  const url =
//     `https://www.linkedin.com/oauth/v2/authorization?` +
//     `response_type=code&` +
//     `client_id=${CLIENT_ID}&` +
//     `redirect_uri=${encodeURIComponent(process.env.LINKEDIN_REDIRECT_URI)}&` +
//     `scope=openid%20profile%20email%20w_member_social&` +
//     `state=${clientId}`;   // store clientId safely here

//   res.redirect(url);
// });

router.get("/linkedin/login/:clientId", (req, res) => {
  const { clientId } = req.params;

  // put clientId inside state
  const state = JSON.stringify({ clientId });

  const authUrl = `https://www.linkedin.com/oauth/v2/authorization?` +
    `response_type=code&` +
    `client_id=${CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
    `state=${encodeURIComponent(state)}&` +
    `scope=${encodeURIComponent("openid profile email w_member_social")}`;

  res.redirect(authUrl);
});



// STEP 2: LinkedIn redirects back with authorization code
router.get("/linkedin/callback", async (req, res) => {
  const { code, state } = req.query;

  let clientId;
  try {
    clientId = JSON.parse(state).clientId;
  } catch {
    return res.status(400).send("Invalid state value");
  }

  try {
    const tokenResp = await axios.post(
      "https://www.linkedin.com/oauth/v2/accessToken",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.LINKEDIN_REDIRECT_URI, 
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const accessToken = tokenResp.data.access_token;

    const meResp = await axios.get("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const personUrn = `urn:li:person:${meResp.data.sub}`;

    await db.query(
      `INSERT INTO linkedin_accounts (client_id, linkedin_user_id, access_token)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE access_token=VALUES(access_token)`,
      [clientId, personUrn, accessToken]
    );

    res.send("LinkedIn Connected Successfully!");

  } catch (err) {
    console.error("LinkedIn error:", err.response?.data || err.message);
    res.status(400).send("LinkedIn Error");
  }
});



export default router;
