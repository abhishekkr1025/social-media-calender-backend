// // routes/claude-pipeline.js
// // POST /api/claude/run-pipeline
// //
// // Runs two Skills back-to-back using ONE fixed API key held server-side:
// //   1. "/daily-news-listing" -> produces the day's news listing
// //   2. "cliq-news-articles"  -> takes step 1's output as input, produces articles
// //
// // No login screens, no credentials in the browser. The button just calls
// // this one endpoint and gets the final result back.

// const express = require('express');
// const router = express.Router();

// const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
// const ANTHROPIC_VERSION = '2023-06-01';

// // Runs a single skill to completion, resuming automatically if the model
// // returns stop_reason "pause_turn" (long-running skill work), and returns
// // the plain-text output plus the full message history (so it can be
// // inspected or chained further if needed).
// async function runSkillToCompletion({ skillId, skillType, userMessageText, containerId }) {
//     let messages = [{ role: 'user', content: [{ type: 'text', text: userMessageText }] }];
//     let currentContainerId = containerId || null;
//     let finalText = '';

//     // Guard against runaway loops if something never reaches end_turn
//     const MAX_TURNS = 10;

//     for (let turn = 0; turn < MAX_TURNS; turn++) {
//         const requestBody = {
//             model: process.env.CLAUDE_MODEL,
//             max_tokens: 4096,
//             messages,
//             tools: [
//                 {
//                     type: 'code_execution_20250825',
//                     name: 'code_execution',
//                 },
//             ],
//             container: currentContainerId
//                 ? { id: currentContainerId }
//                 : { skills: [{ type: skillType, skill_id: skillId }] },
//         };

//         const response = await fetch(ANTHROPIC_API_URL, {
//             method: 'POST',
//             headers: {
//                 'content-type': 'application/json',
//                 'x-api-key': process.env.ANTHROPIC_API_KEY,
//                 'anthropic-version': ANTHROPIC_VERSION,
//             },
//             body: JSON.stringify(requestBody),
//         });

//         if (!response.ok) {
//             const errText = await response.text();
//             throw new Error(`Claude API error (${response.status}): ${errText}`);
//         }

//         const data = await response.json();

//         if (data.container?.id) {
//             currentContainerId = data.container.id;
//         }

//         // Collect any text blocks from this turn
//         const textBlocks = (data.content || []).filter((b) => b.type === 'text');
//         finalText = textBlocks.map((b) => b.text).join('\n');

//         messages.push({ role: 'assistant', content: data.content });

//         if (data.stop_reason !== 'pause_turn') {
//             // Done - end_turn (or another terminal reason)
//             break;
//         }

//         // pause_turn: send the same assistant content back to let it continue
//         messages.push({ role: 'user', content: [] });
//     }

//     return { text: finalText, containerId: currentContainerId, messages };
// }

// router.post('/api/claude/run-pipeline', async (req, res) => {
//     try {
//         // Step 1: run the daily news listing skill
//         const step1 = await runSkillToCompletion({
//             skillId: process.env.SKILL_ID_DAILY_NEWS_LISTING,
//             skillType: 'custom',
//             userMessageText: 'Run /daily-news-listing and give me the full listing.',
//         });

//         if (!step1.text.trim()) {
//             return res.status(502).json({
//                 error: 'daily-news-listing produced no output',
//             });
//         }

//         // Step 2: feed step 1's output straight into the second skill.
//         // New container on purpose - it's a different skill/task.
//         const step2 = await runSkillToCompletion({
//             skillId: process.env.SKILL_ID_CLIQ_NEWS_ARTICLES,
//             skillType: 'custom',
//             userMessageText: `Using the following news listing as input, run cliq-news-articles:\n\n${step1.text}`,
//         });

//         res.json({
//             newsListing: step1.text,
//             articles: step2.text,
//         });
//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// });

// module.exports = router;