// Quick self-check: every module loads and every suite exposes its options.
const { SUITES } = require('../runner/engine');
for (const [k, s] of Object.entries(SUITES)) {
  if (!s.title || !Array.isArray(s.OPTIONS) || typeof s.run !== 'function') throw new Error('bad suite ' + k);
  console.log(`✓ ${k.padEnd(9)} ${s.title} — ${s.OPTIONS.length} options`);
}
console.log('All modules load.');
