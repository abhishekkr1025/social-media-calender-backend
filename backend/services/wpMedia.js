// import fs from 'fs';
// import path from 'path';
// import { fileURLToPath } from 'url';
// import { dirname } from 'path';
// import fetch from 'node-fetch';
// import { log } from '../utils.js';

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = dirname(__filename);

// function getMimeType(filename) {
//     const ext = path.extname(filename).toLowerCase();
//     const types = {
//         '.jpg': 'image/jpeg',
//         '.jpeg': 'image/jpeg',
//         '.png': 'image/png',
//         '.gif': 'image/gif',
//         '.webp': 'image/webp',
//     };
//     return types[ext] || 'image/jpeg';
// }

// export async function uploadImageToWordPress(siteUrl, username, appPassword, imagePath) {
//     try {
//         let imageBuffer;
//         let filename;

//         // ── If it's a full URL, download it first ─────────────────────────
//         if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
//             log('🌐 Downloading image from URL:', imagePath);

//             const response = await fetch(imagePath);
//             if (!response.ok) {
//                 log('⚠ Failed to download image:', response.status);
//                 return null;
//             }

//             imageBuffer = Buffer.from(await response.arrayBuffer());
//             filename = path.basename(new URL(imagePath).pathname);

//         } else {
//             // ── Local file path ────────────────────────────────────────────
//             const fullPath = path.join(__dirname, '..', imagePath);

//             if (!fs.existsSync(fullPath)) {
//                 log('⚠ Image file not found:', fullPath);
//                 return null;
//             }

//             imageBuffer = fs.readFileSync(fullPath);
//             filename = path.basename(fullPath);
//         }

//         const mimeType = getMimeType(filename);
//         const credentials = Buffer.from(`${username}:${appPassword}`).toString('base64');

//         const uploadResponse = await fetch(`${siteUrl}/wp-json/wp/v2/media`, {
//             method: 'POST',
//             headers: {
//                 'Authorization': `Basic ${credentials}`,
//                 'Content-Disposition': `attachment; filename="${filename}"`,
//                 'Content-Type': mimeType,
//             },
//             body: imageBuffer
//         });

//         if (!uploadResponse.ok) {
//             const err = await uploadResponse.text();
//             log('⚠ WP media upload failed:', err);
//             return null;
//         }

//         const data = await uploadResponse.json();
//         log('🖼 Image uploaded to WP, media_id:', data.id);
//         return data.id;

//     } catch (err) {
//         log('⚠ Error uploading image to WP:', err.message);
//         return null;
//     }
// }

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

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
};

/**
 * Download an image from a URL into a Buffer.
 * Returns { buffer, filename } or null on failure.
 */
export async function downloadImageBuffer(imageUrl) {
    try {
        log('🌐 Downloading image from URL:', imageUrl);
        const response = await fetch(imageUrl, {
            headers: {
                ...BROWSER_HEADERS,
                'Referer': new URL(imageUrl).origin + '/',
            }
        });

        if (!response.ok) {
            log('⚠ Failed to download image:', response.status);
            return null;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const filename = path.basename(new URL(imageUrl).pathname) || 'image.jpg';
        return { buffer, filename };

    } catch (err) {
        log('⚠ Error downloading image:', err.message);
        return null;
    }
}

/**
 * Upload a pre-downloaded image buffer to WordPress.
 * Use this inside site loops to avoid re-fetching the image per site.
 */
export async function uploadImageBufferToWordPress(siteUrl, username, appPassword, imageBuffer, filename) {
    try {
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

/**
 * Legacy helper — downloads + uploads in one call.
 * Still works for single-site use, but prefer the two functions above for multisite.
 */
export async function uploadImageToWordPress(siteUrl, username, appPassword, imagePath) {
    try {
        let imageBuffer;
        let filename;

        if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
            const result = await downloadImageBuffer(imagePath);
            if (!result) return null;
            imageBuffer = result.buffer;
            filename = result.filename;

        } else {
            const fullPath = path.join(__dirname, '..', imagePath);
            if (!fs.existsSync(fullPath)) {
                log('⚠ Image file not found:', fullPath);
                return null;
            }
            imageBuffer = fs.readFileSync(fullPath);
            filename = path.basename(fullPath);
        }

        return await uploadImageBufferToWordPress(siteUrl, username, appPassword, imageBuffer, filename);

    } catch (err) {
        log('⚠ Error uploading image to WP:', err.message);
        return null;
    }
}