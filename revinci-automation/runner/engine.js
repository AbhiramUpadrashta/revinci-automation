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
  }

  log(msg, level = 'info') {
    const line = { t: Date.now(), level, msg };
    this.emit({ type: 'log', ...line });
  }

  async step(name, fn, { critical = false } = {}) {
    if (this.stopped) throw new Error('Run stopped by user');
    const s = { name, status: 'running', start: Date.now() };
    this.steps.push(s);
    this.emit({ type: 'step', step: s });
    try {
      const detail = await fn();
      s.status = 'passed';
      if (detail) s.detail = typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 500);
    } catch (e) {
      s.status = 'failed';
      s.error = (e && e.message || String(e)).split('\n')[0].slice(0, 400);
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
    this.emit({ type: 'run', status: 'running', id: this.id, tag: this.tag });
    this.log(`Run ${this.id} · data tag ${this.tag}`);
    const needsBrowser = true; // login is always needed (tenant + session token for lookups)
    try {
      if (needsBrowser) {
        const opts = { headless: !!cfg.headless, slowMo: cfg.slowMo ?? 120 };
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
        this.page.setDefaultTimeout(20000);
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

  startScreenFeed() {
    this.feed = setInterval(() => this.snap(), 1500);
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
  }

  async finish() {
    if (this.feed) clearInterval(this.feed);
    if (this.context) await this.context.close().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});
    const passed = this.steps.filter(s => s.status === 'passed').length;
    const failed = this.steps.filter(s => s.status === 'failed').length;
    const summary = { id: this.id, tag: this.tag, baseUrl: this.cfg.baseUrl, suites: this.cfg.suites, passed, failed, total: this.steps.length, data: this.data, steps: this.steps, finishedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(this.dir, 'report.json'), JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(this.dir, 'index.html'), require('./report').html(summary));
    store.addRun({ id: this.id, passed, failed, total: this.steps.length, at: summary.finishedAt, baseUrl: this.cfg.baseUrl });
    this.log(`Finished: ${passed} passed, ${failed} failed`, failed ? 'error' : 'ok');
    this.emit({ type: 'run', status: 'done', id: this.id, passed, failed, report: `/reports/${this.id}/index.html` });
  }
}

module.exports = { Run, SUITES };
