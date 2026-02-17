

// server.js
import dotenv from 'dotenv';
dotenv.config();
import path from "path";

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
import { publishTelegram } from './services/telegram.js';


import instagramRoutes from './routes/connectToInstgaram.js';
import linkedinRoutes from './routes/connectToLinkedin.js';
import twitterRoutes from './routes/connectToTwiter.js';
import youtubeRoutes from './routes/connectToYoutube.js';
import wordpressRoutes from './routes/connectToWordpress.js';
import telegramRoutes from './routes/connectToTelegram.js';
// import { translateText } from './services/translate.js';
import axios from 'axios';


const app = express();

// body-parser is built into Express now
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


const allowedOrigins = [
  "http://localhost:5173",
  "https://social-media-calendar-frontend-ocxw.vercel.app"
];

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }

  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

app.use(
  session({
    secret: "super-secret-key", // change this
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // secure:false for localhost
  })
);

// const upload = multer({
//   dest: "uploads/"   // folder where files will be stored
// });

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });




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
    // const fileUrl = `http://20.40.44.179:5000/${file.path}`;

    const fileUrl = `https://prod.panditjee.com/uploads/${file.filename}`;


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


app.post("/api/wp-posts", upload.single("file"), async (req, res) => {
  try {
    const {
      clientId,
      title,
      content,
      excerpt,
      scheduled_at,
      language = "English",
      master_category_id
    } = req.body;

    if (!clientId || !title || !content || !scheduled_at) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    await db.query(
      `
      INSERT INTO wp_posts
      (client_id, title, content, excerpt, scheduled_at, status, language, master_category_id)
      VALUES (?, ?, ?, ?, ?, 'scheduled', ?)
      `,
      [
        clientId,
        title,
        content,
        excerpt || null,
        scheduled_at,
        language,
        master_category_id
      ]
    );

    res.json({ success: true });

  } catch (err) {
    console.error("WP POST ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});













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



app.delete("/api/deleteClient/:id", async (req, res) => {
  try {
    const clientId = req.params.id;
    console.log("🗑️ Deleting client with ID:", clientId);

    const [clients] = await db.query("SELECT * FROM clients WHERE id = ?", [clientId]);

    if (clients.length === 0) {
      return res.status(404).json({ error: "Client not found" });
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








app.get('/api/wp-posts', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM wp_posts ORDER BY scheduled_at ASC LIMIT 500'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch wp_posts' });
  }
});





// app.post('/api/posts', upload.array("files", 5), async (req, res) => {
//   try {
//     const {
//       clientId,
//       title,
//       content,
//       caption,
//       scheduled_at,
//       platforms
//     } = req.body;

//     let parsedPlatforms;
//     try {
//       parsedPlatforms = JSON.parse(platforms);
//     } catch {
//       parsedPlatforms = platforms;
//     }

//     if (
//       !clientId ||
//       !scheduled_at ||
//       !parsedPlatforms ||
//       !Array.isArray(parsedPlatforms) ||
//       parsedPlatforms.length === 0
//     ) {
//       return res.status(400).json({ error: 'Missing fields' });
//     }

//     // ✅ MULTIPLE FILES
//     const files = req.files;

//     if (!files || files.length === 0) {
//       return res.status(400).json({ error: "At least one file is required" });
//     }

//     const fileUrls = files.map(
//       file => `http://20.40.44.179:5000/${file.path}`
//     );

//     const conn = await db.getConnection();

//     try {
//       await conn.beginTransaction();

//       // 1️⃣ Insert post
//       const [postResult] = await conn.query(
//         `INSERT INTO posts 
//          (client_id, title, caption, scheduled_at, platforms, created_at)
//          VALUES (?, ?, ?, ?, ?, NOW())`,
//         [
//           clientId,
//           title || null,
//           caption || content || null,
//           scheduled_at,
//           JSON.stringify(parsedPlatforms)
//         ]
//       );

//       const postId = postResult.insertId;

//       // 2️⃣ Insert media (ONE ROW PER FILE)
//       const mediaPromises = fileUrls.map(url =>
//         conn.query(
//           `INSERT INTO post_media (post_id, media_url, created_at)
//            VALUES (?, ?, NOW())`,
//           [postId, url]
//         )
//       );

//       await Promise.all(mediaPromises);

//       // 3️⃣ Queue posts per platform
//       const queuePromises = parsedPlatforms.map(platform =>
//         conn.query(
//           `INSERT INTO queued_posts 
//            (post_id, client_id, platform, scheduled_at, status, created_at)
//            VALUES (?, ?, ?, ?, 'queued', NOW())`,
//           [postId, clientId, platform, scheduled_at]
//         )
//       );

//       await Promise.all(queuePromises);

//       await conn.commit();

//       res.json({
//         success: true,
//         postId,
//         files: fileUrls
//       });

//     } catch (err) {
//       await conn.rollback();
//       console.error("enqueue error", err);
//       res.status(500).json({ error: 'Failed to enqueue post', details: err.message });
//     } finally {
//       conn.release();
//     }

//   } catch (err) {
//     console.error("server error", err);
//     res.status(500).json({ error: 'Server error', details: err.message });
//   }
// });









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


// Admin: list queued jobs
app.get('/api/queued/:clientId', async (req, res) => {
  const { clientId } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT * FROM queued_posts where client_id = ? ORDER BY scheduled_at ASC LIMIT 500`,
      [clientId]
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
  } catch (e) { }

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
      platforms: post.platforms ? safeParsePlatforms(post.platforms) : []
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
    const {
      clientId,
      title,
      description,
      video_url,
      twitter_oauth_token,
      twitter_oauth_token_secret
    } = req.body;

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

    // 👇 Pass twitter credentials here
    const result = await publishYouTube({
      youtube_channel_id: rows[0].youtube_channel_id,
      access_token: rows[0].access_token,
      refresh_token: rows[0].refresh_token,
      title,
      description,
      video_url,

      twitter_credentials: {
        oauth_token: twitter_oauth_token,
        oauth_token_secret: twitter_oauth_token_secret
      }
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

app.post("/api/publish/telegram", async (req, res) => {
  try {
    const { clientId, text, media_url } = req.body;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        error: "clientId is required"
      });
    }

    if (!text && !media_url) {
      return res.status(400).json({
        success: false,
        error: "Either text or media_url is required"
      });
    }

    // 1️⃣ Fetch Telegram account for this client
    const [rows] = await db.query(
      `SELECT chat_id, username
       FROM telegram_accounts
       WHERE client_id = ?
       LIMIT 1`,
      [clientId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Telegram is not connected for this client"
      });
    }

    const { chat_id } = rows[0];

    // 2️⃣ Publish to Telegram
    const result = await publishTelegram({
      chat_id,
      text,
      media_url
    });

    // 3️⃣ Return response
    return res.json(result);

  } catch (err) {
    console.error("❌ Telegram publish error:", err);

    return res.status(500).json({
      success: false,
      error: "Telegram publish failed",
      details: err.message
    });
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

async function syncCategories(site) {
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const res = await axios.get(
      `${site.site_url}/wp-json/wp/v2/categories`,
      {
        params: { per_page: 100, page },
        auth: {
          username: site.username,
          password: site.app_password
        }
      }
    );

    totalPages = parseInt(res.headers["x-wp-totalpages"] || 1);

    for (const cat of res.data) {
      await db.query(
        `
        INSERT INTO wordpress_site_categories
        (site_id, wp_category_id, name, slug, parent_wp_id)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        slug = VALUES(slug),
        parent_wp_id = VALUES(parent_wp_id)
        `,
        [site.id, cat.id, cat.name, cat.slug, cat.parent]
      );
    }

    page++;
  }
}


app.post(
  "/api/wordpress-sites/:id/sync-categories",
  async (req, res) => {
    try {
      const siteId = req.params.id;

      const [rows] = await db.query(
        "SELECT * FROM wordpress_sites WHERE id = ?",
        [siteId]
      );

      if (!rows.length) {
        return res.status(404).json({ success: false });
      }

      await syncCategories(rows[0]); // your existing function

      res.json({ success: true });

    } catch (err) {
      console.error("Sync categories error:", err);
      res.status(500).json({ success: false });
    }
  }
);


app.get("/api/master-categories", async (req, res) => {
  const [rows] = await db.query(
    "SELECT * FROM master_categories ORDER BY name"
  );
  res.json(rows);
});

app.get("/api/master-categories", async (req, res) => {
  const [rows] = await db.query(
    "SELECT * FROM master_categories ORDER BY name"
  );
  res.json(rows);
});

// GET all mappings for a site
app.get("/api/site-category-mapping/:siteId", async (req, res) => {
  try {
    const { siteId } = req.params;

    const [rows] = await db.query(
      `
      SELECT 
        scm.master_category_id,
        scm.wp_category_id,
        mc.name AS master_category_name,
        wsc.name AS site_category_name,
        wsc.slug
      FROM site_category_mapping scm
      JOIN master_categories mc 
        ON scm.master_category_id = mc.id
      JOIN wordpress_site_categories wsc 
        ON scm.wp_category_id = wsc.wp_category_id
        AND scm.site_id = wsc.site_id
      WHERE scm.site_id = ?
      `,
      [siteId]
    );

    res.json(rows);

  } catch (err) {
    console.error("Get mapping error:", err);
    res.status(500).json({ error: "Failed to fetch mapping" });
  }
});

// GET single WordPress site
app.get("/api/wordpress-sites/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      `
      SELECT ws.*, c.name AS client_name
      FROM wordpress_sites ws
      LEFT JOIN clients c ON ws.client_id = c.id
      WHERE ws.id = ?
      `,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "WordPress site not found" });
    }

    res.json(rows[0]);

  } catch (err) {
    console.error("Fetch WordPress site error:", err);
    res.status(500).json({ error: "Failed to fetch WordPress site" });
  }
});


app.get("/api/wordpress-sites/:id/categories", async (req, res) => {
  const [rows] = await db.query(
    `SELECT wp_category_id, name, slug
     FROM wordpress_site_categories
     WHERE site_id = ?
     ORDER BY name`,
    [req.params.id]
  );

  res.json(rows);
});


app.post("/api/site-category-mapping/:siteId", async (req, res) => {
  const siteId = req.params.siteId;
  const mappings = req.body;

  for (const m of mappings) {
    await db.query(`
      INSERT INTO site_category_mapping
      (master_category_id, site_id, wp_category_id)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
      wp_category_id = VALUES(wp_category_id)
    `, [m.master_category_id, siteId, m.wp_category_id]);
  }

  res.json({ success: true });
});


app.post("/api/site-category-mapping/:siteId/auto-match", async (req, res) => {
  const siteId = req.params.siteId;

  const [masters] = await db.query(
    "SELECT id, name FROM master_categories"
  );

  const [siteCats] = await db.query(
    `SELECT wp_category_id, slug
     FROM wordpress_site_categories
     WHERE site_id = ?`,
    [siteId]
  );

  const mapping = {};

  for (const master of masters) {
    const normalized = master.name
      .toLowerCase()
      .replace(/\s+/g, "-");

    const match = siteCats.find(
      c => c.slug.toLowerCase() === normalized
    );

    if (match) {
      mapping[master.id] = match.wp_category_id;

      await db.query(`
        INSERT INTO site_category_mapping
        (master_category_id, site_id, wp_category_id)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
        wp_category_id = VALUES(wp_category_id)
      `, [master.id, siteId, match.wp_category_id]);
    }
  }

  res.json({ success: true, mapping });
});




app.get("/api/clients/:clientId/wordpress/account", async (req, res) => {
  const { clientId } = req.params;

  try {
    const [rows] = await db.query(
      `
      SELECT
        id,
        site_url,
        site_path,
        language,
        username,
        wp_user_id,
        created_at
      FROM wordpress_sites
      WHERE client_id = ?
      ORDER BY language ASC
      `,
      [clientId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        connected: false,
        sites: []
      });
    }

    res.json({
      connected: true,
      sites: rows
    });

  } catch (err) {
    console.error("❌ Wordpress multisite fetch error:", err);
    res.status(500).json({ error: "Failed to fetch WordPress sites" });
  }
});


app.get("/api/clients/:clientId/wordpress/site/:language", async (req, res) => {
  const { clientId, language } = req.params;

  const [rows] = await db.query(
    `
    SELECT *
    FROM wordpress_sites
    WHERE client_id = ? AND language = ?
    LIMIT 1
    `,
    [clientId, language]
  );

  if (!rows.length) {
    return res.status(404).json({ error: "Site not found" });
  }

  res.json(rows[0]);
});



app.get("/api/clients/:clientId/telegram/account", async (req, res) => {
  const { clientId } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT client_id, chat_id, username, created_at
       FROM telegram_accounts
       WHERE client_id = ?
       LIMIT 1`,
      [clientId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Telegram not connected" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("❌ Telegram fetch error:", err);
    res.status(500).json({ error: "Failed to fetch Telegram account" });
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

app.get("/api/published-posts/:clientId", async (req, res) => {
  const { clientId } = req.params;
  const [rows] = await db.query(`
    SELECT pp.*, p.title, p.caption, p.image_url
    FROM published_posts pp
    JOIN posts p ON p.id = pp.post_id
    where pp.client_id = ?
    ORDER BY pp.created_at DESC
  `, [clientId]);
  res.json(rows);
});

// 🟢 Get all WordPress sites (with client info)
app.get("/api/wordpress-sites", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        ws.id,
        ws.client_id,
        c.name AS client_name,
        ws.site_url,
        ws.site_path,
        ws.language,
        ws.username,
        ws.wp_user_id,
        ws.default_media_id,
        ws.created_at
      FROM wordpress_sites ws
      JOIN clients c ON c.id = ws.client_id
      ORDER BY ws.created_at DESC
    `);

    res.json(rows);
  } catch (error) {
    console.error("❌ Failed to fetch wordpress sites:", error);
    res.status(500).json({
      error: "Failed to fetch WordPress sites",
      details: error.message
    });
  }
});


// ✏️ Update WordPress site
app.put("/api/wordpress-sites/:id", async (req, res) => {
  const { id } = req.params;

  const {
    site_url,
    site_path,
    language,
    username,
    app_password,
    default_media_id
  } = req.body;

  try {
    if (!site_url || !username) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // 🔐 If password is provided → update it
    if (app_password && app_password.trim() !== "") {
      await db.query(
        `
        UPDATE wordpress_sites
        SET
          site_url = ?,
          site_path = ?,
          language = ?,
          username = ?,
          app_password = ?,
          default_media_id = ?
        WHERE id = ?
        `,
        [
          site_url,
          site_path || null,
          language,
          username,
          app_password,
          default_media_id || null,
          id
        ]
      );
    } else {
      // 🔐 Keep existing password
      await db.query(
        `
        UPDATE wordpress_sites
        SET
          site_url = ?,
          site_path = ?,
          language = ?,
          username = ?,
          default_media_id = ?
        WHERE id = ?
        `,
        [
          site_url,
          site_path || null,
          language,
          username,
          default_media_id || null,
          id
        ]
      );
    }

    res.json({ success: true });

  } catch (error) {
    console.error("❌ Failed to update WordPress site:", error);
    res.status(500).json({
      error: "Failed to update WordPress site",
      details: error.message
    });
  }
});


// 🔌 Test WordPress connection
app.post("/api/wordpress-sites/:id/test", async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await db.query(
      `
      SELECT site_url, site_path, username, app_password
      FROM wordpress_sites
      WHERE id = ?
      LIMIT 1
      `,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, error: "Site not found" });
    }

    const wp = rows[0];

    const baseUrl =
      wp.site_path
        ? `${wp.site_url.replace(/\/$/, "")}${wp.site_path}`
        : wp.site_url.replace(/\/$/, "");

    // 🔍 Test via WP REST API
    const response = await axios.get(
      `${baseUrl}/wp-json/wp/v2/users/me`,
      {
        auth: {
          username: wp.username,
          password: wp.app_password
        },
        timeout: 10000
      }
    );

    if (response.status === 200) {
      return res.json({
        success: true,
        user: response.data.name
      });
    }

    return res.json({ success: false });

  } catch (error) {
    console.error("❌ WP test connection failed:", error.message);

    return res.status(400).json({
      success: false,
      error: error.response?.data?.message || error.message
    });
  }
});

// ➕ Add new WordPress site
app.post("/api/add/wordpress-sites", async (req, res) => {
  try {
    const {
      client_id,
      site_url,
      site_path,
      language,
      username,
      app_password,
      default_media_id
    } = req.body;

    // 🔍 Basic validation
    if (!client_id || !site_url || !username || !app_password) {
      return res.status(400).json({
        success: false,
        error: "client_id, site_url, username, and app_password are required"
      });
    }

    // Normalize URL
    const cleanUrl = site_url.replace(/\/$/, "");

    // Insert
    const [result] = await db.query(
      `
      INSERT INTO wordpress_sites
      (
        client_id,
        site_url,
        site_path,
        language,
        username,
        app_password,
        default_media_id,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [
        client_id,
        cleanUrl,
        site_path || null,
        language,
        username,
        app_password,
        default_media_id || null
      ]
    );

    res.json({
      success: true,
      id: result.insertId
    });

  } catch (error) {
    console.error("❌ Failed to add WordPress site:", error);
    res.status(500).json({
      success: false,
      error: "Failed to add WordPress site",
      details: error.message
    });
  }
});







// CONNECT AUTH ROUTES AFTER MIDDLEWARE
app.use("/auth", instagramRoutes);
app.use("/auth", linkedinRoutes);
app.use("/auth", twitterRoutes);
app.use("/auth", youtubeRoutes);
app.use("/auth", wordpressRoutes);
app.use("/auth", telegramRoutes);
app.use("/uploads", express.static("uploads"));






const PORT = process.env.PORT || 5000;
app.listen(PORT, () => log(`API server listening on port ${PORT}`));
