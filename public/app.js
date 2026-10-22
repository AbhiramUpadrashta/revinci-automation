const $ = id => document.getElementById(id);
const LS = { get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} } };
let META = {};
const ORDER = ['admin', 'apikey', 'products', 'q2c', 'api'];
const PRESETS = {
  admin: { admin: '*', apikey: '*' },
  products: { products: '*' },
  q2c: { q2c: '*' },
  api: { apikey: '*', api: '*' },
  full: { admin: '*', apikey: '*', products: '*', q2c: '*', api: '*' },
  none: {},
};

async function init() {
  $('baseUrl').value = LS.get('rv.url') || 'https://tessla-workspace-dev.revinci.ai/dashboard/crm/account';
  $('email').value = LS.get('rv.email') || '';
  META = await fetch('/api/meta').then(r => r.json());
  const cfg = await fetch('/api/config').then(r => r.json()).catch(() => ({}));
  if (cfg.forceHeadless) { $('headlessRow').hidden = true; $('hostedNote').hidden = false; }
  renderSuites();
  applyPreset(JSON.parse(LS.get('rv.sel') || 'null') || PRESETS.full);
  refreshState();
  listen();
}

function renderSuites() {
  $('suites').innerHTML = ORDER.map((k, i) => {
    const s = META[k];
    return `<div class="suite" data-suite="${k}">
      <h3><span class="n">${i + 1}</span>${s.title}</h3>
      <label class="chk all"><input type="checkbox" data-all="${k}"> Select all</label>
      ${s.options.map(o => `<label class="chk"><input type="checkbox" data-s="${k}" value="${o.id}"> ${o.label}</label>`).join('')}
    </div>`;
  }).join('');
  $('suites').addEventListener('change', e => {
    const all = e.target.dataset.all;
    if (all) document.querySelectorAll(`[data-s="${all}"]`).forEach(c => c.checked = e.target.checked);
    syncCards();
  });
}

function selection() {
  const out = {};
  for (const k of ORDER) out[k] = [...document.querySelectorAll(`[data-s="${k}"]:checked`)].map(c => c.value);
  return out;
}

function applyPreset(p) {
  for (const k of ORDER) {
    const want = p[k];
    document.querySelectorAll(`[data-s="${k}"]`).forEach(c => c.checked = want === '*' || (Array.isArray(want) && want.includes(c.value)));
  }
  syncCards();
}

function syncCards() {
  const sel = selection();
  let n = 0;
  for (const k of ORDER) {
    const card = document.querySelector(`[data-suite="${k}"]`);
    card.classList.toggle('on', sel[k].length > 0);
    const total = META[k].options.length;
    card.querySelector('[data-all]').checked = sel[k].length === total;
    n += sel[k].length;
  }
  $('planHint').textContent = n ? `${n} test option${n > 1 ? 's' : ''} selected` : 'Nothing selected';
  LS.set('rv.sel', JSON.stringify(sel));
}

document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => applyPreset(PRESETS[b.dataset.preset]));
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== b.dataset.tab);
});

function host() { try { return new URL($('baseUrl').value).host; } catch (_) { return ''; } }

function browserKey() { try { return JSON.parse(LS.get('rv.key.' + host()) || 'null'); } catch (_) { return null; } }

async function refreshState() {
  const s = await fetch('/api/state').then(r => r.json());
  let k = s.apiKeys[host()];
  const bk = browserKey();
  if (!k && bk) k = { name: bk.name, source: (bk.source || 'saved') + ' · this browser', masked: bk.key.slice(0, 12) + '••••••••' + bk.key.slice(-4), savedAt: bk.savedAt, local: true };
  const box = $('keyInfo');
  if (k) {
    box.className = 'keybox';
    box.innerHTML = `<div>${k.name || 'API key'} <span style="opacity:.6">(${k.source || 'stored'})</span></div><div id="keyVal">${k.masked}</div><div style="opacity:.6;margin-top:4px">saved ${new Date(k.savedAt).toLocaleString()}</div>`;
    $('reveal').hidden = $('copy').hidden = false;
  } else {
    box.className = 'keybox empty'; box.textContent = 'No key stored for this workspace yet.';
    $('reveal').hidden = $('copy').hidden = true;
  }
  $('history').innerHTML = s.runs.length ? s.runs.slice(0, 10).map(r => `<div><a href="/reports/${r.id}/index.html" target="_blank">${new Date(r.at).toLocaleString()}</a><span><b style="color:#2d7a12">${r.passed}</b> / <b style="color:#c23b3b">${r.failed}</b></span></div>`).join('') : '<span class="hint">No runs yet.</span>';
  setRunning(s.running);
}
$('baseUrl').addEventListener('change', refreshState);
async function fullKey() { const r = await fetch('/api/apikey/reveal?host=' + encodeURIComponent(host())).then(r => r.ok ? r.json() : {}).catch(() => ({})); return r.key || browserKey()?.key || ''; }
$('reveal').onclick = async () => { $('keyVal').textContent = await fullKey(); };
$('copy').onclick = async () => { await navigator.clipboard.writeText(await fullKey()).catch(() => {}); $('copy').textContent = 'Copied'; setTimeout(() => $('copy').textContent = 'Copy', 1500); };

