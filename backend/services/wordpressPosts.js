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

  console.log(post);

  if (!post) throw new Error("Post not found");

  const [[site]] = await db.query(
    "SELECT * FROM wordpress_sites WHERE id = ?",
    [post.site_id]
  );

  console.log(site);

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
   4️⃣ DELETE POST (Local DB only)
   Called after all translations for this
   post have already been deleted from WP.
   This just removes the scheduling/master
   entry so the worker won't process it.
========================================= */
router.delete("/delete/:id", async (req, res) => {
  try {
    const [result] = await db.query(
      "DELETE FROM wp_posts WHERE id = ?",
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Post not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Failed to delete post",
      details: err.message,
    });
  }
});

/* =========================================
   5️⃣ TRIGGER PIPELINE NOW
   Re-queues this post so the worker's next
   poll (≈5s) picks it up immediately instead
   of waiting for scheduled_at.
========================================= */
router.put("/trigger/:id", async (req, res) => {
  try {
    const [[post]] = await db.query(
      "SELECT * FROM wp_posts WHERE id = ?",
      [req.params.id]
    );

    if (!post) return res.status(404).json({ error: "Post not found" });

    if (post.status === "processing") {
      return res.status(409).json({ error: "Post is already being processed" });
    }

    await db.query(
      `UPDATE wp_posts
       SET status = 'scheduled', scheduled_at = NOW(), error_message = NULL, cancel_requested = 0
       WHERE id = ?`,
      [req.params.id]
    );

    res.json({
      success: true,
      message: "Queued. The worker will pick this up within a few seconds.",
    });
  } catch (err) {
    console.error("Trigger error:", err);
    res.status(500).json({ error: "Failed to trigger post", details: err.message });
  }
});

/* =========================================
   6️⃣ HALT PIPELINE
   - If still 'scheduled' (worker hasn't claimed
     it yet): cancel instantly, no worker involved.
   - If 'processing': set a cooperative flag the
     worker checks between sites. Stops after the
     current site's publish call completes.
========================================= */
router.put("/halt/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Case 1: not yet claimed — cancel immediately
    const [immediate] = await db.query(
      `UPDATE wp_posts
       SET status = 'failed', error_message = 'Cancelled by user before starting'
       WHERE id = ? AND status = 'scheduled'`,
      [id]
    );
    if (immediate.affectedRows > 0) {
      return res.json({ success: true, message: "Cancelled before the worker picked it up." });
    }

    // Case 2: currently processing — request cooperative halt
    const [requested] = await db.query(
      `UPDATE wp_posts SET cancel_requested = 1 WHERE id = ? AND status = 'processing'`,
      [id]
    );
    if (requested.affectedRows > 0) {
      return res.json({
        success: true,
        message: "Halt requested — it will stop after the current site finishes publishing.",
      });
    }

    return res.status(409).json({ error: "This post isn't scheduled or processing; nothing to halt." });
  } catch (err) {
    console.error("Halt error:", err);
    res.status(500).json({ error: "Failed to halt post", details: err.message });
  }
});

export default router;