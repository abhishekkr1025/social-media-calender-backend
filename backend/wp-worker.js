import dotenv from "dotenv";
dotenv.config();

import db from "./db.js";
import { sleep, log } from "./utils.js";
import { publishWordPress } from "./services/wordpress.js";

const POLL_MS = 5000;
const BATCH_SIZE = 3;
const WORKER_ID = `wp-worker-${Math.floor(Math.random() * 10000)}`;

function nowStr() {
  return new Date().toISOString();
}

async function claimAndProcessWpBatch() {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `
      SELECT * FROM wp_posts
      WHERE status = 'scheduled'
        AND scheduled_at <= NOW()
      ORDER BY scheduled_at ASC
      LIMIT ?
      FOR UPDATE
      `,
      [BATCH_SIZE]
    );

    if (!rows.length) {
      await conn.commit();
      return 0;
    }

    const ids = rows.map(r => r.id);

    await conn.query(
      `
      UPDATE wp_posts
      SET status = 'processing', updated_at = NOW()
      WHERE id IN (?)
      `,
      [ids]
    );

    await conn.commit();

    for (const post of rows) {
      await processWpPost(post);
    }

    return rows.length;

  } catch (err) {
    await conn.rollback();
    log("❌ WP Worker claim error", err);
    return 0;
  } finally {
    conn.release();
  }
}

async function processWpPost(post) {
  try {
    log(nowStr(), WORKER_ID, "Publishing WP post", post.id);

    // Load WordPress credentials
    const [accs] = await db.query(
      "SELECT * FROM wordpress_accounts WHERE client_id = ?",
      [post.client_id]
    );

    if (!accs.length) {
      throw new Error("No WordPress account connected for client");
    }

    const wp = accs[0];

    const result = await publishWordPress({
      site_url: accs.site_url,
      username: accs.username,
      app_password: accs.app_password,

      title: post.title,
      content: post.content,
      excerpt: post.excerpt,

      status: "future",
      scheduled_at: post.scheduled_at,
      file: post.file
    });

    if (result.success) {
      await db.query(
        `UPDATE wp_posts
     SET status='published',
         wp_post_id=?,
         updated_at=NOW()
     WHERE id=?`,
        [result.external_post_id, row.id]
      );
    }


    log("✅ WP post published:", post.id, "→ WP ID:", result.postId);

  } catch (err) {
    await db.query(
      `
      UPDATE wp_posts
      SET status = 'failed',
          error_message = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [err.message?.substring(0, 2000), post.id]
    );

    log("❌ WP post failed:", post.id, err.message);
  }
}
async function runWpWorker() {
  log("🚀 WordPress Worker started", WORKER_ID);

  while (true) {
    try {
      const processed = await claimAndProcessWpBatch();
      if (processed === 0) {
        await sleep(POLL_MS);
      } else {
        await sleep(1000);
      }
    } catch (err) {
      log("❌ WP Worker loop error", err);
      await sleep(POLL_MS);
    }
  }
}

runWpWorker();
