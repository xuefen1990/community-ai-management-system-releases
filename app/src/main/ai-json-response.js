'use strict';

// Read an already complete object; never invent missing quotes, fields or facts.
function extractAiJsonObject(content) {
  const raw = String(content ?? '').trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const start = raw.indexOf('{');
  if (start < 0) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < raw.length; index++) {
    const char = raw[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      // Some compatible models append an extra closing brace. The object itself
      // must be valid JSON; reject extra objects or contradictory trailing text.
      if (!/^[\s}]*$/u.test(raw.slice(index + 1))) return null;
      try { return JSON.parse(raw.slice(start, index + 1)); } catch { return null; }
    }
  }
  return null;
}

module.exports = { extractAiJsonObject };
