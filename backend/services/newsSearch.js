import Parser from 'rss-parser';

const parser = new Parser();

export async function searchNews(headline) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(headline)}&hl=en-IN&gl=IN&ceid=IN:en`;
    try {
        const feed = await parser.parseURL(url);
        return feed.items.slice(0, 8).map(item => ({
            title: item.title,
            link: item.link,
            source: item.source?._ || item.creator || 'Unknown',
            date: item.pubDate,
            snippet: item.contentSnippet || ''
        }));
    } catch (err) {
        console.error('RSS news search failed:', err.message);
        return [];
    }
}