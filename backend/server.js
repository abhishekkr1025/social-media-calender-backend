

// server.js
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bodyParser from 'body-parser';   // or remove this and use express.json()
import db from './db.js';
import { log } from './utils.js';
import cors from 'cors';
import session from "express-session";
import multer from "multer";

import { publishLinkedIn } from './services/linkedin.js';
import { publishTwitter } from './services/twitter.js';
import { publishInstagram } from './services/instagram.js';
import { publishFacebook } from './services/facebook.js';
import { publishYouTube } from './services/youtube.js';
import { publishWordPress } from './services/wordpress.js';


import instagramRoutes from './routes/connectToInstgaram.js';
import linkedinRoutes from './routes/connectToLinkedin.js';
import twitterRoutes from './routes/connectToTwiter.js';
import youtubeRoutes from './routes/connectToYoutube.js';
import wordpressRoutes from './routes/connectToWordpress.js';


const app = express();

const upload = multer({
  dest: "uploads/"   // folder where files will be stored
});


// If you want to avoid body-parser, you can replace this with: app.use(express.json());
app.use(bodyParser.json());

// // ✅ Allow CORS requests from your frontend
app.use(
  cors({
    origin: 'http://localhost:5173', // your React app’s URL
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  })
);

app.use(
  session({
    secret: "super-secret-key", // change this
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // secure:false for localhost
  })
);

// // 🟢 Get all clients
app.get("/api/clients", async (req, res) => {
  const [rows] = await db.query("SELECT * FROM clients ORDER BY joined_on DESC");
  res.json(rows);
});

// // 🟢 Add a new client
app.post("/api/clients", async (req, res) => {
  const { name, email } = req.body;
  const [result] = await db.query(
    "INSERT INTO clients (name, email) VALUES (?, ?)",
    [name, email]
  );

  res.json({
    success: true,
    id: result.insertId,   // <--- IMPORTANT
    message: "Client added successfully"
  });
});



app.delete("/api/deleteClient/:id", async(req, res) => {
  try {
    const clientId = req.params.id;
    console.log("🗑️ Deleting client with ID:", clientId);

    const [clients] = await db.query("SELECT * FROM clients WHERE id = ?", [clientId]);

    if(clients.length === 0) {
      return res.status(404).json({error: "Client not found"});
    }

    await db.query("DELETE FROM clients WHERE id = ?", [clientId]);

    console.log("✅ Client deleted successfully");

    res.json({
      message: "Client deleted successfully",
      deletedId: clientId
    });

  } catch (error) {
    console.error("❌ Error deleting client:", error);
    res.status(500).json({
      error: "Failed to delete this client",
      details: error.message
    });
  }
});

// 🗑️ Delete a post
app.delete("/api/deletePosts/:id", async (req, res) => {
  try {
    const postId = req.params.id;

    console.log("Deleting post with ID:", postId);

    // Check if post exists
    const [posts] = await db.query("SELECT * FROM posts WHERE id = ?", [postId]);

    if (posts.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }

    // Delete the post
    const [result] = await db.query("DELETE FROM posts WHERE id = ?", [postId]);

    console.log("✅ Post deleted successfully");

    res.json({
      message: "Post deleted successfully",
      deletedId: postId
    });
  } catch (error) {
    console.error("❌ Error deleting post:", error);
    res.status(500).json({
      error: "Failed to delete post",
      details: error.message
    });
  }
});

// Enqueue endpoint: create post + queued rows
// Expects body: { clientId, title, content, image_url, scheduled_at (ISO), platforms: ["instagram","linkedin"] }
// app.post('/api/posts', async (req, res) => {
//   try {
//     const {
//       clientId,
//       title,
//       content,
//       caption,
//       imageUrl,
//       scheduled_at,
//       platforms
//     } = req.body;

//     if (!clientId || !scheduled_at || !platforms || !Array.isArray(platforms) || platforms.length === 0) {
//       return res.status(400).json({ error: 'Missing fields' });
//     }

//     const conn = await db.getConnection();

//     try {
//       await conn.beginTransaction();

//       const [postResult] = await conn.query(
//         `INSERT INTO posts (client_id, title, caption, image_url, scheduled_at, platforms, created_at)
//          VALUES (?, ?, ?, ?, ?, ?, NOW())`,
//         [
//           clientId,
//           title || null,
//           caption || content || null,
//           imageUrl || null,
//           scheduled_at,
//           JSON.stringify(platforms)
//         ]
//       );

//       const postId = postResult.insertId;

//       // insert queued_posts - one row per platform
//       const insertPromises = platforms.map(platform => {
//         return conn.query(
//           `INSERT INTO queued_posts (post_id, client_id, platform, scheduled_at, status, created_at)
//            VALUES (?, ?, ?, ?, ?, NOW())`,
//           [postId, clientId, platform, scheduled_at, 'queued']
//         );
//       });

//       await Promise.all(insertPromises);

//       await conn.commit();
//       res.json({ success: true, postId });

