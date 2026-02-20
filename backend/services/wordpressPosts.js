import express from "express";
import axios from "axios";
import db from "../db.js";

const router = express.Router();

/* =========================================
   Helper: Get WordPress Site Credentials
========================================= */
async function getSiteByPostId(postId) {
  const [[post]] = await db.query(
    "SELECT * FROM wp_posts WHERE id = ?",
    [postId]
  );

  if (!post) throw new Error("Post not found");

  const [[site]] = await db.query(
    "SELECT * FROM wordpress_accounts WHERE id = ?",
    [post.site_id]
  );

  if (!site) throw new Error("WordPress site not found");

  return { post, site };
}

function getAuthHeader(site) {
  return {
    Authorization:
      "Basic " +
      Buffer.from(
        `${site.username}:${site.app_password}`
      ).toString("base64"),
  };
}

/* =========================================
   1️⃣ GET ALL POSTS (Local DB)
========================================= */
router.get("/", async (req, res) => {
  try {
    const [posts] = await db.query(`
      SELECT p.*, c.name as client_name
      FROM wp_posts p
      LEFT JOIN clients c ON p.client_id = c.id
      ORDER BY p.created_at DESC
    `);

    res.json(posts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});

/* =========================================
   2️⃣ GET SINGLE POST
========================================= */
router.get("/:id", async (req, res) => {
  try {
    const [[post]] = await db.query(
      "SELECT * FROM wp_posts WHERE id = ?",
      [req.params.id]
    );

    if (!post) return res.status(404).json({ error: "Post not found" });

    res.json(post);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch post" });
  }
});

/* =========================================
   3️⃣ UPDATE POST (WP + DB)
========================================= */
router.put("/update/:id", async (req, res) => {
  try {
    const { title, content, status } = req.body;

    const { post, site } = await getSiteByPostId(req.params.id);

    // 🔹 Update WordPress
    const wpResponse = await axios.post(
      `${site.site_url}${site.site_path || ""}/wp-json/wp/v2/posts/${post.wp_post_id}`,
      {
        title,
        content,
        status,
      },
      {
        headers: {
          ...getAuthHeader(site),
          "Content-Type": "application/json",
        },
      }
    );

    // 🔹 Update Local DB
    await db.query(
      `UPDATE wp_posts 
       SET title=?, content=?, status=? 
       WHERE id=?`,
      [title, content, status, req.params.id]
    );

    res.json({
      success: true,
      id: post.id,
      title,
      content,
      status,
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to update post",
      details: err.response?.data || err.message,
    });
  }
});

/* =========================================
   4️⃣ DELETE POST (WP + DB)
========================================= */
router.delete("/delete/:id", async (req, res) => {
  try {
    const { post, site } = await getSiteByPostId(req.params.id);

    // 🔹 Delete from WordPress
    await axios.delete(
      `${site.site_url}${site.site_path || ""}/wp-json/wp/v2/posts/${post.wp_post_id}?force=true`,
      {
        headers: getAuthHeader(site),
      }
    );

    // 🔹 Delete from Local DB
    await db.query(
      "DELETE FROM wp_posts WHERE id = ?",
      [req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to delete post",
      details: err.response?.data || err.message,
    });
  }
});

export default router;
