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
        let imageBuffer;
        let filename;

        // ── If it's a full URL, download it first ─────────────────────────
        if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
            log('🌐 Downloading image from URL:', imagePath);

            const response = await fetch(imagePath);
            if (!response.ok) {
                log('⚠ Failed to download image:', response.status);
                return null;
            }

            imageBuffer = Buffer.from(await response.arrayBuffer());
            filename = path.basename(new URL(imagePath).pathname);

        } else {
            // ── Local file path ────────────────────────────────────────────
            const fullPath = path.join(__dirname, '..', imagePath);

            if (!fs.existsSync(fullPath)) {
                log('⚠ Image file not found:', fullPath);
                return null;
            }

            imageBuffer = fs.readFileSync(fullPath);
            filename = path.basename(fullPath);
        }

        const mimeType = getMimeType(filename);
        const credentials = Buffer.from(`${username}:${appPassword}`).toString('base64');

        const uploadResponse = await fetch(`${siteUrl}/wp-json/wp/v2/media`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Type': mimeType,
            },
            body: imageBuffer
        });

        if (!uploadResponse.ok) {
            const err = await uploadResponse.text();
            log('⚠ WP media upload failed:', err);
            return null;
        }

        const data = await uploadResponse.json();
        log('🖼 Image uploaded to WP, media_id:', data.id);
        return data.id;

    } catch (err) {
        log('⚠ Error uploading image to WP:', err.message);
        return null;
    }
}