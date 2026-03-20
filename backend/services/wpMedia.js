import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fetch from 'node-fetch';
import { log } from '../utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const types = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
    };
    return types[ext] || 'image/jpeg';
}

export async function uploadImageToWordPress(siteUrl, username, appPassword, imagePath) {
    try {
        // imagePath is like /uploads/wp-images/filename.jpg
        // resolve to full disk path
        const fullPath = path.join(__dirname, '..', imagePath);

        if (!fs.existsSync(fullPath)) {
            log('⚠ Image file not found:', fullPath);
            return null;
        }

        const imageBuffer = fs.readFileSync(fullPath);
        const filename = path.basename(fullPath);
        const mimeType = getMimeType(filename);

        const credentials = Buffer.from(`${username}:${appPassword}`).toString('base64');

        const response = await fetch(`${siteUrl}/wp-json/wp/v2/media`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Type': mimeType,
            },
            body: imageBuffer
        });

        if (!response.ok) {
            const err = await response.text();
            log('⚠ WP media upload failed:', err);
            return null;
        }

        const data = await response.json();
        log('🖼 Image uploaded to WP, media_id:', data.id);
        return data.id;

    } catch (err) {
        log('⚠ Error uploading image to WP:', err.message);
        return null;
    }
}