//     } catch (err) {
//       await conn.rollback();
//       log('enqueue error', err);
//       res.status(500).json({ error: 'Failed to enqueue post', details: err.message });
//     } finally {
//       conn.release();
//     }

//   } catch (err) {
//     log('server error', err);
//     res.status(500).json({ error: 'Server error' });
//   }
// });

app.post('/api/posts', upload.single("file"), async (req, res) => {
  try {
    const {
      clientId,
      title,
      content,
      caption,
      scheduled_at,
      platforms
    } = req.body;

    let parsedPlatforms;

    try {
      parsedPlatforms = JSON.parse(platforms);
    } catch {
      parsedPlatforms = platforms;
    }

    if (!clientId || !scheduled_at || !parsedPlatforms || !Array.isArray(parsedPlatforms) || parsedPlatforms.length === 0) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    // ⬇️ File uploaded by Multer
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "File is required" });
    }

    // ⬇️ File URL accessible by worker
    const fileUrl = `http://localhost:5000/${file.path}`;

    const conn = await db.getConnection();

    try {
      await conn.beginTransaction();

      // 1️⃣ Insert main post
      const [postResult] = await conn.query(
        `INSERT INTO posts (client_id, title, caption, image_url, scheduled_at, platforms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          clientId,
          title || null,
          caption || content || null,
          fileUrl,                   // ⬅️ file used instead of imageUrl
          scheduled_at,
          JSON.stringify(parsedPlatforms)
        ]
      );

      const postId = postResult.insertId;

      // 2️⃣ Insert into queued_posts (one entry per platform)
      const insertPromises = parsedPlatforms.map(platform => {
        return conn.query(
          `INSERT INTO queued_posts (post_id, client_id, platform, scheduled_at, status, created_at)
           VALUES (?, ?, ?, ?, 'queued', NOW())`,
          [postId, clientId, platform, scheduled_at]
        );
      });

      await Promise.all(insertPromises);

      await conn.commit();

      res.json({
        success: true,
        postId,
        file: fileUrl
      });

    } catch (err) {
      await conn.rollback();
      console.error("enqueue error", err);
      res.status(500).json({ error: 'Failed to enqueue post', details: err.message });
    } finally {
      conn.release();
    }

  } catch (err) {
    console.error("server error", err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});





// Admin: list queued jobs
app.get('/api/queued', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM queued_posts ORDER BY scheduled_at ASC LIMIT 500'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
});

// safe JSON parser
function safeParsePlatforms(value) {
  if (!value) return [];

  if (Array.isArray(value)) return value;

  try {
    return JSON.parse(value);
  } catch (e) {}

  if (typeof value === 'string' && value.includes(',')) {
    return value.split(',').map(p => p.trim());
  }

  return [value.trim()];
}

app.get('/api/posts/all', async (req, res) => {
  let conn;

  try {
    conn = await db.getConnection();

    // 1️⃣ Fetch all main posts
    const [posts] = await conn.query(`
      SELECT 
        p.id,
        p.client_id AS clientId,
        p.title,
        p.caption,
        p.image_url AS imageUrl,
        p.scheduled_at,
        p.created_at,
        p.platforms
      FROM posts p
      ORDER BY p.created_at DESC
    `);

    // 2️⃣ Fetch queued posts
    const [queued] = await conn.query(`
      SELECT 
        q.id,
        q.post_id AS postId,
        q.client_id AS clientId,
        q.platform,
        q.scheduled_at,
        q.status,
        q.attempts,
        q.error_message,
        q.created_at
      FROM queued_posts q
      ORDER BY q.scheduled_at ASC
    `);

    // 3️⃣ Transform the posts to parse JSON platforms
    const formattedPosts = posts.map(post => ({
      ...post,
      platforms: post.platforms ? safeParsePlatforms(post.platforms):[]
    }));

    return res.json({
      success: true,
      posts: formattedPosts,
      queued_posts: queued
    });

  } catch (err) {
    console.error('❌ /api/posts/all error:', err);
    res.status(500).json({ error: 'Failed to fetch posts', details: err.message });
  } finally {
    if (conn) conn.release();
  }
});


app.post("/api/publish/instagram", async (req, res) => {
  try {
    const { instagramAccountId, accessToken, image_url, caption } = req.body;

    const result = await publishInstagram({
      instagramAccountId,
      accessToken,
      image_url,
      caption
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/publish/linkedin", async (req, res) => {
  try {
    const { personUrn, accessToken, text, image_url } = req.body;

    const result = await publishLinkedIn({
      personUrn,
      accessToken,
      text,
      image_url
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/publish/facebook", async (req, res) => {
  try {
    const { pageId, pageAccessToken, message, image_url } = req.body;

    const result = await publishFacebook({
      pageId,
      pageAccessToken,
      message,
      image_url
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/publish/twitter", async (req, res) => {
  try {
    const { oauth_token, oauth_token_secret, status, media_url } = req.body;

    const result = await publishTwitter({
      oauth_token,
      oauth_token_secret,
      status,
      media_url
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post("/api/publish/youtube", async (req, res) => {
  try {
    const { clientId, title, description, video_url } = req.body;

    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    // Fetch stored YouTube credentials for this client
    const [rows] = await db.query(
      `SELECT youtube_channel_id, access_token, refresh_token 
       FROM youtube_accounts 
       WHERE client_id = ? 
       LIMIT 1`,
      [clientId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "YouTube not connected for this client" });
    }

    const result = await publishYouTube({
      youtube_channel_id: rows[0].youtube_channel_id,
      access_token: rows[0].access_token,
      refresh_token: rows[0].refresh_token,
      title,
      description,
      video_url,
    });

    res.json(result);

  } catch (err) {
    console.error("❌ YouTube publish error:", err);
    res.status(500).json({ error: err.message });
  }
});




app.post("/api/publish/wordpress", async (req, res) => {
  try {
    const { clientId, title, content, media_url } = req.body;

    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    // 1️⃣ Fetch stored WordPress credentials
    const [rows] = await db.query(
      `SELECT site_url, username, app_password 
       FROM wordpress_accounts 
       WHERE client_id = ? 
       LIMIT 1`,
      [clientId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: "WordPress is not connected for this client",
      });
    }

    const { site_url, username, app_password } = rows[0];

    // 2️⃣ Publish via service
    const result = await publishWordPress({
      site_url,
      username,
      app_password,
      title,
      content,
      media_url,
    });

    // 3️⃣ Respond back to frontend
    res.json(result);

  } catch (err) {
    console.error("❌ WordPress publish error:", err);
    res.status(500).json({ error: err.message });
  }
});



app.get("/api/clients/:clientId/linkedin/account", async (req, res) => {
  const { clientId } = req.params;

  try {
    const [rows] = await db.query(`
      SELECT linkedin_user_id, access_token
      FROM linkedin_accounts
      WHERE client_id = ?
      LIMIT 1
    `, [clientId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "LinkedIn not connected" });
    }

    res.json(rows[0]);

    console.log(rows[0])

  } catch (error) {
    res.status(500).json({ error: "Failed to fetch LinkedIn account" });
  }
});


app.get("/api/clients/:clientId/instagram/account", async (req, res) => {
  try {
    const { clientId } = req.params;

    const [rows] = await db.query(
      `SELECT 
          id,
          instagram_account_id,
          username,
          profile_picture_url,
          token_expires_at
       FROM instagram_accounts
       WHERE client_id = ?`,
      [clientId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error fetching IG accounts:", err);
    res.status(500).json({ error: "Failed to fetch Instagram accounts" });
  }
});

// GET /api/clients/:clientId/twitter/account
app.get("/api/clients/:clientId/twitter/account", async (req, res) => {
  const { clientId } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT twitter_user_id, username, oauth_token, oauth_token_secret
       FROM twitter_accounts
       WHERE client_id = ?
       LIMIT 1`,
      [clientId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Twitter not connected" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("❌ Twitter fetch error:", err);
    res.status(500).json({ error: "Failed to fetch Twitter account" });
  }
});


