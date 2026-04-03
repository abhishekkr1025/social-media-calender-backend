import dotenv from "dotenv";
dotenv.config();

import db from "./db.js";
import { sleep, log } from "./utils.js";
import { publishPanditjee } from "./services/panditjee.js";

const POLL_MS = 5000;
const BATCH_SIZE = 5;

function nowStr() {
  return new Date().toISOString();
}

async function processPanditjeeBatch() {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // 🔥 FETCH DIRECTLY FROM panditjee_scheduled_posts
    const [rows] = await conn.query(
      `SELECT * FROM panditjee_scheduled_posts
       WHERE status = 'scheduled'
         AND scheduled_at <= NOW()
       ORDER BY scheduled_at ASC
       LIMIT ? FOR UPDATE`,
      [BATCH_SIZE]
    );

    if (!rows.length) {
      await conn.commit();
      return 0;
    }

    const ids = rows.map(r => r.id);

    // mark processing
    await conn.query(
      `UPDATE panditjee_scheduled_posts
       SET status = 'processing'
       WHERE id IN (?)`,
      [ids]
    );

    await conn.commit();

    // process outside transaction
    for (const row of rows) {
      try {
        log(nowStr(), "Panditjee worker processing:", row.id);

        // get credentials
        const [accs] = await db.query(
          "SELECT access_token, user_id FROM panditjee_users WHERE client_id = ?",
          [row.client_id]
        );

        if (!accs.length) {
          throw new Error("Panditjee not connected");
        }

        const acc = accs[0];

        // 🔥 CALL SERVICE
        const result = await publishPanditjee({
          access_token: acc.access_token,
          influencerUserId: acc.user_id,
          caption: row.caption,
          media_url: row.short_url,   // or media_url column if you add it
          scheduleId: row.id
        });

        if (!result.success) {
          throw new Error(result.error);
        }

        log(nowStr(), "✅ Panditjee post success:", row.id);

      } catch (err) {
        log("❌ Panditjee worker error:", err.message);

        await db.query(
          `UPDATE panditjee_scheduled_posts
           SET status = 'failed', error = ?
           WHERE id = ?`,
          [err.message, row.id]
        );
      }
    }

    return rows.length;

  } catch (err) {
    await conn.rollback();
    log("❌ Panditjee worker transaction error:", err);
    return 0;
  } finally {
    conn.release();
  }
}

// 🔁 LOOP
async function runPanditjeeWorker() {
  log("🚀 Panditjee Worker started");

  while (true) {
    try {
      const processed = await processPanditjeeBatch();

      if (processed === 0) {
        await sleep(POLL_MS);
      } else {
        await sleep(1000);
      }

    } catch (err) {
      log("Worker loop error:", err);
      await sleep(POLL_MS);
    }
  }
}

runPanditjeeWorker();