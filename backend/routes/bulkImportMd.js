import express from 'express';
import multer from 'multer';
import matter from 'gray-matter';
import { marked } from 'marked';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import db from '../db.js';
import { requireAuth } from './auth.js';

const router = express.Router();

// Directory that is already served statically as /uploads (express.static('uploads'))
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const ALLOWED_IMAGE_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
]);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.fieldname === 'files') {
            if (file.originalname.endsWith('.md')) {
                cb(null, true);
            } else {
                cb(new Error('Only .md files are accepted for "files"'));
            }
        } else if (file.fieldname === 'images') {
            if (ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
                cb(null, true);
            } else {
                cb(new Error('Only jpeg/png/webp/gif images are accepted for "images"'));
            }
        } else {
            cb(new Error(`Unexpected field: ${file.fieldname}`));
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

/**
    Prefers an explicit "# " (H1) heading for the title, since that's an
    unambiguous signal. Some generated files instead put the headline as a
    bare first line with no "#", relying on frontmatter `title:` for the
    real title — for those, fall back to frontmatter.title, and if the
    body's first line is just repeating that title, drop it so the
    headline doesn't end up duplicated (once as the WP post title, once as
    a stray first line of body text).
*/
function extractTitleAndBody(markdownBody, frontmatterTitle) {
    const h1Match = markdownBody.match(/^#\s+(.+)$/m);
    if (h1Match) {
        const title = h1Match[1].trim();
        const body = markdownBody.replace(h1Match[0], '').trim();
        return { title, body };
    }

    if (frontmatterTitle && frontmatterTitle.trim()) {
        const title = frontmatterTitle.trim();
        const lines = markdownBody.split('\n');
        const firstContentIdx = lines.findIndex(l => l.trim().length > 0);

        let body = markdownBody;
        if (firstContentIdx !== -1) {
            const firstLine = lines[firstContentIdx].trim().toLowerCase();
            // Ignore a " | Site Name" style suffix when comparing, since that's
            // usually meant for the SEO <title> tag, not the bare headline text.
            const titleForCompare = title.toLowerCase().split('|')[0].trim();
            if (firstLine === titleForCompare || firstLine.startsWith(titleForCompare)) {
                lines.splice(firstContentIdx, 1);
                body = lines.join('\n');
            }
        }
        return { title, body: body.trim() };
    }

    return { title: null, body: markdownBody };
}

/**
    Writes an uploaded image buffer to the local uploads/ folder (already
    served statically at /uploads) and returns the public URL for it, so it
    can be stored as wp_posts.featured_image_url. The worker's
    downloadImageBuffer() step later fetches this URL and re-uploads the
    image to each WordPress site's media library, passing the resulting
    media id in the wp-json/wp/v2/posts body — same as it already does.
    Returns null if no image was provided.
*/
function saveImageAndGetUrl(imageFile, req) {
    if (!imageFile) return null;

    const ext = path.extname(imageFile.originalname) || '.jpg';
    const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    const destPath = path.join(UPLOADS_DIR, uniqueName);

    fs.writeFileSync(destPath, imageFile.buffer);

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    return `${baseUrl.replace(/\/$/, '')}/uploads/${uniqueName}`;
}

/**
    Processes a single uploaded .md file end-to-end.
    Returns { success: true, ... } or { success: false, error, filename }
    instead of throwing, so the batch loop can continue past a bad file.
*/
async function processSingleFile(file, { clientId, master_category_id, language, scheduled_at, featured_image_url }) {
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
    const { title, body } = extractTitleAndBody(markdownBody, frontmatter.title);

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
        (client_id, title, content, excerpt, scheduled_at, status, language, master_category_id, source_filename, featured_image_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, NOW(), NOW())`,
    [
        clientId,
        title.slice(0, 255),
        htmlContent,
        excerpt,
        scheduledAt,
        language.slice(0, 10),
        master_category_id || null,
        filename,
        featured_image_url || null
    ]
);

        return {
            success: true,
            filename,
            postId: postResult.insertId,
            title,
            scheduledAt,
            featured_image_url: featured_image_url || null
        };
    } catch (err) {
        return { success: false, filename, error: 'Failed to insert post', details: err.message };
    }
}

router.post(
    '/api/bulk-import-md',
    requireAuth,
    upload.fields([
        { name: 'files', maxCount: 50 },
        { name: 'images', maxCount: 50 }
    ]),
    async (req, res) => {
        const mdFiles = req.files?.files || [];
        const imageFiles = req.files?.images || [];

        if (mdFiles.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        const {
            clientId,
            language = 'English',
            fileMeta
        } = req.body;

        if (!clientId) {
            return res.status(400).json({ error: 'clientId is required' });
        }

        // fileMeta is a JSON array, one entry per md file, in the SAME order the frontend
        // appended files to the "files" field — multer/FormData preserve that order,
        // so mdFiles[i] pairs with parsedMeta[i]. The "images" field is expected to be
        // appended in that same per-row order too, one image per row (a row can omit
        // its image by simply not appending a file for that slot on the frontend,
        // but then indices between files/images would drift — so the frontend should
        // send a same-length images array and skip a slot with an empty/placeholder
        // entry if a row has no image; here we pair by index defensively).
        let parsedMeta = [];
        if (fileMeta) {
            try {
                parsedMeta = JSON.parse(fileMeta);
            } catch (err) {
                return res.status(400).json({ error: 'fileMeta must be valid JSON' });
            }
            if (!Array.isArray(parsedMeta)) {
                return res.status(400).json({ error: 'fileMeta must be a JSON array' });
            }
        }

        // Process sequentially to avoid hammering the DB pool with 50 parallel inserts,
        // and so one file's failure doesn't affect the others.
        const results = [];
        for (let i = 0; i < mdFiles.length; i++) {
            const file = mdFiles[i];
            const meta = parsedMeta[i] || {};

            let featured_image_url = null;
            try {
                featured_image_url = saveImageAndGetUrl(imageFiles[i], req);
            } catch (err) {
                results.push({
                    success: false,
                    filename: file.originalname,
                    error: 'Failed to save uploaded image',
                    details: err.message
                });
                continue;
            }

            const options = {
                clientId,
                language,
                master_category_id: meta.master_category_id || null,
                scheduled_at: meta.scheduled_at || null,
                featured_image_url
            };

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
    }
);

// Temporarily replace your GET /today route body with this to see the raw error:
router.get('/api/bulk-import-md/today', requireAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT id, title, content, excerpt, source_filename, language, client_id, created_at, scheduled_at, featured_image_url
             FROM wp_posts
             WHERE DATE(created_at) = CURDATE()
             ORDER BY created_at DESC`
        );
        res.json(rows);
    } catch (err) {
        console.error('TODAY QUERY FAILED:', err); // <-- check your server terminal for this
        res.status(500).json({ error: err.message });
    }
});
export default router;