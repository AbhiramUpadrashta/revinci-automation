// Local, git-ignored storage for API keys and run history (data/state.json).
// Passwords are never written to disk.
const fs = require('fs');
const path = require('path');
const FILE = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'state.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { return { apiKeys: {}, runs: [] }; }
}
function save(s) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
}
function hostKey(baseUrl) { try { return new URL(baseUrl).host; } catch (_) { return baseUrl; } }

module.exports = {
  getApiKey(baseUrl) { return load().apiKeys[hostKey(baseUrl)] || null; },
  setApiKey(baseUrl, rec) { const s = load(); s.apiKeys[hostKey(baseUrl)] = { ...rec, savedAt: new Date().toISOString() }; save(s); },
  addRun(r) { const s = load(); s.runs.unshift(r); s.runs = s.runs.slice(0, 50); save(s); },
  runs() { return load().runs; },
  all() { return load(); },
};
