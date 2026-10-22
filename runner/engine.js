// Run engine: launches the browser, logs in, executes the selected suites step by step,
// streams progress to the control panel and writes an HTML/JSON report.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { login } = require('./auth');
const store = require('./store');

const SUITES = {
  admin: require('./suites/admin'),
  apikey: require('./suites/apikey'),
  products: require('./suites/products'),
  q2c: require('./suites/q2c'),
  api: require('./suites/api'),
};

class Run {
  constructor(cfg, emit) {
    this.cfg = cfg;
    this.emit = emit;
    this.id = new Date().toISOString().replace(/[:.]/g, '-');
    this.dir = path.join(__dirname, '..', 'reports', this.id);
    fs.mkdirSync(this.dir, { recursive: true });
    this.steps = [];
    this.stopped = false;
    // unique suffix so every run creates fresh records without collisions
    this.tag = cfg.tag || ('AT' + Date.now().toString(36).toUpperCase().slice(-5));
    this.data = {}; // things created during the run, reused by later suites
    this.net = { apiBases: new Set(), token: null };
    this.failures = [];       // failed API calls (UI traffic + API tests) with full request/response
    this.currentStep = null;
  }

  // Record a failed API call with headers, payload and response (secrets masked).
  recordFailure(f) {
    const mask = h => Object.fromEntries(Object.entries(h || {}).map(([k, v]) =>
      [k, /authorization|cookie|api-key|x-api-key|token/i.test(k) ? String(v).slice(0, 13) + '…(masked)' : v]));
    const clip = (v, n = 4000) => { if (v == null) return null; const t = typeof v === 'string' ? v : JSON.stringify(v, null, 2); return t.length > n ? t.slice(0, n) + '\n…(truncated)' : t; };
    const rec = {
      t: Date.now(), step: this.currentStep, source: f.source,
      method: f.method, url: f.url, status: f.status, statusText: f.statusText || '', ms: f.ms,
      requestHeaders: mask(f.requestHeaders), requestBody: clip(f.requestBody),
      responseHeaders: mask(f.responseHeaders), responseBody: clip(f.responseBody), error: f.error || null,
    };
    this.failures.push(rec);
    this.emit({ type: 'apifail', failure: rec });
  }

  log(msg, level = 'info') {
    const line = { t: Date.now(), level, msg };
    this.emit({ type: 'log', ...line });
  }

