const $ = id => document.getElementById(id);
const LS = { get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} } };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let META = {};
const ORDER = ['admin', 'apikey', 'products', 'q2c', 'api'];
const PRESETS = {
  admin: { admin: '*', apikey: '*' },
  products: { products: '*' },
  q2c: { q2c: '*' },
  order: { admin: ['account'], q2c: ['order', 'entitlement'] },
  api: { apikey: '*', api: '*' },
  full: { admin: '*', apikey: '*', products: '*', q2c: '*', api: '*' },
  none: {},
};
// Options that need a name typed by the user (mandatory when selected).
const NAMED = { admin: ['account'], products: '*', q2c: ['quote', 'order'] };
const DEFAULT_NAMES = {
  feature: 'AT Feature', option: 'AT Option', agentFeature: 'AT Agent Feature', featureOffering: 'AT Feature Offering',
  standalone: 'AT Product', optionGroup: 'AT Option Group', bundle: 'AT Bundle', productWithFeatures: 'AT Product with Features',
  productWithOfferings: 'AT Product with Offerings', agentSimple: 'AT Simple Agent', agentWorkflow: 'AT Workflow Agent',
  quote: 'AT Quote', order: 'AT Order', account: 'AT Customer',
};

async function init() {
  $('baseUrl').value = LS.get('rv.url') || 'https://tessla-workspace-dev.revinci.ai/dashboard';
  $('email').value = LS.get('rv.email') || '';
  META = await fetch('/api/meta').then(r => r.json());
  const cfg = await fetch('/api/config').then(r => r.json()).catch(() => ({}));
  if (cfg.build) $('build').textContent = 'build ' + cfg.build;
  if (cfg.forceHeadless) { $('headlessRow').hidden = true; $('hostedNote').hidden = false; }
  const w = LS.get('rv.wait') || 'standard';
  document.querySelector(`input[name=wait][value=${w}]`).checked = true;
  $('waitMax').value = LS.get('rv.waitMax') || 10;
  syncWait();
  renderSuites();
  applyPreset(JSON.parse(LS.get('rv.sel') || 'null') || PRESETS.full);
  refreshState();
  listen();
}

