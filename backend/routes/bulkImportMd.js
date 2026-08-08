import express from 'express';
import multer from 'multer';
import matter from 'gray-matter';
import { marked } from 'marked';
import db from '../db.js';
import { requireAuth } from './auth.js';

const router = express.Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.originalname.endsWith('.md')) {
            cb(null, true);
        } else {
            cb(new Error('Only .md files are accepted'));
        }
    }
});

/**
    Auto-quote frontmatter values containing an unquoted colon,
    since titles/descriptions commonly contain colons (e.g. "Row: SC To Hear...")
    which break plain YAML scalar parsing.
*/
function sanitizeFrontmatterColons(rawText) {
    const frontmatterMatch = rawText.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return rawText;

    const frontmatterBlock = frontmatterMatch[1];
    const fixedLines = frontmatterBlock.split('\n').map(line => {
        const kvMatch = line.match(/^(\s*[\w-]+):\s*(.+)$/);
        if (!kvMatch) return line;

        const [, key, value] = kvMatch;
        const trimmedValue = value.trim();

        const alreadyQuoted = /^["'].*["']$/.test(trimmedValue);
        const isListOrObject = /^[\[\{]/.test(trimmedValue);
        const hasEmbeddedColon = /:\s/.test(trimmedValue);

        if (!alreadyQuoted && !isListOrObject && hasEmbeddedColon) {
            const escaped = trimmedValue.replace(/"/g, '\\"');
            return `${key}: "${escaped}"`;
        }
        return line;
    });

    const fixedBlock = fixedLines.join('\n');
    return rawText.replace(frontmatterMatch[0], `---\n${fixedBlock}\n---`);
}

function extractTitleAndBody(markdownBody) {
    const h1Match = markdownBody.match(/^#\s+(.+)$/m);
    if (!h1Match) {
        return { title: null, body: markdownBody };
    }
    const title = h1Match[1].trim();
    const body = markdownBody.replace(h1Match[0], '').trim();
    return { title, body };
}

/**
    Processes a single uploaded .md file end-to-end.
    Returns { success: true, ... } or { success: false, error, filename }
    instead of throwing, so the batch loop can continue past a bad file.
*/
async function processSingleFile(file, { clientId, master_category_id, language, scheduled_at }) {
    const filename = file.originalname;

    const rawText = file.buffer.toString('utf-8');
    const sanitizedText = sanitizeFrontmatterColons(rawText);

    let parsed;
    try {
        parsed = matter(sanitizedText);
    } catch (err) {
        return { success: false, filename, error: 'Failed to parse frontmatter', details: err.message };
    }

    const { data: frontmatter, content: markdownBody } = parsed;
    const { title, body } = extractTitleAndBody(markdownBody);

    if (!title || !body.trim()) {
        return { success: false, filename, error: 'Missing H1 title or empty body' };
    }

    const htmlContent = marked.parse(body);
    const excerpt = frontmatter.meta_description || '';

    let scheduledAt;
    if (scheduled_at) {
        scheduledAt = new Date(scheduled_at);
    } else if (frontmatter.date_published) {
        scheduledAt = new Date(frontmatter.date_published);
    } else {
        scheduledAt = new Date();
    }
    if (isNaN(scheduledAt.getTime())) {
        scheduledAt = new Date();
    }

    try {
        const [postResult] = await db.query(
            `INSERT INTO wp_posts
                (client_id, title, content, excerpt, scheduled_at, status, language, master_category_id, featured_image_url, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, NOW(), NOW())`,
            [
                clientId,
                title.slice(0, 255),
                htmlContent,
                excerpt,
                scheduledAt,
                language.slice(0, 10),
                master_category_id || null,
                null
            ]
        );

        return {
            success: true,
            filename,
            postId: postResult.insertId,
            title,
            scheduledAt
        };
    } catch (err) {
        return { success: false, filename, error: 'Failed to insert post', details: err.message };
    }
}

router.post('/api/bulk-import-md', requireAuth, upload.array('files', 50), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
    }

    const {
        clientId,
        master_category_id,
        language = 'English',
        scheduled_at
    } = req.body;

    if (!clientId) {
        return res.status(400).json({ error: 'clientId is required' });
    }

    const options = { clientId, master_category_id, language, scheduled_at };

    // Process sequentially to avoid hammering the DB pool with 50 parallel inserts,
    // and so one file's failure doesn't affect the others.
    const results = [];
    for (const file of req.files) {
        const result = await processSingleFile(file, options);
        results.push(result);
    }

    const succeeded = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    res.json({
        success: failed.length === 0,
        total: results.length,
        succeededCount: succeeded.length,
        failedCount: failed.length,
        results
    });
});

export default router;