  async step(name, fn, { critical = false } = {}) {
    if (this.stopped) throw new Error('Run stopped by user');
    const s = { name, status: 'running', start: Date.now() };
    this.steps.push(s);
    this.currentStep = name;
    const failBefore = this.failures.length;
    this.emit({ type: 'step', step: s });
    try {
      const detail = await fn();
      s.status = 'passed';
      if (detail) s.detail = typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 500);
    } catch (e) {
      s.status = 'failed';
      s.error = (e && e.message || String(e)).split('\n')[0].slice(0, 400);
      const fails = this.failures.slice(failBefore);
      if (fails.length) s.apiFailures = fails.length;
      if (this.page) {
        const shot = `fail-${this.steps.length}.png`;
        await this.page.screenshot({ path: path.join(this.dir, shot), fullPage: false }).catch(() => {});
        s.screenshot = shot;
      }
      this.log(`✗ ${name}: ${s.error}`, 'error');
      if (critical) { s.end = Date.now(); await this.snap(); this.emit({ type: 'step', step: s }); throw e; }
    }
    s.end = Date.now();
    await this.snap();
    this.emit({ type: 'step', step: s });
    if (s.status === 'passed') this.log(`✓ ${name}${s.detail ? ' — ' + s.detail : ''}`, 'ok');
    return s.status === 'passed';
  }

  async start() {
    const { cfg } = this;
    this.startedAt = Date.now();
    this.emit({ type: 'run', status: 'running', id: this.id, tag: this.tag });
    this.log(`Run ${this.id} · data tag ${this.tag}`);
    const needsBrowser = true; // login is always needed (tenant + session token for lookups)
    try {
      if (needsBrowser) {
        const opts = { headless: !!cfg.headless, slowMo: cfg.slowMo ?? 120, args: ['--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--disable-extensions'] };
        try {
          this.browser = await chromium.launch({ ...opts, channel: cfg.channel || undefined });
        } catch (e) {
          // Playwright's Chromium not installed → use the installed Google Chrome / Edge
          this.log('Bundled Chromium unavailable, trying installed Chrome…', 'warn');
          this.browser = await chromium.launch({ ...opts, channel: 'chrome' })
            .catch(() => chromium.launch({ ...opts, channel: 'msedge' }));
        }
        this.context = await this.browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: cfg.video ? { dir: this.dir } : undefined });
        this.page = await this.context.newPage();
        const ant = require('./ant');
        ant.setWait(cfg.waitMode, cfg.waitMaxMin);
        this.page.setDefaultTimeout(ant.to(20000));
        if (cfg.waitMode === 'visible') this.log(`Waiting mode: until visible (up to ${cfg.waitMaxMin} min per element)`);
        this.watchNetwork(this.page);
        this.startScreenFeed();
        await this.step('Log in to Revinci', () => login(this), { critical: true });
      }
      const order = ['admin', 'apikey', 'products', 'q2c', 'api'];
      for (const key of order) {
        const picks = cfg.suites[key];
        if (!picks || !picks.length) continue;
        this.emit({ type: 'suite', name: key });
        this.log(`── ${SUITES[key].title} ──`, 'head');
        await SUITES[key].run(this, picks);
      }
    } catch (e) {
      this.log('Run aborted: ' + e.message, 'error');
    } finally {
      await this.finish();
    }
  }

  // Stream a small JPEG of the automation browser to the panel so headless/hosted runs can be watched.
  async snap() {
    if (this.snapping || !this.page || this.page.isClosed()) return;
    this.snapping = true;
    try {
      const buf = await this.page.screenshot({ type: 'jpeg', quality: 45, timeout: 3000 });
      this.emit({ type: 'screen', data: buf.toString('base64'), url: this.page.url() });
    } catch (_) {} finally { this.snapping = false; }
  }

  // Smooth live view: Chrome's screencast pushes a frame whenever the page repaints (no screenshots that
  // pause the automation). Frames are throttled to ~8 fps; the 1.5 s screenshot loop is only a fallback.
  async startScreenFeed() {
    try {
      this.cdp = await this.page.context().newCDPSession(this.page);
      let lastSent = 0, pending = null, timer = null;
      const send = () => { timer = null; if (!pending) return; lastSent = Date.now(); this.emit({ type: 'screen', data: pending, url: this.page.url() }); pending = null; };
      this.cdp.on('Page.screencastFrame', f => {
        this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
        pending = f.data;
        const wait = 125 - (Date.now() - lastSent);
        if (wait <= 0) send(); else if (!timer) timer = setTimeout(send, wait);
      });
      await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 55, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
      this.screencast = true;
      this.feed = setInterval(() => { if (Date.now() - lastSent > 3000) this.snap(); }, 3000); // idle page keeps a fresh frame
    } catch (_) {
      this.screencast = false;
      this.feed = setInterval(() => this.snap(), 1500);
    }
  }

  watchNetwork(page) {
    page.on('request', req => {
      const u = req.url();
      const m = u.match(/^(https:\/\/[^/]+)\/([a-z-]+)\/api\/v1\//i);
      if (m) this.net.apiBases.add(m[1]);
      const auth = req.headers()['authorization'];
      if (auth && auth.startsWith('Bearer ') && !this.net.token) this.net.token = auth.slice(7);
      const tid = req.headers()['tenant-id'] || req.headers()['x-tenant-id'];
      if (tid && !this.net.tenantId) this.net.tenantId = tid;
    });
    // Capture every failed Revinci API call the screens make.
    page.on('response', async res => {
      const req = res.request();
      if (!['fetch', 'xhr'].includes(req.resourceType())) return;
      if (res.status() < 400 || !/revinci\.ai/.test(req.url())) return;
      let body = null; try { body = await res.text(); } catch (_) {}
      const timing = req.timing();
      this.recordFailure({ source: 'screen', method: req.method(), url: req.url(), status: res.status(), statusText: res.statusText(),
        requestHeaders: await req.allHeaders().catch(() => req.headers()), requestBody: req.postData(),
        responseHeaders: await res.allHeaders().catch(() => res.headers()), responseBody: body,
        ms: timing && timing.responseEnd > 0 ? Math.round(timing.responseEnd) : null });
    });
    page.on('requestfailed', req => {
      if (!['fetch', 'xhr'].includes(req.resourceType()) || !/revinci\.ai/.test(req.url())) return;
      this.recordFailure({ source: 'screen', method: req.method(), url: req.url(), status: 0, requestHeaders: req.headers(), requestBody: req.postData(), error: req.failure()?.errorText || 'request failed' });
    });
  }

  async finish() {
    if (this.feed) clearInterval(this.feed);
    if (this.cdp) await this.cdp.send('Page.stopScreencast').catch(() => {});
    if (this.context) await this.context.close().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});
    const passed = this.steps.filter(s => s.status === 'passed').length;
    const failed = this.steps.filter(s => s.status === 'failed').length;
    const summary = { id: this.id, tag: this.tag, baseUrl: this.cfg.baseUrl, suites: this.cfg.suites, passed, failed, total: this.steps.length, data: this.data, steps: this.steps, failures: this.failures, finishedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(this.dir, 'report.json'), JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(this.dir, 'index.html'), require('./report').html(summary));
    store.addRun({ id: this.id, tag: this.tag, passed, failed, total: this.steps.length, at: summary.finishedAt, baseUrl: this.cfg.baseUrl,
      ms: Date.now() - (this.startedAt || Date.now()), suites: Object.keys(this.cfg.suites).filter(k => this.cfg.suites[k]?.length), apiFailures: this.failures.length });
    this.log(`Finished: ${passed} passed, ${failed} failed`, failed ? 'error' : 'ok');
    this.emit({ type: 'run', status: 'done', id: this.id, passed, failed, report: `/reports/${this.id}/index.html` });
  }
}

module.exports = { Run, SUITES };
