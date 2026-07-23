import express from 'express';
import multer from 'multer';
import db from '../db.js';
import { requireAuth } from './auth.js';

const router = express.Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/json' || file.originalname.endsWith('.json')) {
            cb(null, true);
        } else {
            cb(new Error('Only .json files are accepted'));
        }
    }
});

/**
    Validate a single article entry from the uploaded file
*/
function validateArticle(item) {
    if (!item.title || typeof item.title !== 'string' || !item.title.trim()) {
        return 'Missing or invalid title';
    }
    if (item.title.length > 255) {
        return 'Title exceeds 255 characters';
    }
    if (!item.content || typeof item.content !== 'string' || !item.content.trim()) {
        return 'Missing or invalid content';
    }
    return null;
}

/**
    Parse and validate an optional scheduled_at value
    Returns { date, error }
*/
function resolveScheduledAt(rawValue) {
    if (!rawValue) {
        return { date: new Date(), error: null };
    }

    const parsed = new Date(rawValue);
    if (isNaN(parsed.getTime())) {
        return { date: null, error: 'Invalid scheduled_at format' };
    }

    return { date: parsed, error: null };
}

/**
    Upload a JSON file of ready-to-publish articles
    Each article is inserted into wp_posts, which wpWorker.js already polls
    for translation + multisite WordPress publishing
*/
router.post('/api/bulk-import', requireAuth, upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const clientId = req.body.client_id;
    if (!clientId) {
        return res.status(400).json({ error: 'client_id is required' });
    }

    let articles;
    try {
        articles = JSON.parse(req.file.buffer.toString('utf-8'));
    } catch (err) {
        return res.status(400).json({ error: 'Invalid JSON file', details: err.message });
    }

    if (!Array.isArray(articles) || articles.length === 0) {
        return res.status(400).json({ error: 'JSON must be a non-empty array of articles' });
    }

    const [batchResult] = await db.query(
        'INSERT INTO bulk_import_batches (uploaded_by, filename, client_id, total_articles, status) VALUES (?, ?, ?, ?, ?)',
        [req.user.id, req.file.originalname, clientId, articles.length, 'processing']
    );
    const batchId = batchResult.insertId;

    let successCount = 0;
    let failedCount = 0;

    for (const item of articles) {
        const validationError = validateArticle(item);

        if (validationError) {
            await db.query(
                'INSERT INTO bulk_import_items (batch_id, title, status, error_message) VALUES (?, ?, ?, ?)',
                [batchId, item.title || '(no title)', 'failed', validationError]
            );
            failedCount++;
            continue;
        }

        const { date: scheduledAt, error: scheduleError } = resolveScheduledAt(item.scheduled_at);

        if (scheduleError) {
            await db.query(
                'INSERT INTO bulk_import_items (batch_id, title, status, error_message) VALUES (?, ?, ?, ?)',
                [batchId, item.title, 'failed', scheduleError]
            );
            failedCount++;
            continue;
        }

        try {
            const [postResult] = await db.query(
                `INSERT INTO wp_posts
                    (client_id, title, content, excerpt, featured_image_url, scheduled_at, status, master_category_id, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, NOW(), NOW())`,
                [
                    clientId,
                    item.title,
                    item.content,
                    item.excerpt || null,
                    item.image_url || null,
                    scheduledAt,
                    item.master_category_id || null
                ]
            );

            await db.query(
                'INSERT INTO bulk_import_items (batch_id, title, status, post_id) VALUES (?, ?, ?, ?)',
                [batchId, item.title, 'success', postResult.insertId]
            );
            successCount++;
        } catch (err) {
            await db.query(
                'INSERT INTO bulk_import_items (batch_id, title, status, error_message) VALUES (?, ?, ?, ?)',
                [batchId, item.title, 'failed', err.message]
            );
            failedCount++;
        }
    }

    await db.query(
        'UPDATE bulk_import_batches SET success_count = ?, failed_count = ?, status = ? WHERE id = ?',
        [successCount, failedCount, 'completed', batchId]
    );

    res.json({ batchId, total: articles.length, successCount, failedCount });
});

/**
    Check batch results — which articles succeeded/failed, and why
*/
router.get('/api/bulk-import/:batchId', requireAuth, async (req, res) => {
    const [[batch]] = await db.query('SELECT * FROM bulk_import_batches WHERE id = ?', [req.params.batchId]);
    if (!batch) {
        return res.status(404).json({ error: 'Batch not found' });
    }

    const [items] = await db.query('SELECT * FROM bulk_import_items WHERE batch_id = ?', [req.params.batchId]);
    res.json({ batch, items });
});

export default router;