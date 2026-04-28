import express from 'express';
import jwt from 'jsonwebtoken';
import db from '../db.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';

// ── LOGIN ────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });

  const [rows] = await db.query(
    'SELECT * FROM admin_users WHERE (username = ? OR email = ?) AND password = ? LIMIT 1',
    [username, username, password]
  );

  if (!rows.length)
    return res.status(401).json({ error: 'Invalid credentials' });

  const user = rows[0];

  const token = jwt.sign(
    { id: user.id, username: user.username,role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ token, username: user.username, role: user.role });
});

// ── INVITE (admin only) ──────────────────────────────────────
router.post('/invite', requireAuth,requireAdmin,  async (req, res) => {
  const { username, email, password, role = 'editor' } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'All fields required' });

  try {
    await db.query(
  'INSERT INTO admin_users (username, email, password, role) VALUES (?, ?, ?, ?)',
  [username, email, password, role]
);
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: 'Username or email already exists' });
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// GET all admin users (protected)
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  const [rows] = await db.query(
    'SELECT id, username, email, role ,created_at FROM admin_users ORDER BY created_at DESC'
  );
  res.json(rows);
});

// ── ME (validate token) ──────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username });
});

// ── MIDDLEWARE ───────────────────────────────────────────────
export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ error: 'Not authenticated' });

  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token expired or invalid' });
  }
}


export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
export default router;