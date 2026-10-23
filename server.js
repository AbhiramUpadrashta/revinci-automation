// Revinci Test Automation — local control panel server.
// Local: binds to 127.0.0.1. Hosted (HOSTED=1): binds 0.0.0.0, runs headless, gate with APP_PASSWORD.
// Credentials are held in memory for the duration of a run only.
const express = require('express');
const path = require('path');
const { exec } = require('child_process');
// Reload the automation scripts on every run, so updated files take effect without restarting npm start.
const RUNNER_DIR = path.join(__dirname, 'runner') + path.sep;
function engine() {
  for (const k of Object.keys(require.cache)) if (k.startsWith(RUNNER_DIR) && !k.endsWith(path.sep + 'store.js')) delete require.cache[k];
  return require('./runner/engine');
}
const store = require('./runner/store');

const PORT = process.env.PORT || 4600;
const HOSTED = !!process.env.HOSTED || process.env.RENDER === 'true';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const FORCE_HEADLESS = HOSTED || process.env.HEADLESS === '1' || (process.platform === 'linux' && !process.env.DISPLAY);
const app = express();
app.set('trust proxy', true);

// Hosted mode: protect the whole panel with a password (HTTP Basic, any user name).
if (APP_PASSWORD) {
  app.use((req, res, next) => {
    const h = req.headers.authorization || '';
    const pass = h.startsWith('Basic ') ? Buffer.from(h.slice(6), 'base64').toString().split(':').slice(1).join(':') : '';
    if (pass === APP_PASSWORD) return next();
    res.set('WWW-Authenticate', 'Basic realm="Revinci Test Automation"').status(401).send('Authentication required');
  });
}
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));
app.use('/reports', express.static(path.join(__dirname, 'reports')));

let current = null;
const clients = new Set();
const history = [];
let lastScreen = null;
function emit(ev) {
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  if (ev.type === 'screen') lastScreen = line; // live frames are not kept in history
  else { history.push(line); if (history.length > 2000) history.shift(); }
  for (const c of clients) c.write(line);
}

const BUILD = '2026-10-23.1';
app.get('/api/config', (_req, res) => res.json({ hosted: HOSTED, forceHeadless: FORCE_HEADLESS, build: BUILD }));

app.get('/api/meta', (_req, res) => {
  const { SUITES } = engine();
  res.json(Object.fromEntries(Object.entries(SUITES).map(([k, s]) => [k, { title: s.title, options: s.OPTIONS.map(o => ({ id: o.id, label: o.label })) }])));
});

app.get('/api/state', (req, res) => {
  const s = store.all();
  const keys = Object.fromEntries(Object.entries(s.apiKeys || {}).map(([host, k]) => [host, { name: k.name, prefix: k.prefix || k.key.slice(0, 20), masked: k.key.slice(0, 12) + '••••••••' + k.key.slice(-4), savedAt: k.savedAt, source: k.source }]));
  res.json({ apiKeys: keys, runs: s.runs || [], running: !!current });
});

app.get('/api/apikey/reveal', (req, res) => {
  const k = store.all().apiKeys?.[req.query.host];
  if (!k) return res.status(404).json({ error: 'no key' });
  res.json({ key: k.key });
});

app.post('/api/apikey', (req, res) => {
  const { baseUrl, key } = req.body || {};
  if (!baseUrl || !/^rvc_[A-Za-z0-9_\-]{8,}$/.test(String(key || '').trim())) return res.status(400).json({ error: 'Paste a valid Revinci API key (starts with rvc_).' });
  try { new URL(baseUrl); } catch (_) { return res.status(400).json({ error: 'Enter the Revinci URL first.' }); }
  const k = String(key).trim();
  store.setApiKey(baseUrl, { key: k, name: 'saved from panel', prefix: k.slice(0, 20), source: 'pasted' });
  res.json({ ok: true });
});

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  if (current) { for (const l of history) res.write(l); if (lastScreen) res.write(lastScreen); }
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

app.post('/api/run', (req, res) => {
  if (current) return res.status(409).json({ error: 'A run is already in progress' });
  const b = req.body || {};
  if (!b.baseUrl || !b.email || !b.password) return res.status(400).json({ error: 'URL, email and password are required' });
  try { new URL(b.baseUrl); } catch (_) { return res.status(400).json({ error: 'Invalid URL' }); }
  const suites = b.suites || {};
  if (!Object.values(suites).some(v => v && v.length)) return res.status(400).json({ error: 'Pick at least one test option' });
  history.length = 0; lastScreen = null;
  const { Run } = engine();
  current = new Run({
    baseUrl: b.baseUrl, email: b.email, password: b.password, suites,
    headless: FORCE_HEADLESS || !!b.headless, slowMo: Number(b.slowMo ?? 120), video: !!b.video,
    apiKey: (b.apiKey || '').trim() || null, rotateKey: !!b.rotateKey,
    apiBase: (b.apiBase || '').trim() || null, product: (b.product || '').trim() || null,
    account: (b.account || '').trim() || null, planNumber: (b.planNumber || '').trim() || null,
    names: b.names && typeof b.names === 'object' ? b.names : {},
    order: Array.isArray(b.order) ? b.order.filter(k => typeof k === 'string' && /^[a-z]+\.[A-Za-z]+$/.test(k)).slice(0, 60) : [],
    waitMode: b.waitMode === 'visible' ? 'visible' : 'standard', waitMaxMin: Math.min(60, Math.max(1, Number(b.waitMaxMin) || 10)),
  }, emit);
  res.json({ id: current.id, tag: current.tag });
  current.start().finally(() => { current = null; });
});

app.post('/api/stop', (_req, res) => {
  if (current) { current.stopped = true; emit({ type: 'log', level: 'warn', msg: 'Stop requested — finishing current step…' }); }
  res.json({ ok: true });
});

// Refuse to start next to an older copy: on macOS two copies can share the port (IPv4 vs IPv6)
// and the browser keeps talking to the old one.
const httpGet = u => new Promise(r => require('http').get(u, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(d)); }).on('error', () => r(null)).setTimeout(1500, function () { this.destroy(); r(null); }));
(async () => {
  if (!HOSTED) {
    const other = (await httpGet(`http://127.0.0.1:${PORT}/api/config`)) || (await httpGet(`http://[::1]:${PORT}/api/config`));
    if (other) {
      console.error(`\n  Another copy of Revinci Test Automation is already running on port ${PORT} (${other.includes('"build"') ? 'build ' + JSON.parse(other).build : 'an OLD version'}).`);
      console.error(`  Close it first:   lsof -ti tcp:${PORT} | xargs kill -9   then run  npm start  again.\n`);
      process.exit(1);
    }
  }
  app.listen(PORT, HOSTED ? '0.0.0.0' : (process.env.HOST || '127.0.0.1'), () => {
    const url = `http://localhost:${PORT}`;
    console.log(`\n  Revinci Test Automation (build ${BUILD}) running at ${url}${HOSTED ? ' (hosted mode, headless)' : ''}${APP_PASSWORD ? ' · password protected' : ''}`);
    console.log('  Keep this window open while you use the panel. Press Ctrl+C to stop.\n');
    if (HOSTED && !APP_PASSWORD) console.warn('  WARNING: set APP_PASSWORD so the public panel is not open to anyone.');
    if (!process.env.NO_OPEN && !HOSTED) exec(`${process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open'} ${url}`);
  }).on('error', e => { console.error(`\n  Could not start on port ${PORT}: ${e.code}. Run:  lsof -ti tcp:${PORT} | xargs kill -9  then npm start\n`); process.exit(1); });
})();
