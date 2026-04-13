import express from "express";
import axios from "axios";
import FormData from "form-data";
import db from "../db.js";
import dotenv from "dotenv";
import { publishPanditjee } from "../services/panditjee.js";
import multer from "multer";

dotenv.config();
const router = express.Router();

const PANDITJEE_API = process.env.PANDITJEE_API_BASE;

const upload = multer({
  storage: multer.memoryStorage()
});

// =====================================================
// HELPER: GET USER TOKEN
// =====================================================
async function getUserToken(clientId) {
  const [rows] = await db.query(
    "SELECT access_token FROM panditjee_users WHERE client_id = ?",
    [clientId]
  );

  if (rows.length === 0) return null;
  return rows[0].access_token;
}

// =====================================================
// STEP 1: SEND OTP
// POST /panditjee/connect
// =====================================================
router.post("/panditjee/connect", async (req, res) => {
  const { phone, clientId } = req.body;

  if (!phone || !clientId) {
    return res.status(400).json({
      success: false,
      error: "phone and clientId are required"
    });
  }

  try {
    const response = await axios.post(
      `${PANDITJEE_API}/api/otp/sendOtp`,
      { mobileNumber: phone }
    );

    console.log("📲 OTP Sent:", response.data);

    return res.json({
      success: true,
      message: "OTP sent successfully",
      phone,
      clientId
    });

  } catch (err) {
    console.error("❌ Send OTP error:", err.response?.data || err.message);

    return res.status(500).json({
      success: false,
      error: "Failed to send OTP"
    });
  }
});

// =====================================================
// STEP 2: VERIFY OTP + STORE TOKEN
// POST /panditjee/verify
// =====================================================
router.post("/panditjee/verify", async (req, res) => {
  const { phone, otp, clientId } = req.body;

  if (!phone || !otp || !clientId) {
    return res.status(400).json({
      success: false,
      error: "phone, otp and clientId are required"
    });
  }

  try {
    const response = await axios.post(
      `${PANDITJEE_API}/api/otp/validateOtp`,
      {
        mobileNumber: phone,
        otp
      }
    );

    const data = response.data;

    if (data.status !== "SUCCESS") {
      return res.status(401).json({
        success: false,
        error: "Invalid OTP"
      });
    }

    const token = data.sessionToken || data.userProfile?.authToken;
    const user = data.userProfile;

    if (!token) {
      return res.status(500).json({
        success: false,
        error: "Token not received"
      });
    }

    // ✅ UPSERT USER
    await db.query(
      `INSERT INTO panditjee_users
        (client_id, phone, access_token, user_id)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         phone = VALUES(phone),
         access_token = VALUES(access_token),
         user_id = VALUES(user_id)`,
      [clientId, phone, token, user.userId]
    );

    console.log("✅ Panditjee Connected:", user.userId);

    return res.json({
      success: true,
      message: "Panditjee connected successfully",
      user: {
        id: user.userId,
        name: `${user.firstName} ${user.lastName}`,
        phone: user.phoneNo
      }
    });

  } catch (err) {
    console.error("❌ Verify OTP error:", err.response?.data || err.message);

    return res.status(500).json({
      success: false,
      error: "OTP verification failed"
    });
  }
});

// =====================================================
// STATUS CHECK
// GET /panditjee/account/:clientId
// =====================================================
router.get("/clients/:clientId/panditjee/account", async (req, res) => {
  const { clientId } = req.params;

  try {
    const [rows] = await db.query(
      "SELECT phone, user_id FROM panditjee_users WHERE client_id = ?",
      [clientId]
    );

    if (rows.length > 0) {
      return res.json({
        connected: true,
        phone: rows[0].phone,
        userId: rows[0].user_id
      });
    }

    return res.json({ connected: false });

  } catch (err) {
    console.error("❌ Status error:", err.message);

    return res.status(500).json({
      connected: false
    });
  }
});

// =====================================================
// DISCONNECT
// DELETE /panditjee/disconnect/:clientId
// =====================================================
router.delete("/clients/:clientId/panditjee/disconnect", async (req, res) => {
  const { clientId } = req.params;

  try {
    await db.query(
      "DELETE FROM panditjee_users WHERE client_id = ?",
      [clientId]
    );

    console.log("🔌 Panditjee disconnected:", clientId);

    return res.json({ success: true });

  } catch (err) {
    console.error("❌ Disconnect error:", err.message);

    return res.status(500).json({
      success: false,
      error: "Disconnect failed"
    });
  }
});

// =====================================================
// CREATE POST
// POST /panditjee/post
// =====================================================
router.post("/panditjee/post", upload.single("file"), async (req, res) => {

  const clientId = req.body?.clientId;
  const caption = req.body?.caption;
  const scheduled_at = req.body?.scheduled_at;

  if (!clientId || !caption || !scheduled_at) {
    return res.status(400).json({
      success: false,
      error: "clientId, caption, scheduled_at required"
    });
  }

  try {
    let media_url = null;

    // ───────────────────────────────
    // OPTIONAL: HANDLE FILE UPLOAD
    // ───────────────────────────────
    if (req.file) {
      // 👉 TEMP (you should move to S3/Azure later)
      const filename = `uploads/${Date.now()}_${req.file.originalname}`;

      const fs = await import("fs");
      fs.writeFileSync(filename, req.file.buffer);

      media_url = filename; // store path
    }

    // ───────────────────────────────
    // INSERT INTO panditjee_scheduled_posts
    // ───────────────────────────────
    const [result] = await db.query(
      `INSERT INTO panditjee_scheduled_posts
       (client_id, caption, short_url, scheduled_at, status, created_at)
       VALUES (?, ?, ?, ?, 'scheduled', NOW())`,
      [
        clientId,
        caption,
        media_url,   // 👈 store media path/url
        scheduled_at
      ]
    );

    const scheduleId = result.insertId;

    return res.json({
      success: true,
      message: "Panditjee post scheduled successfully",
      scheduleId
    });

  } catch (err) {
    console.error("❌ Scheduling error:", err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

export default router;