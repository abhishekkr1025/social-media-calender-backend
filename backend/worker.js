// worker.js
import dotenv from "dotenv";
dotenv.config();

import db from "./db.js";
import { sleep, backoff, log } from "./utils.js";

import * as IG from "./services/instagram.js";
import * as LI from "./services/linkedin.js";
import * as TW from "./services/twitter.js";
import * as FB from "./services/facebook.js";
import * as YT from "./services/youtube.js";
import * as WP from "./services/wordpress.js";



const POLL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS || "5000");
const BATCH_SIZE = parseInt(process.env.WORKER_BATCH_SIZE || "5");
const MAX_ATTEMPTS = parseInt(process.env.MAX_ATTEMPTS || "5");
const WORKER_ID = process.env.WORKER_ID || `worker-${Math.floor(Math.random() * 10000)}`;
// Optional grace window to avoid micro-second drift (in seconds)
const GRACE_SECONDS = parseInt(process.env.WORKER_GRACE_SECONDS || "2");

// Helper: return ISO-like DATETIME string for logging
function nowStr() {
  return new Date().toISOString();
}

export async function claimAndProcessBatch() {
  const conn = await db.getConnection();

  try {
    // Start transaction so SELECT ... FOR UPDATE locks rows for this connection
    await conn.beginTransaction();

    // 1) Select candidate rows and lock them
    // We add a small grace window so posts scheduled exactly at now() don't get raced or immediate
    const [rows] = await conn.query(
      `SELECT * FROM queued_posts
       WHERE status = 'queued'
         AND scheduled_at <= DATE_ADD(NOW(), INTERVAL ? SECOND)
         AND (next_retry_at IS NULL OR next_retry_at <= NOW())
       ORDER BY priority ASC, scheduled_at ASC
       LIMIT ? FOR UPDATE`,
      [GRACE_SECONDS, BATCH_SIZE]
    );

    if (!rows.length) {
      await conn.commit();
      return 0;
    }

    const claimedIds = rows.map(r => r.id);

    // 2) Mark them as processing and attach worker info (atomic)
    await conn.query(
      `UPDATE queued_posts
       SET status = 'processing', locked_by = ?, locked_at = NOW(), last_attempt_at = NOW()
       WHERE id IN (?) AND status = 'queued'`,
      [WORKER_ID, claimedIds]
    );

    // Commit claim so other workers don't see them as queued
    await conn.commit();

    // 3) Process each job outside transaction (so processing can take time)
    for (const row of rows) {
      // Re-fetch latest row to get attempts count (avoid stale data)
      const [[freshRows]] = await db.query(`SELECT * FROM queued_posts WHERE id = ?`, [row.id]);
      const fresh = freshRows || row;

      try {
        log(nowStr(), WORKER_ID, "processing job", row.id, row.platform, "post", row.post_id);

        // Check idempotency: if a published_posts exists for this post+platform, skip
        const [already] = await db.query(
          `SELECT COUNT(*) as cnt FROM published_posts WHERE post_id = ? AND platform = ? AND status = 'success'`,
          [row.post_id, row.platform]
        );
        if (already[0].cnt > 0) {
          await db.query(
            `UPDATE queued_posts SET status = 'posted', updated_at = NOW() WHERE id = ?`,
            [row.id]
          );
          log(nowStr(), WORKER_ID, "skipped job (already published)", row.id);
          continue;
        }

        const result = await processJob(row);

        if (result.success) {
          // success path
          await db.query(
            `UPDATE queued_posts SET status='posted', updated_at=NOW(), published_at=NOW() WHERE id=?`,
            [row.id]
          );

          await db.query(
            `INSERT INTO published_posts
             (post_id, client_id, platform, external_post_id, status, response, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [
              row.post_id,
              row.client_id,
              row.platform,
              result.external_post_id || null,
              "success",
              JSON.stringify(result.raw || result)
            ]
          );

          log(nowStr(), WORKER_ID, "job posted", row.id);
        } else {
          // failure path: increment attempts already accounted; compute next retry
          const attempts = (row.attempts || 0) + 1;
          const delayMs = backoff(attempts);
          const nextRetryAt = new Date(Date.now() + delayMs);

          const status = attempts >= MAX_ATTEMPTS ? "failed" : "queued";

          await db.query(
            `UPDATE queued_posts SET
               status = ?,
               attempts = ?,
               next_retry_at = ?,
               locked_by = NULL,
               locked_at = NULL,
               error_message = ?,
               updated_at = NOW()
             WHERE id = ?`,
            [
              status,
              attempts,
              status === "failed" ? null : nextRetryAt,
              (typeof result.error === "string" ? result.error : JSON.stringify(result.error || {})).substring(0, 2000),
              row.id
            ]
          );

          await db.query(
            `INSERT INTO published_posts
             (post_id, client_id, platform, external_post_id, status, response, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [
              row.post_id,
              row.client_id,
              row.platform,
              null,
              "failed",
              JSON.stringify({ error: result.error || null })
            ]
          );

          log(nowStr(), WORKER_ID, "job failed", row.id, "next retry", nextRetryAt.toISOString());
        }
      } catch (procErr) {
        // Unexpected processing error — requeue with delay
        const attempts = (row.attempts || 0) + 1;
        const nextRetryAt = new Date(Date.now() + backoff(attempts));
        await db.query(
          `UPDATE queued_posts SET
             status = ?,
             attempts = ?,
             next_retry_at = ?,
             locked_by = NULL,
             locked_at = NULL,
             error_message = ?,
             updated_at = NOW()
           WHERE id = ?`,
          [
            attempts >= MAX_ATTEMPTS ? "failed" : "queued",
            attempts,
            attempts >= MAX_ATTEMPTS ? null : nextRetryAt,
            (procErr.message || JSON.stringify(procErr)).substring(0, 2000),
            row.id
          ]
        );

        await db.query(
          `INSERT INTO published_posts
           (post_id, client_id, platform, external_post_id, status, response, created_at)
           VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [
            row.post_id,
            row.client_id,
            row.platform,
            null,
            "failed",
            JSON.stringify({ error: procErr.message || procErr })
          ]
        );

        log(nowStr(), WORKER_ID, "processing exception for job", row.id, procErr);
      }
    }

    return rows.length;

  } catch (err) {
    try { await conn.rollback(); } catch (e) { }
    log(nowStr(), WORKER_ID, "Worker claim error", err);
    return 0;
  } finally {
    conn.release();
  }
}

// Process single job - uses platform services
async function processJob(row) {
  // load post
  const [[postRows]] = await db.query('SELECT * FROM posts WHERE id = ?', [row.post_id]);
  if (!postRows) return { success: false, error: 'Post not found' };
  const post = postRows;

  // choose platform
  if (row.platform === 'instagram') {
    const [accs] = await db.query('SELECT * FROM instagram_accounts WHERE client_id = ?', [row.client_id]);
    if (!accs.length) return { success: false, error: 'No instagram account connected for client' };
    const acc = accs[0];

    return IG.publishInstagram({
      instagramAccountId: acc.instagram_account_id,
      accessToken: acc.access_token,
      image_url: post.image_url,
      caption: post.caption || post.title || post.content || ''
    });
  }

  if (row.platform === 'linkedin') {
    const [accs] = await db.query('SELECT * FROM linkedin_accounts WHERE client_id = ?', [row.client_id]);
    if (!accs.length) return { success: false, error: 'No LinkedIn account' };
    const acc = accs[0];

    // ensure proper field name: person_urn must exist
    const personUrn = acc.person_urn || acc.linkedin_user_id || acc.linkedin_user; // fallback checks
    if (!personUrn) return { success: false, error: 'LinkedIn personUrn missing' };

    return LI.publishLinkedIn({
      personUrn,
      accessToken: acc.access_token,
      text: post.caption || post.title || post.content || '',
      image_url: post.image_url
    });
  }

  if (row.platform === 'twitter') {
    const [accs] = await db.query('SELECT * FROM twitter_accounts WHERE client_id = ?', [row.client_id]);
    if (!accs.length) return { success: false, error: 'No Twitter account' };
    const acc = accs[0];

    return TW.publishTwitter({
      oauth_token: acc.oauth_token,
      oauth_token_secret: acc.oauth_token_secret,
      status: post.caption || post.title || post.content || '',
      media_url: post.image_url
    });
  }

  if (row.platform === 'facebook') {
    const [accs] = await db.query('SELECT * FROM facebook_pages WHERE client_id = ?', [row.client_id]);
    if (!accs.length) return { success: false, error: 'No Facebook page' };
    const acc = accs[0];

    return FB.publishFacebook({
      pageId: acc.page_id,
      pageAccessToken: acc.access_token,
      message: post.caption || post.title || post.content || '',
      image_url: post.image_url
    });
  }

  if (row.platform === 'youtube') {
    const [accs] = await db.query(
      'SELECT * FROM youtube_accounts WHERE client_id = ?',
      [row.client_id]
    );

    if (!accs.length) return { success: false, error: 'No YouTube account connected' };

    const acc = accs[0];

    // // Refresh token if needed
    // const refreshed = await YT.refreshYouTubeToken({
    //   access_token: acc.access_token,
    //   refresh_token: acc.refresh_token
    // });

    // if (!refreshed.success) {
    //   return { success: false, error: refreshed.error };
    // }

    // // Update DB with new token
    // await db.query(
    //   `UPDATE youtube_accounts 
    //    SET access_token = ?, token_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND)
    //    WHERE id = ?`,
    //   [refreshed.access_token, refreshed.expires_in, acc.id]
    // );

    return YT.publishYouTube({
      youtube_channel_id: acc.youtube_channel_id,
      access_token: acc.access_token,
      refresh_token: acc.refresh_token,
      title: post.title || 'Untitled',
      description: post.caption || post.content || '',
      video_url: post.image_url   // IMPORTANT: your "image_url" field contains media URL
    });
  }


  if (row.platform === "wordpress") {
    const [accs] = await db.query(
      "SELECT * FROM wordpress_accounts WHERE client_id = ?",
      [row.client_id]
    );

    if (!accs.length) return { success: false, error: "No WordPress account" };
    const acc = accs[0];

    return WP.publishToWordPress({
      site_url: acc.site_url,
      username: acc.username,
      app_password: acc.app_password,
      title: post.title || "New Post",
      content: post.caption || post.content || "",
    });
  }





  return { success: false, error: `Unsupported platform ${row.platform}` };
}

export async function runWorkerLoop() {
  log('Worker started', WORKER_ID, 'poll interval', POLL_MS, 'batch', BATCH_SIZE);
  while (true) {
    try {
      const processed = await claimAndProcessBatch();
      if (processed === 0) {
        await sleep(POLL_MS);
      } else {
        // small delay to avoid tight-loop if many jobs
        await sleep(1000);
      }
    } catch (err) {
      log('Worker loop error', err);
      await sleep(POLL_MS);
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runWorkerLoop().catch(err => {
    console.error('Worker crashed', err);
    process.exit(1);
  });
}
