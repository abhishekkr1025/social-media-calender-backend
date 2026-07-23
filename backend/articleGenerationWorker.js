import pLimit from 'p-limit';
import db from './db.js';
import { searchNews } from './services/newsSearch.js';
import { fetchFullArticle } from './services/articleExtractor.js';
import { synthesizeArticle } from './services/articleSynthesizer.js';

const limit = pLimit(1);

async function updateJobStatus(jobId, status, errorMessage = null) {
    await db.query(
        'UPDATE article_generation_jobs SET status = ?, error_message = ? WHERE id = ?',
        [status, errorMessage, jobId]
    );
}

async function processJob(job) {
    try {
        await updateJobStatus(job.id, 'fetching');

        const candidates = await searchNews(job.headline);
        if (candidates.length === 0) {
            await updateJobStatus(job.id, 'failed', 'No search results found');
            return;
        }

        const fetched = await Promise.all(
            candidates.map(async (c) => {
                const result = await fetchFullArticle(c.link);
                return {
                    job_id: job.id,
                    url: c.link,
                    source_name: c.source,
                    fetched_text: result.text,
                    fetch_status: result.status
                };
            })
        );

        for (const s of fetched) {
            await db.query(
                'INSERT INTO article_sources (job_id, url, source_name, fetched_text, fetch_status) VALUES (?, ?, ?, ?, ?)',
                [s.job_id, s.url, s.source_name, s.fetched_text, s.fetch_status]
            );
        }

        const usableSources = fetched.filter((s) => s.fetch_status === 'ok');
        if (usableSources.length < 2) {
            await updateJobStatus(job.id, 'failed', `Only ${usableSources.length} usable sources found`);
            return;
        }

        await updateJobStatus(job.id, 'writing');
        const article = await synthesizeArticle(job.headline, usableSources);

        if (!article) {
            await updateJobStatus(job.id, 'failed', 'Article synthesis service failed or returned invalid data');
            return;
        }

        await db.query(
            'INSERT INTO generated_articles (job_id, title, body, facts_sources, status) VALUES (?, ?, ?, ?, ?)',
            [job.id, article.title, article.body, JSON.stringify(article.facts_sources), 'draft']
        );

        await updateJobStatus(job.id, 'draft');
    } catch (err) {
        console.error(`Job ${job.id} failed:`, err);
        await updateJobStatus(job.id, 'failed', err.message);
    }
}

export async function processPendingJobs() {
    const [jobs] = await db.query(
        "SELECT * FROM article_generation_jobs WHERE status = 'pending' LIMIT 10"
    );
    await Promise.all(jobs.map((job) => limit(() => processJob(job))));
}

async function runArticleWorkerLoop() {
    console.log('🚀 Article generation worker started, polling every 5000ms...');
    while (true) {
        try {
            await processPendingJobs();
        } catch (err) {
            console.error('❌ Article worker loop error:', err);
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}

setTimeout(() => {
    console.log('⏳ Article worker loop initializing...');
    runArticleWorkerLoop().catch(err => {
        console.error('❌ Article worker crashed:', err);
    });
}, 2000);