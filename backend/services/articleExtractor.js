import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

export async function fetchFullArticle(url) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HallaBolBot/1.0)' },
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!res.ok) {
            return { text: null, title: null, status: 'failed' };
        }

        const html = await res.text();
        const dom = new JSDOM(html, { url });
        const article = new Readability(dom.window.document).parse();

        if (!article || !article.textContent || article.textContent.length < 200) {
            return { text: null, title: null, status: 'failed' };
        }

        return { text: article.textContent, title: article.title, status: 'ok' };
    } catch (err) {
        return { text: null, title: null, status: 'failed' };
    }
}