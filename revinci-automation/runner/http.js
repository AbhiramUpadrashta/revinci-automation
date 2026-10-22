// HTTP client for the Revinci REST APIs (https://docs.revinci.ai/#api-auth).
// auth:'key'     → Authorization: Bearer <API key>   (documented integration path)
// auth:'session' → Bearer <logged-in user's token>    (read from the automation browser)
function apiBase(run) {
  if (run.cfg.apiBase) return run.cfg.apiBase.replace(/\/$/, '');
  const seen = [...(run.net?.apiBases || [])].find(b => /api/.test(b));
  if (seen) return seen;
  const host = new URL(run.cfg.baseUrl).hostname;          // tessla-workspace-dev.revinci.ai
  const env = (host.match(/-(dev|qa|uat|staging|stage)\./) || [])[1];
  return env ? `https://api-${env}.revinci.ai` : 'https://api.revinci.ai';
}

async function sessionToken(run) {
  if (!run.page) return run.net?.token || null;
  return run.page.evaluate(() => localStorage.getItem('accessToken')).catch(() => run.net?.token || null);
}

async function call(run, method, path, body, { auth = 'key', key, timeout = 30000 } = {}) {
  const url = path.startsWith('http') ? path : apiBase(run) + path;
  const token = auth === 'session' ? await sessionToken(run) : (key || run.apiKey);
  if (!token) throw new Error(auth === 'session' ? 'No session token (browser not logged in)' : 'No API key available — run the API key step or paste a key');
  const headers = { Authorization: `Bearer ${token}`, 'Tenant-Id': run.tenantId, 'Content-Type': 'application/json', Accept: 'application/json' };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  const started = Date.now();
  let status = 0, text = '';
  try {
    const res = await fetch(url, { method, headers, body: body == null ? undefined : JSON.stringify(body), signal: ctl.signal });
    status = res.status;
    text = await res.text();
  } catch (e) {
    text = String(e.message || e);
  } finally { clearTimeout(t); }
  let parsed = text;
  try { parsed = text ? JSON.parse(text) : null; } catch (_) {}
  const rec = { method, path, status, ms: Date.now() - started, auth };
  (run.data.apiCalls = run.data.apiCalls || []).push(rec);
  run.emit && run.emit({ type: 'api', ...rec, sample: typeof text === 'string' ? text.slice(0, 600) : '' });
  return { status, body: parsed, text };
}

const items = b => Array.isArray(b) ? b : (b?.content || b?.data || b?.items || []);

module.exports = { call, apiBase, items, sessionToken };
