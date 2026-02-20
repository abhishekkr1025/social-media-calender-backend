// routes/wordpress.js
import express from "express";
import axios from "axios";
import db from "../db.js";

const router = express.Router();

// GET posts from connected site
router.get("/wordpress-sites/:id/posts", async (req, res) => {
  try {
    const { id } = req.params;

    const [[site]] = await db.query(
      "SELECT * FROM wordpress_accounts WHERE id = ?",
      [id]
    );

    if (!site) return res.status(404).json({ error: "Site not found" });

    const auth = Buffer.from(
      `${site.username}:${site.app_password}`
    ).toString("base64");

    const wpRes = await axios.get(
      `${site.site_url}${site.site_path || ""}/wp-json/wp/v2/posts?per_page=20`,
      {
        headers: {
          Authorization: `Basic ${auth}`
        }
      }
    );

    res.json(wpRes.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/wordpress-sites/:siteId/posts/:postId", async (req, res) => {
  try {
    const { siteId, postId } = req.params;
    const { title, content } = req.body;

    const [[site]] = await db.query(
      "SELECT * FROM wordpress_accounts WHERE id = ?",
      [siteId]
    );

    const auth = Buffer.from(
      `${site.username}:${site.app_password}`
    ).toString("base64");

    const wpRes = await axios.post(
      `${site.site_url}/wp-json/wp/v2/posts/${postId}`,
      { title, content },
      {
        headers: {
          Authorization: `Basic ${auth}`
        }
      }
    );

    res.json({ success: true, data: wpRes.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.delete("/wordpress-sites/:siteId/posts/:postId", async (req, res) => {
  try {
    const { siteId, postId } = req.params;

    const [[site]] = await db.query(
      "SELECT * FROM wordpress_accounts WHERE id = ?",
      [siteId]
    );

    const auth = Buffer.from(
      `${site.username}:${site.app_password}`
    ).toString("base64");

    await axios.delete(
      `${site.site_url}/wp-json/wp/v2/posts/${postId}?force=true`,
      {
        headers: {
          Authorization: `Basic ${auth}`
        }
      }
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;