// GET /api/clients/:clientId/youtube/account
app.get("/api/clients/:clientId/youtube/account", async (req, res) => {
  const { clientId } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT youtube_channel_id, channel_name, access_token, refresh_token
       FROM youtube_accounts
       WHERE client_id = ?
       LIMIT 1`,
      [clientId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Twitter not connected" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("❌ Twitter fetch error:", err);
    res.status(500).json({ error: "Failed to fetch Twitter account" });
  }
});

app.get("/api/clients/:clientId/wordpress/account",async (req, res) => {
     const {clientId} = req.params;
  try {
    const [rows] = await db.query(
      `SELECT site_url, username, app_password, wp_user_id
       FROM wordpress_accounts
       WHERE client_id = ?
       LIMIT 1`,
      [clientId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Wordpress not connected" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("❌ Wordpress fetch error:", err);
    res.status(500).json({ error: "Failed to fetch Wordpress account" });
  }
})




app.get("/api/queued-posts", async (req, res) => {
  const [rows] = await db.query(`
    SELECT qp.*, p.title, p.caption, p.image_url 
    FROM queued_posts qp
    JOIN posts p ON p.id = qp.post_id
    ORDER BY qp.scheduled_at ASC
  `);
  res.json(rows);
});


app.get("/api/published-posts", async (req, res) => {
  const [rows] = await db.query(`
    SELECT pp.*, p.title, p.caption, p.image_url
    FROM published_posts pp
    JOIN posts p ON p.id = pp.post_id
    ORDER BY pp.created_at DESC
  `);
  res.json(rows);
});




// CONNECT AUTH ROUTES AFTER MIDDLEWARE
app.use("/auth", instagramRoutes);
app.use("/auth", linkedinRoutes);
app.use("/auth", twitterRoutes);
app.use("/auth", youtubeRoutes);
app.use("/auth", wordpressRoutes);
app.use("/uploads", express.static("uploads"));






const PORT = process.env.PORT || 5000;
app.listen(PORT, () => log(`API server listening on port ${PORT}`));
