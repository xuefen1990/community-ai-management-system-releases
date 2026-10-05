'use strict';
const SCALE = 2000;
const DEFAULT = Object.freeze({ tokensPerCredit: 2000, textWeight: 1, imageWeight: 1.5, deepWeight: 2, textMinimum: 1, imageMinimum: 2, deepMinimum: 3 });
function enabled() { return process.env.AI_CREDITS_ENABLED === '1'; }
function textOf(messages) { return (messages || []).flatMap(m => typeof m.content === 'string' ? [m.content] : (m.content || []).filter(p => p.type === 'text').map(p => p.text || '')).join('\n'); }
function imageCount(messages) { return (messages || []).reduce((n,m) => n + (Array.isArray(m.content) ? m.content.filter(p => ['image_url','input_image'].includes(p?.type)).length : 0),0); }
function workload(input = {}, policy = DEFAULT) {
 const images = imageCount(input.messages); const deep = input.taskTier === 'deep';
 return { weight: deep ? policy.deepWeight : images || input.taskKind === 'vision-document-review' ? policy.imageWeight : policy.textWeight,
 minimum: Math.max(deep ? policy.deepMinimum : policy.textMinimum, images || input.taskKind === 'vision-document-review' ? policy.imageMinimum : policy.textMinimum), images, deep };
}
function estimateTokens(messages, output = 1200) { return Math.ceil(Buffer.byteLength(textOf(messages),'utf8') / 3) + imageCount(messages)*2048 + Math.max(16,Number(output)||1200); }
function credits(weightedTokens, minimum = 1, policy = DEFAULT) { return Math.max(minimum,Math.ceil(weightedTokens / policy.tokensPerCredit)); }
module.exports = { SCALE, DEFAULT, enabled, textOf, imageCount, workload, estimateTokens, credits };
