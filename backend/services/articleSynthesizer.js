import axios from 'axios';

const ARTICLE_SERVICE_URL = process.env.ARTICLE_SERVICE_URL || 'http://20.106.197.23:11434/v1/chat/completions';
const ARTICLE_MODEL_NAME = process.env.ARTICLE_MODEL_NAME || 'qwen2.5:7b-instruct-q4_K_M';

function buildPrompt(headline, sources) {
    const sourceBlocks = sources
        .map((s, i) => `SOURCE ${i + 1} (${s.source_name}):\n${s.fetched_text.slice(0, 3000)}`)
        .join('\n\n---\n\n');

    return `You are a news writer. Write an original news article about: "${headline}"

Use ONLY the facts below, drawn from multiple sources. Write entirely in your own words — do not copy sentences or phrasing from the sources. If sources disagree on a key fact, mention both versions.

${sourceBlocks}

Return ONLY JSON, no other text, no markdown fences: {"title": "...", "body": "...", "facts_sources": [{"fact": "...", "source_index": 1}]}`;
}

function parseModelJson(raw) {
    try {
        const cleaned = raw.replace(/```json|```/g, '').trim();
        const match = cleaned.match(/\{[\s\S]*\}/);
        return JSON.parse(match ? match[0] : cleaned);
    } catch (err) {
        console.error('Failed to parse LLM output:', raw);
        return null;
    }
}

export async function synthesizeArticle(headline, sources) {
    if (!headline || !Array.isArray(sources) || sources.length < 2) {
        return null;
    }

    const prompt = buildPrompt(headline, sources);

    try {
        const res = await axios.post(
            ARTICLE_SERVICE_URL,
            {
                model: ARTICLE_MODEL_NAME,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.4
            },
            { timeout: 120000 }
        );

        const raw = res.data.choices[0].message.content;
        const parsed = parseModelJson(raw);

        if (!parsed || !parsed.title || !parsed.body) {
            console.error('Article generation returned invalid result:', raw);
            return null;
        }

        return { title: parsed.title, body: parsed.body, facts_sources: parsed.facts_sources || [] };
    } catch (err) {
        console.error('Article generation service error:', err.response?.data || err.message);
        return null;
    }
}