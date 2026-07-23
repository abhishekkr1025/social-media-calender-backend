import express from 'express';
import db from '../db.js';
import { requireAuth } from './auth.js';

const router = express.Router();

/**
 * @swagger
 * /api/article-generation:
 *   post:
 *     summary: Submit headlines for AI article generation
 *     tags: [Article Generation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [headlines]
 *             properties:
 *               headlines:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["India Q1 GDP growth rate 2026"]
 *     responses:
 *       200:
 *         description: Job IDs created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobIds:
 *                   type: array
 *                   items:
 *                     type: integer
 *       400:
 *         description: Invalid request body
 */
router.post('/article-generation', requireAuth, async (req, res) => {
    const { headlines } = req.body;

    if (!Array.isArray(headlines) || headlines.length === 0) {
        return res.status(400).json({ error: 'headlines must be a non-empty array' });
    }

    const jobIds = [];
    for (const headline of headlines) {
        const [result] = await db.query(
            'INSERT INTO article_generation_jobs (user_id, headline) VALUES (?, ?)',
            [req.user.id, headline]
        );
        jobIds.push(result.insertId);
    }

    res.json({ jobIds });
});

/**
 * @swagger
 * /api/article-generation/status:
 *   get:
 *     summary: Poll status of one or more generation jobs
 *     tags: [Article Generation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: ids
 *         required: true
 *         schema:
 *           type: string
 *         description: Comma-separated job IDs
 *         example: "1,2,3"
 *     responses:
 *       200:
 *         description: Job statuses
 */
router.get('/article-generation/status', requireAuth, async (req, res) => {
    const ids = req.query.ids.split(',');

    const [jobs] = await db.query(
        `SELECT j.*, g.id AS article_id, g.title, g.status AS article_status
         FROM article_generation_jobs j
         LEFT JOIN generated_articles g ON g.job_id = j.id
         WHERE j.id IN (?)`,
        [ids]
    );

    res.json(jobs);
});

/**
 * @swagger
 * /api/article-generation/{jobId}/draft:
 *   get:
 *     summary: Get the generated draft article and its sources
 *     tags: [Article Generation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Draft article with sources
 */
router.get('/article-generation/:jobId/draft', requireAuth, async (req, res) => {
    const [[article]] = await db.query(
        'SELECT * FROM generated_articles WHERE job_id = ?',
        [req.params.jobId]
    );
    const [sources] = await db.query(
        'SELECT * FROM article_sources WHERE job_id = ? AND fetch_status = "ok"',
        [req.params.jobId]
    );

    res.json({ article, sources });
});


/**
 * @swagger
 * /api/article-generation/{jobId}/reject:
 *   post:
 *     summary: Reject a draft
 *     tags: [Article Generation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Rejected
 */
router.post('/article-generation/:jobId/approve', requireAuth, async (req, res) => {
    const jobId = req.params.jobId;

    const [[article]] = await db.query(
        'SELECT * FROM generated_articles WHERE job_id = ?',
        [jobId]
    );
    if (!article) {
        return res.status(404).json({ error: 'Draft not found' });
    }

    await db.query(
        'UPDATE generated_articles SET status = "approved", reviewed_by = ?, reviewed_at = NOW() WHERE job_id = ?',
        [req.user.id, jobId]
    );
    await db.query(
        'UPDATE article_generation_jobs SET status = "approved" WHERE id = ?',
        [jobId]
    );

    await db.query(
        'INSERT INTO publish_queue (title, body, source_type) VALUES (?, ?, ?)',
        [article.title, article.body, 'ai_generated']
    );

    res.json({ status: 'approved' });
});

/**
 * @swagger
 * /api/article-generation/{jobId}/reject:
 *   post:
 *     summary: Reject a draft
 *     tags: [Article Generation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Rejected
 */
router.post('/article-generation/:jobId/reject', requireAuth, async (req, res) => {
    await db.query(
        'UPDATE generated_articles SET status = "rejected", reviewed_by = ? WHERE job_id = ?',
        [req.user.id, req.params.jobId]
    );
    await db.query(
        'UPDATE article_generation_jobs SET status = "rejected" WHERE id = ?',
        [req.params.jobId]
    );

    res.json({ status: 'rejected' });
});

export default router;