/* ---------- test selection ---------- */
function renderSuites() {
  $('suites').innerHTML = ORDER.map(k => {
    const s = META[k];
    return `<div class="suite" data-suite="${k}">
      <h3>${esc(s.title)}<label><input type="checkbox" data-all="${k}"> all</label></h3>
      ${s.options.map(o => `<label class="chk"><input type="checkbox" data-s="${k}" value="${o.id}"> ${esc(o.label)}</label>`).join('')}
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
    card.querySelector('[data-all]').checked = sel[k].length === META[k].options.length;
    n += sel[k].length;
  }
  $('planHint').textContent = n ? `${n} test option${n > 1 ? 's' : ''} selected` : 'Nothing selected';
  LS.set('rv.sel', JSON.stringify(sel));
  renderNames(sel);
  renderSeq(sel);
}
document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => applyPreset(PRESETS[b.dataset.preset]));

/* ---------- names per product type / quote / order ---------- */
function namedOptions(sel) {
  const out = [];
  for (const [suite, ids] of Object.entries(NAMED)) {
    for (const id of sel[suite] || []) {
      if (ids !== '*' && !ids.includes(id)) continue;
      const o = META[suite].options.find(x => x.id === id);
      out.push({ suite, id, label: o ? o.label : id });
    }
  }
  return out;
}
function renderNames(sel) {
  const opts = namedOptions(sel);
  $('namesBox').hidden = !opts.length;
  const prev = collectNames(false);
  $('names').innerHTML = opts.map(o => {
    const key = `${o.suite}.${o.id}`;
    const v = prev[key] ?? LS.get('rv.name.' + key) ?? DEFAULT_NAMES[o.id] ?? '';
    const short = { account: 'Account name', order: 'Order name', quote: 'Quote name' }[o.id] || `${o.label} name`;
    return `<div><label class="f" for="nm-${o.id}">${esc(short)}</label><input type="text" id="nm-${o.id}" data-name="${key}" value="${esc(v)}" placeholder="Name for ${esc(o.label)}"></div>`;
  }).join('');
  $('names').querySelectorAll('input').forEach(i => i.addEventListener('input', () => { i.classList.remove('missing'); LS.set('rv.name.' + i.dataset.name, i.value); }));
}
function collectNames(validate = true) {
  const out = {}; let missing = 0;
  document.querySelectorAll('[data-name]').forEach(i => {
    const v = i.value.trim();
    out[i.dataset.name] = v;
    if (validate && !v) { i.classList.add('missing'); missing++; }
  });
  if (validate && missing) throw new Error(`Enter a name for ${missing} selected item${missing > 1 ? 's' : ''} (highlighted in red).`);
  return out;
}

/* ---------- wait mode ---------- */
function syncWait() {
  const v = document.querySelector('input[name=wait]:checked').value;
  $('waitMaxRow').hidden = v !== 'visible';
  $('waitHint').textContent = v === 'visible'
    ? 'Each step keeps waiting until its button or page is visible, up to the limit below.'
    : 'Each step waits up to 20 seconds for its button or page.';
  LS.set('rv.wait', v);
}
document.querySelectorAll('input[name=wait]').forEach(r => r.addEventListener('change', syncWait));
$('waitMax').addEventListener('change', () => LS.set('rv.waitMax', $('waitMax').value));

/* ---------- tabs ---------- */
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== b.dataset.tab);
});

/* ---------- API key ---------- */
function host() { try { return new URL($('baseUrl').value).host; } catch (_) { return ''; } }
function browserKey() { try { return JSON.parse(LS.get('rv.key.' + host()) || 'null'); } catch (_) { return null; } }
async function fullKey() { const r = await fetch('/api/apikey/reveal?host=' + encodeURIComponent(host())).then(r => r.ok ? r.json() : {}).catch(() => ({})); return r.key || browserKey()?.key || ''; }
$('reveal').onclick = async () => { $('keyVal').textContent = await fullKey(); };
$('copy').onclick = async () => { await navigator.clipboard.writeText(await fullKey()).catch(() => {}); $('copy').textContent = 'Copied'; setTimeout(() => $('copy').textContent = 'Copy', 1500); };
$('saveKey').onclick = async () => {
  const key = $('apiKey').value.trim();
  if (!/^rvc_/.test(key)) { $('keyMsg').textContent = 'Paste a Revinci API key (it starts with rvc_).'; return; }
  const r = await fetch('/api/apikey', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: $('baseUrl').value.trim(), key }) });
  if (!r.ok) { $('keyMsg').textContent = (await r.json().catch(() => ({}))).error || 'Could not save the key.'; return; }
  LS.set('rv.key.' + host(), JSON.stringify({ key, name: 'saved from panel', source: 'pasted', savedAt: Date.now() }));
  $('apiKey').value = '';
  $('keyMsg').textContent = 'Saved. Runs on this workspace will use this key.';
  refreshState();
};

/* ---------- state + recent runs ---------- */
function fmtDur(ms) { if (!ms) return '—'; const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; }
function ago(t) { const s = (Date.now() - new Date(t)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return new Date(t).toLocaleDateString(); }
async function refreshState() {
  const s = await fetch('/api/state').then(r => r.json());
  let k = s.apiKeys[host()];
  const bk = browserKey();
  if (!k && bk) k = { name: bk.name, source: (bk.source || 'saved') + ' · this browser', masked: bk.key.slice(0, 12) + '••••••••' + bk.key.slice(-4), savedAt: bk.savedAt };
  const box = $('keyInfo');
  if (k) {
    box.className = 'keybox';
    box.innerHTML = `<div>${esc(k.name || 'API key')} <span style="opacity:.6">(${esc(k.source || 'stored')})</span></div><div id="keyVal">${esc(k.masked)}</div><div style="opacity:.6;margin-top:4px">saved ${new Date(k.savedAt).toLocaleString()}</div>`;
    $('reveal').hidden = $('copy').hidden = false;
  } else {
    box.className = 'keybox empty'; box.textContent = 'No key saved for this workspace yet.';
    $('reveal').hidden = $('copy').hidden = true;
  }
  const runs = (s.runs || []).slice(0, 4);
  $('history').innerHTML = runs.length ? runs.map(r => {
    const total = r.total || (r.passed + r.failed) || 1;
    const pct = Math.round((r.passed / total) * 100);
    const ok = !r.failed;
    return `<a class="run-card" href="/reports/${encodeURIComponent(r.id)}/index.html" target="_blank" rel="noopener">
      <div class="r1"><span class="pill ${ok ? 'ok' : 'bad'}">${ok ? 'Passed' : `${r.failed} failed`}</span><span>${ago(r.at)}</span></div>
      <div class="r2">${pct}%<small>${r.passed}/${total} steps</small></div>
      <div class="bar"><b style="width:${pct}%"></b></div>
      <div class="r3"><span>${esc(r.tag || r.id.slice(11, 19))}</span><span>${fmtDur(r.ms)}${r.apiFailures ? ` · ${r.apiFailures} API err` : ''}</span></div>
    </a>`;
  }).join('') : '<div class="run-empty">Your last 4 runs will appear here with pass rate, duration and a link to each report.</div>';
  setRunning(s.running);
}
$('baseUrl').addEventListener('change', refreshState);

function setRunning(on) {
  $('run').disabled = on; $('stop').hidden = !on;
  $('status').className = 'status' + (on ? ' run' : '');
  $('status').querySelector('span').textContent = on ? 'Running' : 'Idle';
}

/* ---------- run ---------- */
$('run').onclick = async () => {
  const errBox = $('err'); errBox.style.display = 'none';
  let names;
  try { names = collectNames(true); } catch (e) { errBox.textContent = e.message; errBox.style.display = 'block'; return; }
  const waitMode = document.querySelector('input[name=wait]:checked').value;
  const body = {
    baseUrl: $('baseUrl').value.trim(), email: $('email').value.trim(), password: $('password').value,
    suites: selection(), names, order: SEQ.slice(), waitMode, waitMaxMin: +$('waitMax').value || 10,
    headless: $('headless').checked, video: $('video').checked, slowMo: +$('slowMo').value,
    apiKey: browserKey()?.key || '', rotateKey: $('rotateKey').checked, apiBase: $('apiBase').value, planNumber: $('planNumber').value,
  };
  if ($('rotateKey').checked && !confirm('This revokes the active API key in Revinci. Anything using it stops working. Continue?')) return;
  if ($('remember').checked) { LS.set('rv.url', body.baseUrl); LS.set('rv.email', body.email); }
  const r = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) { errBox.textContent = j.error; errBox.style.display = 'block'; return; }
  resetView(j.tag); setRunning(true);
  document.querySelector('[data-tab="live"]').click();
};
$('stop').onclick = () => fetch('/api/stop', { method: 'POST' });

/* ---------- results ---------- */
const steps = new Map();
let failCount = 0;
function resetView(tag) {
  steps.clear(); failCount = 0;
  $('steps').innerHTML = ''; $('log').innerHTML = ''; $('apis').innerHTML = '';
  $('fails').innerHTML = '<div class="empty">No failed API calls in this run yet.</div>';
  ['kp', 'kf', 'kt', 'ka'].forEach(i => $(i).textContent = 0);
  $('failCnt').textContent = ''; $('ktag').textContent = tag || '—';
  $('reportBox').hidden = true;
}
function onStep(s) {
  let li = steps.get(s.name + s.start);
  if (!li) { li = document.createElement('li'); steps.set(s.name + s.start, li); $('steps').appendChild(li); $('kt').textContent = steps.size; }
  const d = s.error || s.detail || '';
  const apiNote = s.apiFailures ? ` · ${s.apiFailures} failed API call${s.apiFailures > 1 ? 's' : ''} (see Failed APIs)` : '';
  li.innerHTML = `<span class="dot ${s.status}"></span><span>${esc(s.name)}</span><span class="hint">${s.end ? ((s.end - s.start) / 1000).toFixed(1) + 's' : ''}</span>${d || apiNote ? `<span class="d ${s.error ? 'err' : ''}">${esc(d)}${esc(apiNote)}</span>` : ''}`;
  if (s.end) {
    $('kp').textContent = $('steps').querySelectorAll('.dot.passed').length;
    $('kf').textContent = $('steps').querySelectorAll('.dot.failed').length;
  }
  li.scrollIntoView({ block: 'nearest' });
}
const pretty = v => { if (v == null || v === '') return '(empty)'; if (typeof v !== 'string') return JSON.stringify(v, null, 2); try { return JSON.stringify(JSON.parse(v), null, 2); } catch (_) { return v; } };
function onFail(f) {
  if (!failCount) $('fails').innerHTML = '';
  failCount++;
  $('ka').textContent = failCount; $('failCnt').textContent = failCount;
  const el = document.createElement('details');
  el.className = 'fail';
  const path = (() => { try { const u = new URL(f.url); return u.pathname + u.search; } catch (_) { return f.url; } })();
  el.innerHTML = `<summary><span class="m">${esc(f.method)}</span><span class="st">${f.status || 'ERR'} ${esc(f.statusText || '')}</span><span class="u" title="${esc(f.url)}">${esc(path)}</span><span class="meta">${esc(f.source === 'screen' ? 'from screen' : 'API test')}${f.step ? ' · ' + esc(f.step) : ''}</span></summary>
    <div class="body">
      <div><h4>Request · ${esc(f.method)} ${esc(f.url)}</h4><pre>${esc(pretty(f.requestHeaders))}</pre><h4>Request payload</h4><pre>${esc(pretty(f.requestBody))}</pre></div>
      <div><h4>Response · ${f.status || 'no response'}${f.ms ? ` · ${f.ms} ms` : ''}</h4><pre>${esc(pretty(f.responseHeaders))}</pre><h4>Response body</h4><pre>${esc(f.error ? f.error + '\n\n' : '')}${esc(pretty(f.responseBody))}</pre></div>
    </div>`;
  $('fails').prepend(el);
}
function listen() {
  const es = new EventSource('/api/events');
  es.onmessage = m => {
    const ev = JSON.parse(m.data);
    if (ev.type === 'step') onStep(ev.step);
    if (ev.type === 'apifail') onFail(ev.failure);
    if (ev.type === 'log') { const div = document.createElement('div'); div.className = ev.level; div.textContent = `${new Date(ev.t || Date.now()).toLocaleTimeString()}  ${ev.msg}`; $('log').appendChild(div); $('log').scrollTop = 1e9; }
    if (ev.type === 'api') { const tr = document.createElement('tr'); tr.innerHTML = `<td class="code">${esc(ev.method)}</td><td class="code p">${esc(ev.path)}</td><td class="code s${String(ev.status)[0]}">${ev.status}</td><td>${ev.ms}</td><td>${esc(ev.auth)}</td>`; tr.title = ev.sample || ''; $('apis').appendChild(tr); }
    if (ev.type === 'screen') { drawFrame(ev.data); if (ev.url) $('liveUrl').textContent = ev.url; $('liveHint').hidden = true; }
    if (ev.type === 'apikey') { if (ev.key) LS.set('rv.key.' + host(), JSON.stringify({ key: ev.key, name: ev.name, source: ev.source, savedAt: Date.now() })); refreshState(); }
    if (ev.type === 'run' && ev.status === 'running') { if (!steps.size) resetView(ev.tag); setRunning(true); }
    if (ev.type === 'run' && ev.status === 'done') { setRunning(false); $('reportBox').hidden = false; $('reportLink').href = ev.report; refreshState(); }
  };
}
init();

/* ---------- live view: decode off-thread, draw on a canvas, always show the newest frame ---------- */
let frameBusy = false, frameNext = null;
async function drawFrame(b64) {
  frameNext = b64;
  if (frameBusy) return;          // drop stale frames instead of queueing them
  frameBusy = true;
  try {
    while (frameNext) {
      const data = frameNext; frameNext = null;
      const blob = await (await fetch('data:image/jpeg;base64,' + data)).blob();
      const bmp = await createImageBitmap(blob);
      const c = $('screen');
      if (c.width !== bmp.width || c.height !== bmp.height) { c.width = bmp.width; c.height = bmp.height; }
      await new Promise(r => requestAnimationFrame(r));
      c.getContext('2d').drawImage(bmp, 0, 0);
      c.classList.add('on');
      bmp.close && bmp.close();
    }
  } catch (_) {} finally { frameBusy = false; }
}

/* ---------- run order: drag & drop or arrows, remembered per browser ---------- */
let SEQ = (() => { try { return JSON.parse(LS.get('rv.seq') || '[]'); } catch (_) { return []; } })();
const SUITE_SHORT = { admin: 'Admin setup', apikey: 'API key', products: 'Product setup', q2c: 'Quote · Order · Entitlement', api: 'API testing' };
function defaultKeys(sel) { const out = []; for (const k of ORDER) for (const id of sel[k] || []) out.push(`${k}.${id}`); return out; }
function renderSeq(sel = selection()) {
  const all = defaultKeys(sel);
  SEQ = SEQ.filter(k => all.includes(k));
  for (const k of all) if (!SEQ.includes(k)) SEQ.push(k);
  LS.set('rv.seq', JSON.stringify(SEQ));
  $('seqBox').hidden = SEQ.length < 1;
  $('seqHint').textContent = SEQ.length > 1 ? 'Drag steps, or use the arrows, to choose what runs first.' : 'Tick more steps above to set which one runs first.';
  $('seq').innerHTML = SEQ.map((k, i) => {
    const [suite, id] = k.split('.');
    const o = META[suite]?.options.find(x => x.id === id);
    return `<li class="seq-item" draggable="true" data-k="${esc(k)}">
      <span class="grip" aria-hidden="true">⠿</span><span class="num">${i + 1}</span>
      <span class="txt"><b>${esc(o ? o.label : id)}</b><small>${esc(SUITE_SHORT[suite] || suite)}</small></span>
      <span class="mv"><button type="button" data-mv="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" data-mv="1" aria-label="Move down" ${i === SEQ.length - 1 ? 'disabled' : ''}>↓</button></span>
    </li>`;
  }).join('');
  const custom = SEQ.join() !== all.join();
  $('seqReset').hidden = !custom;
}
function moveSeq(k, to) {
  const from = SEQ.indexOf(k); if (from < 0 || to < 0 || to >= SEQ.length || to === from) return;
  SEQ.splice(from, 1); SEQ.splice(to, 0, k);
  renderSeq();
  const li = $('seq').querySelector(`[data-k="${CSS.escape(k)}"]`); if (li) { li.classList.add('moved'); li.querySelector(`[data-mv]`)?.focus({ preventScroll: true }); }
}
$('seq').addEventListener('click', e => {
  const b = e.target.closest('[data-mv]'); if (!b) return;
  const k = b.closest('.seq-item').dataset.k;
  moveSeq(k, SEQ.indexOf(k) + Number(b.dataset.mv));
  const again = $('seq').querySelector(`[data-k="${CSS.escape(k)}"] [data-mv="${b.dataset.mv}"]`); if (again && !again.disabled) again.focus();
});
$('seqReset').onclick = () => { SEQ = []; renderSeq(); };
// mouse drag (HTML5)
let dragK = null;
$('seq').addEventListener('dragstart', e => { const li = e.target.closest('.seq-item'); if (!li) return; dragK = li.dataset.k; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragK); });
$('seq').addEventListener('dragend', () => { dragK = null; $('seq').querySelectorAll('.dragging,.over').forEach(x => x.classList.remove('dragging', 'over')); });
$('seq').addEventListener('dragover', e => { const li = e.target.closest('.seq-item'); if (!li || !dragK) return; e.preventDefault(); $('seq').querySelectorAll('.over').forEach(x => x.classList.remove('over')); if (li.dataset.k !== dragK) li.classList.add('over'); });
$('seq').addEventListener('drop', e => { const li = e.target.closest('.seq-item'); if (!li || !dragK) return; e.preventDefault(); moveSeq(dragK, SEQ.indexOf(li.dataset.k)); });
// touch / pen drag on the grip
$('seq').addEventListener('pointerdown', e => {
  const grip = e.target.closest('.grip'); if (!grip || e.pointerType === 'mouse') return;
  const li = grip.closest('.seq-item'); const k = li.dataset.k; li.classList.add('dragging');
  const move = ev => { const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.seq-item'); $('seq').querySelectorAll('.over').forEach(x => x.classList.remove('over')); if (t && t.dataset.k !== k) t.classList.add('over'); };
  const up = ev => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.seq-item'); li.classList.remove('dragging'); if (t && t.dataset.k !== k) moveSeq(k, SEQ.indexOf(t.dataset.k)); else renderSeq(); };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); e.preventDefault();
});
