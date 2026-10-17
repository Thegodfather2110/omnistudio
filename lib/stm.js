'use strict';
/**
 * STM - Semantic Transformation Modules.
 * Small, composable text transforms applied to model replies after they arrive.
 * Fenced code blocks and inline code are never touched.
 */

function applyOutsideCode(text, fn) {
  // split on fenced code blocks, transform only the prose parts
  const parts = String(text).split(/(```[\s\S]*?(?:```|$))/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      // protect inline code
      const inline = [];
      const guarded = part.replace(/`[^`\n]+`/g, (m) => {
        inline.push(m);
        return `\u0000${inline.length - 1}\u0000`;
      });
      return fn(guarded).replace(/\u0000(\d+)\u0000/g, (_, n) => inline[Number(n)]);
    })
    .join('');
}

const capitalizeLines = (s) => s.replace(/(^|\n)([ \t]*(?:[-*]\s+|\d+\.\s+)?)([a-z])/g, (_, a, b, c) => a + b + c.toUpperCase());

const MODULES = [
  {
    id: 'hedge_reducer',
    name: 'Hedge reducer',
    description: 'Removes "I think", "perhaps", "it seems" and similar softeners.',
    run: (t) =>
      capitalizeLines(
        t
          .replace(/\b(I think|I believe|I would say|I feel like|It seems like|It appears that|In my opinion|From my perspective|Arguably)[,]?\s+/gi, '')
          .replace(/\b(perhaps|maybe|possibly|probably|somewhat|fairly|quite)\s+/gi, '')
      ),
  },
  {
    id: 'direct_mode',
    name: 'Direct mode',
    description: 'Strips openers like "Sure!", "Great question!" and filler lead-ins.',
    run: (t) =>
      capitalizeLines(
        t.replace(
          /^\s*(?:(?:Sure|Of course|Certainly|Absolutely|Great question|Good question|Happy to help|No problem)[!.,]?\s*)+(?:(?:I'd|I would) be happy to help(?: you)?(?: with that)?[!.]?\s*)?/i,
          ''
        ).replace(/^\s*(?:Let me|Allow me to) (?:help|break|explain|walk)[^.\n]*[.:]\s*/i, '')
      ),
  },
  {
    id: 'no_closers',
    name: 'No sign-offs',
    description: 'Removes closing lines like "I hope this helps" or "Let me know if you need anything".',
    run: (t) =>
      t
        .replace(/\n+[^\n]*\b(I hope this helps|hope that helps|Let me know if|Feel free to (ask|reach out)|Happy (coding|building)|Is there anything else)[^\n]*\s*$/i, '')
        .trimEnd(),
  },
  {
    id: 'casual_mode',
    name: 'Casual tone',
    description: 'Swaps stiff words for everyday ones (utilize→use, however→but).',
    run: (t) =>
      t
        .replace(/\bHowever\b/g, 'But').replace(/\bhowever,/g, 'but')
        .replace(/\bTherefore\b/g, 'So').replace(/\btherefore\b/g, 'so')
        .replace(/\bFurthermore\b|\bMoreover\b|\bAdditionally\b/g, 'Also')
        .replace(/\bNevertheless\b/g, 'Still')
        .replace(/\butilize\b/gi, (m) => (m[0] === 'U' ? 'Use' : 'use'))
        .replace(/\bpurchase\b/gi, (m) => (m[0] === 'P' ? 'Buy' : 'buy'))
        .replace(/\bobtain\b/gi, (m) => (m[0] === 'O' ? 'Get' : 'get'))
        .replace(/\bin order to\b/gi, 'to')
        .replace(/\bdue to the fact that\b/gi, 'because')
        .replace(/\bprior to\b/gi, 'before')
        .replace(/\bsubsequent to\b/gi, 'after'),
  },
  {
    id: 'no_emoji',
    name: 'No emoji',
    description: 'Removes emoji characters from replies.',
    run: (t) => t.replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/[ \t]+$/gm, ''),
  },
  {
    id: 'plain_text',
    name: 'Plain text',
    description: 'Removes markdown emphasis and heading marks (code blocks are kept).',
    run: (t) =>
      t
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1$2'),
  },
];

function list() {
  return MODULES.map(({ id, name, description }) => ({ id, name, description }));
}

function apply(text, enabledIds) {
  const ids = new Set(enabledIds || []);
  let out = String(text || '');
  for (const m of MODULES) {
    if (ids.has(m.id)) out = applyOutsideCode(out, m.run);
  }
  return out;
}

// Works in Node (require) and in the browser (<script src="/shared/stm.js">)
if (typeof module !== 'undefined' && module.exports) module.exports = { list, apply, MODULES };
else if (typeof window !== 'undefined') window.STM = { list, apply, MODULES };