function setRunning(on) {
  $('run').disabled = on; $('stop').hidden = !on;
  $('status').textContent = on ? 'Running…' : 'Idle';
  $('status').className = 'badge' + (on ? ' run' : '');
}

$('run').onclick = async () => {
  $('err').style.display = 'none';
  const body = {
    baseUrl: $('baseUrl').value.trim(), email: $('email').value.trim(), password: $('password').value,
    suites: selection(), headless: $('headless').checked, video: $('video').checked, slowMo: +$('slowMo').value,
    apiKey: $('apiKey').value.trim() || (browserKey()?.key || ''), rotateKey: $('rotateKey').checked, apiBase: $('apiBase').value,
    product: $('product').value, account: $('account').value, planNumber: $('planNumber').value,
  };
  if ($('rotateKey').checked && !confirm('This will revoke the currently active API key in Revinci. Anything using it will stop working. Continue?')) return;
  if ($('remember').checked) { LS.set('rv.url', body.baseUrl); LS.set('rv.email', body.email); }
  const r = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) { $('err').textContent = j.error; $('err').style.display = 'block'; return; }
  resetView(j.tag); setRunning(true);
  document.querySelector('[data-tab="live"]').click();
};
$('stop').onclick = () => fetch('/api/stop', { method: 'POST' });

const steps = new Map();
let counts = { p: 0, f: 0 };
function resetView(tag) {
  steps.clear(); counts = { p: 0, f: 0 };
  $('steps').innerHTML = ''; $('log').innerHTML = ''; $('apis').innerHTML = '';
  $('kp').textContent = 0; $('kf').textContent = 0; $('kt').textContent = 0; $('ktag').textContent = tag || '—';
  $('reportBox').hidden = true;
}
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function onStep(s) {
  let li = steps.get(s.name + s.start);
  if (!li) { li = document.createElement('li'); steps.set(s.name + s.start, li); $('steps').appendChild(li); $('kt').textContent = steps.size; }
  const d = s.error || s.detail || '';
  li.innerHTML = `<span class="dot ${s.status}"></span><span>${esc(s.name)}</span><span class="hint">${s.end ? ((s.end - s.start) / 1000).toFixed(1) + 's' : ''}</span>${d ? `<span class="d ${s.error ? 'err' : ''}">${esc(d)}</span>` : ''}`;
  if (s.end) {
    counts = { p: [...$('steps').querySelectorAll('.dot.passed')].length, f: [...$('steps').querySelectorAll('.dot.failed')].length };
    $('kp').textContent = counts.p; $('kf').textContent = counts.f;
  }
  li.scrollIntoView({ block: 'nearest' });
}

function listen() {
  const es = new EventSource('/api/events');
  es.onmessage = m => {
    const ev = JSON.parse(m.data);
    if (ev.type === 'step') onStep(ev.step);
    if (ev.type === 'log') { const div = document.createElement('div'); div.className = ev.level; div.textContent = `${new Date(ev.t || Date.now()).toLocaleTimeString()}  ${ev.msg}`; $('log').appendChild(div); $('log').scrollTop = 1e9; }
    if (ev.type === 'api') { const tr = document.createElement('tr'); tr.innerHTML = `<td class="code">${ev.method}</td><td class="code">${esc(ev.path)}</td><td class="code s${String(ev.status)[0]}">${ev.status}</td><td>${ev.ms}</td><td>${ev.auth}</td>`; tr.title = ev.sample || ''; $('apis').appendChild(tr); }
    if (ev.type === 'screen') { $('screen').src = 'data:image/jpeg;base64,' + ev.data; $('liveUrl').textContent = ev.url || ''; $('liveHint').hidden = true; }
    if (ev.type === 'apikey') { if (ev.key) LS.set('rv.key.' + host(), JSON.stringify({ key: ev.key, name: ev.name, source: ev.source, savedAt: Date.now() })); refreshState(); }
    if (ev.type === 'run' && ev.status === 'running') { if (!steps.size) resetView(ev.tag); setRunning(true); }
    if (ev.type === 'run' && ev.status === 'done') { setRunning(false); $('reportBox').hidden = false; $('reportLink').href = ev.report; refreshState(); }
  };
}
init();
