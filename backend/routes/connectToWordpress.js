// routes/wordpress.js
import express from "express";
import axios from "axios";
import db from "../db.js";

const router = express.Router();

/**
 * Connect WordPress using Username + Application Password
 */
router.post("/wordpress/login", async (req, res) => {
  const {
    clientId,
    site_url,
    site_path,
    language,
    username,
    app_password
  } = req.body;


  if (!clientId || !site_url || !site_path || !language || !username || !app_password) {
    return res.status(400).json({ error: "Missing required fields" });
  }


  try {
    console.log("🌍 Validating WordPress credentials for:", site_url);
    const fullSiteUrl = `${site_url}${site_path}`;


    // Test Authentication
    const response = await axios.get(
      `${fullSiteUrl}/wp-json/wp/v2/users/me`,
      { auth: { username, password: app_password } }
    );


    if (!response.data?.id) {
      throw new Error("Unable to verify WordPress account");
    }

    console.log("✔ WordPress Auth Success:", response.data);

    // Save in database (hashed password optional)
   await db.query(
  `INSERT INTO wordpress_sites
   (client_id, site_url, site_path, language, username, app_password, wp_user_id)
   VALUES (?, ?, ?, ?, ?, ?, ?)
   ON DUPLICATE KEY UPDATE
     site_url = VALUES(site_url),
     site_path = VALUES(site_path),
     username = VALUES(username),
     app_password = VALUES(app_password),
     wp_user_id = VALUES(wp_user_id)
  `,
  [
    clientId,
    site_url,
    site_path,
    language,
    username,
    app_password,
    response.data.id
  ]
);



    res.json({
      success: true,
      message: "WordPress connected successfully",
      wordpress_user: response.data,
    });

  } catch (error) {
    console.error("❌ WP ERROR:", error.response?.data || error.message);

    res.status(400).json({
      success: false,
      error: "Invalid WordPress credentials or site does not support REST API",
      details: error.response?.data || error.message,
    });
  }
});

export default router;
