/*
 * Revinci Test Automation — in-browser runner.
 * Runs inside a logged-in Revinci tab (bookmarklet or console). Nothing to install.
 *  - Drives Revinci screens in a same-origin frame (left), control panel on the right.
 *  - Uses the tab's own session for the Revinci APIs (Authorization + Tenant-Id).
 *  - Stores the API key in this browser's localStorage for the workspace.
 */
(function () {
  'use strict';
  if (window.__rvAuto) { window.__rvAuto.show(); return; }

  const ORIGIN = location.origin;
  const HOST = location.host;
  const TENANT = () => localStorage.getItem('tenant') || (HOST.split('-')[0]);
  const TOKEN = () => localStorage.getItem('accessToken');
  const LOGO = '<svg viewBox="0 0 804 603" xmlns="http://www.w3.org/2000/svg"><path d="M796.867 0H370.227C351.277 0 333.297 8.38 321.117 22.89L259.677 96.04C256.097 100.3 259.127 106.8 264.687 106.8H691.047C709.997 106.8 727.977 98.42 740.157 83.91L801.787 10.54C805.297 6.37 802.327 0 796.877 0Z" fill="#1D231D"/><path d="M678.397 135.74H251.757C232.807 135.74 214.827 144.12 202.647 158.63L147.007 224.87C144.127 227.91 140.747 231.08 137.307 233.44C129.297 238.93 123.897 241.88 113.197 242.54H6.427C.977 242.54-1.993 248.91 1.517 253.08L273.607 576.99C287.267 593.25 307.417 602.64 328.657 602.64H420.857C426.307 602.64 429.277 596.27 425.767 592.1L150.797 264.76C148.307 260.76 146.517 255.5 149.377 250.5C152.637 244.8 159.627 243.02 165.007 242.53H572.568C591.518 242.53 609.497 234.15 621.677 219.64L683.307 146.27C686.818 142.1 683.847 135.73 678.397 135.73Z" fill="#1D231D"/></svg>';

  // ───────────────────────── utilities ─────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const html = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const p2 = n => String(n).padStart(2, '0');
  const fmt = d => `${p2(d.getDate())}-${p2(d.getMonth() + 1)}-${d.getFullYear()}`;
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('rvAuto.' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem('rvAuto.' + k, JSON.stringify(v)); } catch (_) {} },
  };

  function apiBase() {
    const o = LS.get('apiBase', '');
    if (o) return o.replace(/\/$/, '');
    const seen = performance.getEntriesByType('resource').map(e => e.name).find(u => /^https:\/\/api[^/]*\.revinci\.ai\/[a-z-]+\/api\/v1\//.test(u));
    if (seen) return seen.match(/^https:\/\/[^/]+/)[0];
    const env = (HOST.match(/-(dev|qa|uat|staging|stage)\./) || [])[1];
    return env ? `https://api-${env}.revinci.ai` : 'https://api.revinci.ai';
  }

  // ───────────────────────── run state ─────────────────────────
  const R = { running: false, stop: false, steps: [], data: {}, calls: [], tag: '', apiKey: null };

  async function api(method, path, body, { auth = 'session', key } = {}) {
    const token = auth === 'key' ? (key || R.apiKey) : TOKEN();
    if (!token) throw new Error(auth === 'key' ? 'No API key available' : 'Not logged in to Revinci');
    const t0 = Date.now();
    let status = 0, text = '';
    try {
      const res = await fetch(apiBase() + path, { method, headers: { Authorization: 'Bearer ' + token, 'Tenant-Id': TENANT(), 'Content-Type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) });
      status = res.status; text = await res.text();
    } catch (e) { text = String(e.message || e); }
    let parsed = text; try { parsed = text ? JSON.parse(text) : null; } catch (_) {}
    const rec = { method, path, status, ms: Date.now() - t0, auth, sample: String(text).slice(0, 400) };
    R.calls.push(rec); UI.call(rec);
    return { status, body: parsed, text };
  }
  const items = b => Array.isArray(b) ? b : (b?.content || b?.data || b?.items || []);

  // ───────────────────────── frame driver ─────────────────────────
  let frame;
  const W = () => frame.contentWindow;
  const D = () => frame.contentDocument;
  const visible = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && W().getComputedStyle(el).visibility !== 'hidden'; };
  const $$ = (sel, root) => [...(root || D()).querySelectorAll(sel)];
  const $v = (sel, root) => $$(sel, root).filter(visible);

  async function waitFor(fn, timeout = 15000, what = 'element') {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (R.stop) throw new Error('Stopped');
      try { const v = fn(); if (v) return v; } catch (_) {}
      await sleep(200);
    }
    throw new Error(`Timed out waiting for ${what}`);
  }

  async function idle(ms = 500) {
    await sleep(ms);
    await waitFor(() => !$v('.ant-spin-spinning, .ant-skeleton-active').length, 15000, 'page to finish loading').catch(() => {});
  }

  async function go(path) {
    const url = ORIGIN + path;
    await new Promise((resolve) => {
      const done = () => { frame.removeEventListener('load', done); resolve(); };
      frame.addEventListener('load', done);
      frame.src = url;
      setTimeout(resolve, 30000);
    });
    await waitFor(() => D() && D().readyState === 'complete' && D().body && D().body.innerText.length > 50, 30000, 'page');
    if (/realms\/.*\/protocol/.test(W().location.href)) throw new Error('Session expired — log in to Revinci again and rerun');
    await idle(1200);
    UI.url(W().location.pathname + W().location.search);
  }

  function fire(el, type, init = {}) {
    const w = el.ownerDocument.defaultView;
    const C = /^key/.test(type) ? w.KeyboardEvent : /^(mouse|click)/.test(type) ? w.MouseEvent : w.Event;
    el.dispatchEvent(new C(type, { bubbles: true, cancelable: true, view: w, ...init }));
  }
  function clickEl(el) {
    el.scrollIntoView({ block: 'center' });
    fire(el, 'mousedown'); fire(el, 'mouseup'); el.click();
  }
  function setValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    el.focus();
    setter ? setter.call(el, value) : (el.value = value);
    fire(el, 'input'); fire(el, 'change');
  }
  function key(el, k) {
    const codes = { Enter: 13, Escape: 27 };
    fire(el, 'keydown', { key: k, code: k, keyCode: codes[k], which: codes[k] });
    fire(el, 'keyup', { key: k, code: k, keyCode: codes[k], which: codes[k] });
  }

  function formItem(label) {
    const want = label.toLowerCase();
    return $v('.ant-form-item').find(fi => {
      const l = fi.querySelector('.ant-form-item-label');
      return l && l.innerText.replace(/\*/g, '').trim().toLowerCase() === want;
    });
  }

  async function fill(label, value, id) {
    const el = await waitFor(() => (id && $v('#' + id)[0]) || formItem(label)?.querySelector('input:not([type=hidden]):not(.ant-select-selection-search-input), textarea'), 15000, `field "${label}"`);
    setValue(el, String(value));
    await sleep(120);
  }

  function dropdown() { return $v('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').pop(); }
  async function openSelect(label, id) {
    const sel = await waitFor(() => (id && $v('#' + id)[0]?.closest('.ant-select')) || formItem(label)?.querySelector('.ant-select'), 15000, `dropdown "${label}"`);
    fire(sel.querySelector('.ant-select-selector'), 'mousedown');
    await sleep(350);
    return sel;
  }
  async function select(label, text, { id, create, optional, multi } = {}) {
    const sel = await openSelect(label, id);
    const search = sel.querySelector('input.ant-select-selection-search-input');
    if (search && !search.readOnly) { setValue(search, String(text)); await sleep(700); }
    const dd = await waitFor(() => dropdown(), 4000, 'options').catch(() => null);
    const opts = dd ? $$('.ant-select-item-option', dd) : [];
    const exact = opts.find(o => o.innerText.trim().toLowerCase() === String(text).toLowerCase());
    const loose = opts.find(o => o.innerText.toLowerCase().includes(String(text).toLowerCase()));
    const pick = exact || loose;
    if (pick) clickEl(pick);
    else if (create && search) key(search, 'Enter');
    else { if (search) key(search, 'Escape'); if (optional) return null; throw new Error(`Option "${text}" not found in ${label}`); }
    await sleep(300);
    if (multi && search) key(search, 'Escape');
    return pick ? pick.innerText.trim() : text;
  }
  async function selectFirst(label, { id, avoid = [] } = {}) {
    await openSelect(label, id);
    const dd = await waitFor(() => dropdown(), 6000, `options in ${label}`);
    const opts = await waitFor(() => { const o = $$('.ant-select-item-option:not(.ant-select-item-option-disabled)', dd); return o.length && o; }, 6000, `options in ${label}`);
    const pick = opts.find(o => !avoid.some(a => o.innerText.toLowerCase().includes(a.toLowerCase()))) || opts[0];
    const t = pick.innerText.trim();
    clickEl(pick); await sleep(300);
    return t;
  }
  async function tags(label, values) {
    const sel = await openSelect(label);
    const input = sel.querySelector('input.ant-select-selection-search-input');
    for (const v of values) { setValue(input, v); await sleep(250); key(input, 'Enter'); await sleep(200); }
    key(input, 'Escape');
  }
  async function date(id, d) {
    const el = await waitFor(() => $v('#' + id)[0], 10000, `date ${id}`);
    fire(el, 'mousedown'); el.click(); await sleep(250);
    setValue(el, fmt(d)); await sleep(200); key(el, 'Enter'); await sleep(250);
  }
  async function dateRange(label, from, to) {
    const ins = formItem(label).querySelectorAll('.ant-picker input');
    fire(ins[0], 'mousedown'); ins[0].click(); await sleep(250);
    setValue(ins[0], fmt(from)); key(ins[0], 'Enter'); await sleep(250);
    setValue(ins[1], fmt(to)); key(ins[1], 'Enter'); await sleep(250);
  }
  async function checkbox(text, on = true) {
    const w = $v('.ant-checkbox-wrapper').find(x => x.innerText.toLowerCase().includes(text.toLowerCase()));
    if (!w) throw new Error(`Checkbox "${text}" not found`);
    if (!!w.querySelector('.ant-checkbox-checked') !== on) clickEl(w.querySelector('input') || w);
  }
  function findButton(text, exact = true) {
    const re = exact ? new RegExp(`^\\s*\\+?\\s*${esc(text)}\\s*(→)?\\s*$`, 'i') : new RegExp(esc(text), 'i');
    return $v('button, [role=button], a.ant-btn').find(b => re.test(b.innerText || b.textContent || ''));
  }
  async function button(text, { timeout = 15000 } = {}) {
    const b = await waitFor(() => findButton(text), timeout, `button "${text}"`);
    if (b.disabled) throw new Error(`Button "${text}" is disabled`);
    clickEl(b); await idle(500);
  }
  async function buttonAny(labels, timeout = 4000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      for (const l of labels) { const b = findButton(l); if (b && !b.disabled) { clickEl(b); await idle(500); return l; } }
      await sleep(250);
    }
    return null;
  }
  async function toast(timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const bad = $v('.ant-message-error, .ant-notification-notice-error')[0];
      if (bad) throw new Error('App error: ' + bad.innerText.trim().slice(0, 200));
      const errs = $v('.ant-form-item-explain-error').map(e => e.innerText.trim()).filter(Boolean);
      if (errs.length) throw new Error('Validation: ' + errs.join('; ').slice(0, 200));
      const ok = $v('.ant-message-success, .ant-notification-notice-success, .ant-message-notice')[0];
      if (ok) return ok.innerText.trim().slice(0, 120);
      await sleep(250);
    }
    return '';
  }
  const clickText = async (re, root) => { const el = await waitFor(() => $v('*', root).filter(e => !e.children.length).find(e => re.test(e.textContent.trim())), 6000, String(re)); clickEl(el); await sleep(400); return el; };

  // ───────────────────────── suites ─────────────────────────
  const CURRENCIES = ['GBP', 'AUD', 'CAD', 'SGD', 'JPY', 'AED', 'CHF', 'NZD', 'ZAR', 'SEK', 'NOK', 'HKD', 'MXN', 'BRL'];

  const ADMIN = {
    async currency() {
      await go('/dashboard/metabench/currency');
      const existing = $$('.ant-table-tbody tr').map(r => r.innerText).join(' ');
      const iso = CURRENCIES.find(c => !new RegExp(`\\b${c}\\b`).test(existing));
      if (!iso) return 'all candidate currencies already exist — skipped';
      await button('Currency');
      (await select('Currency', iso, { optional: true })) || (await selectFirst('Currency'));
      await fill('Currency Display Name', `${iso} ${R.tag}`, 'currencyDisplayName');
      await button('Add Currency');
      await toast(); R.data.currency = iso;
      return `${iso} added`;
    },
    async exchangeRate() {
      await go('/dashboard/metabench/currencyExchangeRate');
      await button('Currency Exchange Rate');
      const base = formItem('Base Currency Iso Code')?.querySelector('.ant-select-selection-item');
      if (!base) await select('Base Currency Iso Code', 'USD', { optional: true });
      const target = R.data.currency || 'INR';
      (await select('Target Currency Iso Code', target, { optional: true })) || (await selectFirst('Target Currency Iso Code', { avoid: ['USD'] }));
      await fill('Exchange Rate', target === 'INR' ? '83.25' : '1.35');
      (await select('Rate Type', 'Spot', { optional: true })) || (await selectFirst('Rate Type'));
      const end = new Date(); end.setMonth(end.getMonth() + 2);
      await dateRange('Effective Date Range', new Date(), end);
      await fill('Source', `automation ${R.tag}`, 'source');
      await button('Save'); await toast();
      return `USD → ${target}`;
    },
    async uom() {
      await go('/dashboard/setup/uom');
      await button('Unit Of Measure');
      const name = `AT Per Token ${R.tag}`;
      await fill('Name', name, 'name');
      const fam = (await select('UOM Family', 'Time', { optional: true })) || (await selectFirst('UOM Family'));
      await fill('Measure UOM', 'token', 'measureUoM');
      await button('Create'); await toast();
      R.data.uom = name; return `${name} (${fam})`;
    },
    async attribute() {
      await go('/dashboard/setup/attribute');
      await button('Attribute');
      await waitFor(() => /attribute\/form/.test(W().location.pathname) || formItem('Attribute Type'), 10000, 'attribute form');
      const name = `AT Region ${R.tag}`;
      await fill('Name', name, 'name');
      await fill('Description', 'Created by Revinci automation', 'description');
      await select('Attribute Type', 'PickList');
      await sleep(500);
      (await select('Attribute Value Type', 'String', { optional: true })) || (await selectFirst('Attribute Value Type'));
      await tags('Attribute Values (type and enter)', ['North', 'South', 'East']);
      await select('Default Value', 'North', { optional: true });
      await button('Save'); await toast();
      R.data.attribute = name; return name;
    },
    async attributeGroup() {
      await go('/dashboard/setup/attributeGroup');
      await button('Attribute Group');
      const name = `AT-AG ${R.tag}`;
      await fill('Name', name, 'name');
      await button('Add Attribute');
      await sleep(600);
      const sel = await waitFor(() => $v('.ant-modal .ant-select, .ant-table .ant-select, .ant-select').pop(), 8000, 'attribute picker');
      fire(sel.querySelector('.ant-select-selector'), 'mousedown'); await sleep(400);
      const s = sel.querySelector('input.ant-select-selection-search-input');
      if (s && R.data.attribute) { setValue(s, R.data.attribute); await sleep(800); }
      const opt = await waitFor(() => dropdown() && $$('.ant-select-item-option', dropdown())[0], 6000, 'attribute option');
      clickEl(opt); await sleep(300);
      await buttonAny(['Add', 'OK', 'Confirm'], 1500);
      await button('Save'); await toast();
      R.data.attributeGroup = name; return name;
    },
    priceProfile: () => profile('priceProfile', 'Price Profile'),
    costProfile: () => profile('costProfile', 'Cost Profile'),
    async account() {
      await go('/dashboard/crm/account');
      await button('Account');
      await waitFor(() => $v('#accountNumber')[0], 15000, 'account form');
      const name = `AT Customer ${R.tag}`;
      await fill('Name', name, 'name');
      await fill('Account Number', `ACC-${R.tag}`, 'accountNumber');
      await fill('Annual Revenue', '1200000');
      await fill('Employees Count', '120');
      await fill('Business Activities', 'Automation test customer', 'businessActivities');
      (await select('Type', 'Customer', { optional: true })) || (await selectFirst('Type').catch(() => ''));
      await selectFirst('Industry').catch(() => '');
      await fill('Jurisdiction', 'INDIA', 'jurisdiction');
      await fill('Account Website', 'automation.example', 'accountWebsite');
      await button('Save'); await toast();
      R.data.account = name; return name;
    },
  };
  async function profile(route, label) {
    await go(`/dashboard/setup/${route}`);
    await button(label);
    const name = `AT ${label} ${R.tag}`;
    await fill('Name', name, 'name');
    const scope = (await select('Scope', 'Organization', { optional: true })) || (await selectFirst('Scope'));
    await button('Create'); await toast().catch(() => '');
    await idle(1200);
    const pub = await buttonAny(['Publish'], 4000);
    if (pub) await buttonAny(['Yes', 'Confirm', 'OK', 'Publish'], 3000);
    R.data[route] = name;
    return `${name} (${scope})${pub ? ' · published' : ' · draft'}`;
  }

  // API key: one active key allowed; secret shown only once.
  const KEYS = {
    async ensure() {
      const res = await api('GET', '/usage-ingestion/api/v1/usage/api-keys');
      if (res.status !== 200) throw new Error('List API keys → HTTP ' + res.status);
      const active = items(res.body).filter(k => k.isActive && !k.revokedAt);
      UI.keyList(items(res.body));
      const stored = LS.get('apiKey.' + HOST, null);
      const verify = async k => (await api('GET', '/crm/api/v1/accounts?page=0&size=1', null, { auth: 'key', key: k })).status === 200;
      if (stored && active.some(a => stored.key.startsWith(a.keyPrefix)) && await verify(stored.key)) { R.apiKey = stored.key; UI.key(stored); return `reusing stored key ${stored.name}`; }
      const pasted = UI.val('apiKey').trim();
      if (pasted) {
        if (!(await verify(pasted))) throw new Error('Pasted API key was rejected by the API');
        const a = active.find(x => pasted.startsWith(x.keyPrefix));
        const rec = { key: pasted, name: a?.name || 'pasted', source: 'pasted', savedAt: Date.now() };
        LS.set('apiKey.' + HOST, rec); R.apiKey = pasted; UI.key(rec);
        return 'pasted key verified and saved';
      }
      if (active.length && !UI.checked('rotateKey')) throw new Error(`Active key "${active[0].name}" exists but its secret isn't stored in this browser. Paste it in the panel, or tick "Revoke & recreate".`);
      await go('/dashboard/settings/apiKeys');
      if (active.length) {
        const row = $v('tr, [role=row], .ant-card, li').find(r => r.innerText.includes(active[0].name));
        const rv = row && [...row.querySelectorAll('button, [role=button]')].find(b => /revoke/i.test(b.innerText));
        if (!rv) throw new Error('Could not find the Revoke action for ' + active[0].name);
        clickEl(rv); await sleep(600);
        const reason = $v('.ant-modal textarea, .ant-modal input[type=text]')[0];
        if (reason) setValue(reason, 'Rotated by Revinci Test Automation');
        await buttonAny(['Revoke', 'Yes', 'Confirm', 'OK'], 5000); await idle(1500);
        UI.log(`Revoked ${active[0].name}`, 'warn');
      }
      await button('Create API Key');
      const dlg = await waitFor(() => $v('.ant-modal, .ant-drawer, [role=dialog]').pop(), 10000, 'create key dialog');
      const name = `revinci-automation-${R.tag}`;
      const nameIn = dlg.querySelector('#name, input[placeholder*="ame"], input[type=text]');
      if (nameIn) setValue(nameIn, name);
      const desc = dlg.querySelector('#description, textarea');
      if (desc) setValue(desc, 'Created by Revinci Test Automation');
      const pick = dlg.querySelector('.ant-picker input');
      if (pick) { const d = new Date(); d.setMonth(d.getMonth() + 6); setValue(pick, fmt(d)); key(pick, 'Enter'); }
      await buttonAny(['Generate', 'Create', 'Create API Key', 'Save'], 5000);
      const secret = await waitFor(() => (D().body.innerText.match(/rvc_[A-Za-z0-9_\-]{16,}/) || [])[0] || $v('input, textarea').map(e => e.value).find(v => /^rvc_/.test(v)), 12000, 'new key secret');
      await buttonAny(['Done', 'Close', 'OK'], 2000);
      const rec = { key: secret, name, source: 'created', savedAt: Date.now() };
      LS.set('apiKey.' + HOST, rec); R.apiKey = secret; UI.key(rec);
      return `created ${name}${(await verify(secret)) ? ' · verified' : ' · not accepted by accounts API'}`;
    },
  };

  const PRODUCTS = [
    { id: 'feature', label: 'Feature', type: 'FEATURE', price: 'One Time', amount: 0 },
    { id: 'option', label: 'Option (bundle choice)', type: 'OPTION', price: 'One Time', amount: 199 },
    { id: 'agentFeature', label: 'Agent Feature (agent action)', type: 'AGENT_ACTION', price: 'Consumption', amount: 8 },
    { id: 'featureOffering', label: 'Feature Offering', type: 'FEATURE_OFFERING', price: 'Subscription', amount: 249 },
    { id: 'standalone', label: 'Product (standalone)', type: 'STANDALONE', price: 'Subscription', amount: 25 },
    { id: 'optionGroup', label: 'Option group', special: 'optionGroup' },
    { id: 'bundle', label: 'Bundle', type: 'BUNDLE', price: 'Subscription', amount: 49 },
    { id: 'productWithFeatures', label: 'Product with Features', type: 'FEATURE_X', query: '&hasFeatures=true', price: 'Subscription', amount: 0 },
    { id: 'productWithOfferings', label: 'Product with Feature Offerings', type: 'FEATURE_X', price: 'Subscription', amount: 0 },
    { id: 'agentSimple', label: 'Agent — simple', special: 'agent', mode: 'simple', price: 'Subscription', amount: 149 },
    { id: 'agentWorkflow', label: 'Agent — workflow', special: 'agent', mode: 'workflow', price: 'Subscription', amount: 0 },
  ];

  async function price(method, amount) {
    const wp = $v('*').filter(e => !e.children.length).find(e => /^\s*with pricing\s*$/i.test(e.textContent));
    if (!wp) return 'no pricing step on this screen';
    clickEl(wp); await sleep(500);
    await clickText(new RegExp(`^\\s*${esc(method)}\\s*$`, 'i'));
    await sleep(700);
    const nm = formItem('Name')?.querySelector('input');
    if (nm && !nm.value) setValue(nm, `${method} ${R.tag}`);
    await select('Transaction Unit', 'Currency', { optional: true }).catch(() => {});
    await checkbox('I Want to Set Price', true).catch(() => {});
    await select('Selling Model', method === 'One Time' ? 'One Time' : 'Recurring', { optional: true }).catch(() => {});
    await select('Selling Frequency', 'Monthly', { optional: true }).catch(() => {});
    (await select('Price UOM', R.data.uom || 'Each', { optional: true }).catch(() => null)) || (await selectFirst('Price UOM').catch(() => {}));
    await fill('Start Price', String(amount)).catch(() => {});
    await clickText(/^\s*flat\s*$/i).catch(() => {});
    if (method === 'Consumption') { await fill('Outcome ID', 'task_completed').catch(() => {}); await fill('Price', String(amount)).catch(() => {}); }
    const saved = await buttonAny(['Save Price Methods', 'Save Price Method', 'Save', 'Add'], 5000);
    await toast(8000).catch(() => '');
    return `${method} $${amount}${saved ? '' : ' (no save button found)'}`;
  }

  async function finishWizard(onStep) {
    const trail = [];
    for (let i = 0; i < 12; i++) {
      if (onStep) { const r = await onStep().catch(e => `step: ${e.message}`); if (r) trail.push(r); }
      const c = await buttonAny(['Publish', 'Skip', 'Save & Next', 'Save and Next', 'Next', 'Continue', 'Review & Publish', 'Save details'], 3000);
      if (!c) break;
      trail.push(c); await idle(1000);
      if (c === 'Publish') { await buttonAny(['Yes', 'Confirm', 'Publish', 'OK'], 2500); trail.push('published'); break; }
    }
    return { trail, published: /published/i.test(D().body.innerText) };
  }

  async function linkFromCatalog(names) {
    if (!names.length) return null;
    if (!(await buttonAny(['Reuse from the Catalog', 'Reuse from Catalog', 'Add Feature Offering', 'Add from Catalog'], 1500))) return null;
    for (const n of names) {
      const s = $v('.ant-modal input[placeholder*="earch"], .ant-drawer input[placeholder*="earch"]')[0];
      if (s) { setValue(s, n); await sleep(900); }
      const hit = $v('.ant-modal *, .ant-drawer *').filter(e => !e.children.length).find(e => e.textContent.includes(n));
      if (hit) clickEl(hit);
      const cb = $v('.ant-modal .ant-checkbox-input, .ant-drawer .ant-checkbox-input')[0];
      if (cb && !cb.checked) clickEl(cb);
    }
    await buttonAny(['Add', 'Link', 'Save', 'Confirm', 'OK'], 3000);
    return `linked ${names.join(', ')}`;
  }

  async function createProduct(o) {
    await go(`/dashboard/setup/product/new?type=${o.type}${o.query || ''}`);
    const name = `AT ${o.label.replace(/\s*\(.*\)/, '')} ${R.tag}`;
    const code = `AT-${o.id.replace(/[a-z]/g, '') || o.id.slice(0, 3).toUpperCase()}${o.id.length}-${R.tag}`.toUpperCase();
    await fill('Name', name, 'name');
    await select('Product Code', code, { create: true });
    await fill('Description', `Created by Revinci automation (${o.label})`, 'description');
    const withAttr = o.id === 'standalone' && !!R.data.attributeGroup;
    const sw = $v('.ant-switch')[0];
    if (sw && sw.classList.contains('ant-switch-checked') !== withAttr) clickEl(sw);
    await select('#tag', 'automation', { create: true, multi: true }).catch(() => {});
    if (o.type === 'AGENT_ACTION' && R.data.costProfile) await select('Cost Profile', R.data.costProfile, { optional: true }).catch(() => {});
    await button('Create Product'); await toast().catch(() => ''); await idle(1500);
    (R.data.products = R.data.products || {})[o.id] = { name, code };
    UI.log(`  created ${name} [${code}]`);
    let attrs = '';
    if (withAttr) {
      try {
        const s = $v('input[placeholder*="earch"]')[0]; if (s) { setValue(s, R.data.attributeGroup); await sleep(800); }
        await clickText(new RegExp(esc(R.data.attributeGroup)));
        await buttonAny(['»', '>>', 'Add'], 3000); await buttonAny(['Save'], 3000);
        attrs = ' · attributes attached';
      } catch (e) { attrs = ` · attributes: ${e.message}`; }
    }
    const priced = await price(o.price, o.amount).catch(e => `pricing failed: ${e.message}`);
    const P = R.data.products;
    const linkNames = o.id === 'productWithFeatures' ? [P.feature?.name] : o.id === 'productWithOfferings' ? [P.featureOffering?.name] : o.id === 'featureOffering' ? [P.feature?.name] : [];
    const names = linkNames.filter(Boolean);
    let linked = false;
    const w = await finishWizard(async () => {
      if (!linked && names.length) { const r = await linkFromCatalog(names); if (r) { linked = true; return r; } }
      if (!linked && o.id === 'bundle' && R.data.optionGroup && findButton('Add Option Group')) {
        await button('Add Option Group'); await clickText(new RegExp(esc(R.data.optionGroup))); await buttonAny(['Add', 'Save', 'OK'], 2500);
        linked = true; return `option group ${R.data.optionGroup}`;
      }
      return null;
    });
    P[o.id].published = w.published;
    return `${name}${attrs} · ${priced} · ${w.trail.join(' → ') || 'no further steps'}${w.published ? ' · PUBLISHED' : ''}`;
  }

  async function optionGroup() {
    await go('/dashboard/setup/optionGroup');
    await buttonAny(['Option Group', 'Create', 'Create Option Group'], 8000);
    const name = `AT Options ${R.tag}`;
    await fill('Name', name, 'name');
    (await select('Selection Type', 'Single select', { optional: true })) || (await selectFirst('Selection Type').catch(() => ''));
    const opt = R.data.products?.option?.name;
    if (opt && await buttonAny(['Add Option'], 3000)) {
      const s = $v('.ant-modal input, input.ant-select-selection-search-input').pop();
      if (s) { setValue(s, opt); await sleep(900); }
      await clickText(new RegExp(esc(opt))).catch(() => {});
      await buttonAny(['Add', 'OK', 'Confirm'], 2000);
      const star = $v('.anticon-star, [aria-label*="star"]')[0]; if (star) clickEl(star);
    }
    await button('Save'); await toast().catch(() => '');
    R.data.optionGroup = name;
    return `${name}${opt ? ' with ' + opt : ' (create the Option product first to add choices)'}`;
  }

  async function agent(o) {
    await go(`/dashboard/agents/new?mode=${o.mode}`);
    if (!formItem('Agent Name')) await button(o.mode === 'simple' ? 'Build a simple agent' : 'Build a workflow agent');
    const name = `AT ${o.mode === 'simple' ? 'Simple' : 'Workflow'} Agent ${R.tag}`;
    const code = `AGT-${o.mode === 'simple' ? 'S' : 'W'}-${R.tag}`;
    await fill('Agent Name', name, 'name');
    await fill('Agent Code', code, 'productCode');
    if (R.data.costProfile && await buttonAny(['More fields (optional)'], 1500)) await select('Cost Profile', R.data.costProfile, { optional: true }).catch(() => {});
    await buttonAny(['Save details', 'Save', 'Next'], 5000); await toast(8000).catch(() => '');
    (R.data.products = R.data.products || {})[o.id] = { name, code };
    let priced = '';
    const w = await finishWizard(async () => {
      if (!priced && $v('*').some(e => !e.children.length && /^\s*with pricing\s*$/i.test(e.textContent))) { priced = await price(o.price, o.amount); return priced; }
      return null;
    });
    R.data.products[o.id].published = w.published;
    return `${name} [${code}] · ${priced || 'no pricing'} · ${w.trail.join(' → ')}${w.published ? ' · PUBLISHED' : ''}`;
  }

  // Quote → order → entitlement
  const productToSell = () => UI.val('product').trim() || R.data.products?.standalone?.code || R.data.products?.agentSimple?.code || R.data.products?.bundle?.code;
  async function pickAccount(label, id) {
    const want = R.data.account || UI.val('account').trim();
    if (want) { const ok = await select(label, want, { id, optional: true }); if (ok) return ok; }
    return selectFirst(label, { id });
  }
  async function addToBag(q) {
    if (!q) throw new Error('No product to add — run Product setup first or set "Product to sell"');
    await buttonAny(['Add Product', 'Add Products', 'Add'], 3000);
    const s = await waitFor(() => $v('input[placeholder*="earch"]').pop(), 15000, 'product search');
    setValue(s, q); key(s, 'Enter'); await sleep(1500);
    await clickText(new RegExp(esc(q)));
    const cb = $v('.ant-checkbox-input').pop(); if (cb && !cb.checked) clickEl(cb);
    await sleep(500);
    const model = $v('.ant-modal .ant-select, .ant-drawer .ant-select')[0];
    if (model) { fire(model.querySelector('.ant-select-selector'), 'mousedown'); await sleep(400); const o = dropdown() && $$('.ant-select-item-option', dropdown())[0]; if (o) clickEl(o); }
    const added = await buttonAny(['Add to Bag', 'Add To Bag', 'Add to bag', 'Add Selected', 'Add'], 6000);
    if (!added) throw new Error('No "Add to Bag" button after selecting the product');
    await toast(8000).catch(() => ''); await idle(1500);
    return q;
  }
  const Q2C = {
    async quote() {
      await go('/dashboard/cpq/quote');
      await button('Quote');
      await waitFor(() => $v('#accountId')[0] || formItem('Account Id'), 15000, 'quote form');
      const name = `AT Quote ${R.tag}`;
      await fill('Name', name, 'name');
      const acct = await pickAccount('Account Id', 'accountId');
      (await select('Currency Id', 'USD', { id: 'currencyId', optional: true })) || (await selectFirst('Currency Id', { id: 'currencyId' }));
      await select('Billing Frequency', 'Monthly', { id: 'billingFrequency', optional: true });
      (await select('Payment Term', '30', { id: 'paymentTerm', optional: true })) || (await selectFirst('Payment Term', { id: 'paymentTerm' }).catch(() => ''));
      const end = new Date(); end.setFullYear(end.getFullYear() + 1); end.setDate(end.getDate() - 1);
      await date('startDate', new Date()); await date('endDate', end);
      await button('Save & Go to Bag'); await toast().catch(() => ''); await idle(2500);
      R.data.quote = { name, account: acct };
      const item = await addToBag(productToSell());
      const trail = [];
      for (const b of ['Finalize', 'Submit for Approval', 'Generate Document', 'Accept', 'Convert to Order']) {
        if (await buttonAny([b], 4000)) { await buttonAny(['Yes', 'Confirm', 'OK', 'Submit'], 2500); await toast(8000).catch(e => trail.push(`${b} ✗ ${e.message}`)); trail.push(b); await idle(1500); }
      }
      return `${name} · ${acct} · ${item} · ${trail.join(' → ') || 'no lifecycle buttons shown'}`;
    },
    async order() {
      await go('/dashboard/orders/new');
      const name = `AT Order ${R.tag}`, number = `ORD-${R.tag}`;
      const acct = await pickAccount('Account');
      await fill('Name', name, 'name');
      await fill('Number', number, 'quoteNumber');
      await fill('Description', 'Created by Revinci Test Automation', 'description');
      await date('startDate', new Date());
      const ppd = new Date(); ppd.setMonth(ppd.getMonth() + 6);
      await date('priceProtectionDate', ppd).catch(() => {});
      (await select('Billing Frequency', 'Monthly', { optional: true })) || (await selectFirst('Billing Frequency'));
      const seg = $v('.ant-segmented-item').find(s => /30 Days/.test(s.innerText)); if (seg) clickEl(seg);
      (await select('Currency', 'USD', { optional: true })) || (await selectFirst('Currency'));
      (await select('Rate Type', 'Budgeted', { optional: true })) || (await selectFirst('Rate Type'));
      await button('Continue'); await toast().catch(() => ''); await idle(2500);
      R.data.order = { name, number, account: acct };
      const item = await addToBag(productToSell());
      if (!(await buttonAny(['Finalize', 'Finalize Order'], 8000))) throw new Error('Finalize button not found on the order bag');
      await buttonAny(['Yes', 'Confirm', 'OK', 'Finalize'], 3000); await toast().catch(() => '');
      return `${name} (${number}) · ${acct} · ${item} · finalized`;
    },
    async entitlement() {
      const target = R.data.order?.name || R.data.quote?.name;
      let ent = null;
      for (let i = 0; i < 10 && !ent; i++) {
        const res = await api('GET', '/revenue-management/api/v1/revenue-entitlements?page=0&size=50&sort=createdDate,desc');
        const list = items(res.body);
        ent = list.find(e => target && JSON.stringify(e).includes(target)) || (target ? null : list[0]);
        if (!ent) await sleep(3000);
      }
      if (!ent) throw new Error(`No entitlement found for ${target || 'the order'} — finalize the order first`);
      R.data.entitlement = { id: ent.id, name: ent.name };
      await go(`/dashboard/revenueEntitlement/${ent.id}`);
      if (!findButton('Activate')) { await go('/dashboard/revenueEntitlement'); await clickText(new RegExp(esc(ent.name))); await idle(2000); }
      let activated = false;
      if (await buttonAny(['Activate'], 6000)) {
        const pk = $v('.ant-modal .ant-picker input')[0];
        if (pk) { setValue(pk, fmt(new Date())); key(pk, 'Enter'); }
        await buttonAny(['Confirm', 'Activate', 'Yes', 'OK'], 4000); await toast().catch(() => '');
        activated = true;
      }
      const ext = `WT-${R.tag}`; let mapped = false;
      const kebab = $v('button').find(b => b.querySelector('.anticon-more, .anticon-ellipsis') || /more/i.test(b.getAttribute('aria-label') || ''));
      if (kebab) {
        clickEl(kebab); await sleep(500);
        const m = $v('*').filter(e => !e.children.length).find(e => /map external id/i.test(e.textContent));
        if (m) {
          clickEl(m); await sleep(600);
          const inp = $v('.ant-modal input[type=text], .ant-modal input:not([type])')[0];
          if (inp) { setValue(inp, ext); await buttonAny(['Save', 'Map', 'Confirm', 'OK'], 3000); await toast().catch(() => ''); mapped = true; }
        }
      }
      R.data.entitlement.externalPlanId = mapped ? ext : null;
      const after = await api('GET', `/revenue-management/api/v1/revenue-entitlements/${ent.id}`);
      const plans = items((await api('GET', `/revenue-management/api/v1/plans/entitlement/${ent.id}`)).body);
      Object.assign(R.data.entitlement, { status: after.body?.status, planId: plans[0]?.id, planNumber: plans[0]?.planNumber || plans[0]?.number });
      return `${ent.name} · ${activated ? 'activated' : 'Activate button not shown'} · status ${after.body?.status || '?'} · ${mapped ? 'external ID ' + ext : 'external ID not mapped'} · ${plans.length} plan(s)`;
    },
    async usage() {
      const plan = R.data.entitlement?.externalPlanId || R.data.entitlement?.planNumber || UI.val('planNumber').trim();
      if (!plan) throw new Error('No plan number — run the entitlement step or set "Plan number"');
      const res = await api('POST', '/usage-ingestion/api/v1/usage/ingest', usageEvent(plan), { auth: R.apiKey ? 'key' : 'session' });
      if (res.status >= 300) throw new Error(`Ingest → HTTP ${res.status}: ${String(res.text).slice(0, 160)}`);
      return `HTTP ${res.status} · ${res.body?.status || ''}`;
    },
  };
  function usageEvent(plan, i = 0) {
    return { provider: 'openai', planNumber: plan || 'NO-PLAN', customerId: 'automation@revinci.ai', externalAccountId: `ACC-${R.tag}`,
      apiResponse: { id: `chatcmpl_${R.tag}_${Date.now()}_${i}`, model: 'gpt-4o', usage: { input_tokens: 1000 + i, output_tokens: 500, cache_read_input_tokens: 0 } },
      metadata: { session_id: `sess-${R.tag}`, agent_name: 'revinci-automation', outcome_id: 'task_completed', source_platform: 'revinci_automation' }, eventTimestamp: Date.now() };
  }

  // API tests (docs.revinci.ai endpoint reference)
  const mode = () => (R.apiKey ? 'key' : 'session');
  const call = (m, p, b, o = {}) => api(m, p, b, { auth: mode(), ...o });
  const expect = (res, codes, what) => { if (![].concat(codes).includes(res.status)) throw new Error(`${what}: expected ${[].concat(codes).join('/')} got ${res.status} ${String(res.text || '').slice(0, 140)}`); return res; };
  const APITESTS = {
    async auth() {
      await step('API · smoke: list accounts (200)', async () => { const x = expect(await call('GET', '/crm/api/v1/accounts?page=0&size=5'), 200, 'list'); return `${items(x.body).length} rows · auth=${mode()}`; });
      await step('API · missing Authorization → 401/403', async () => { const r = await fetch(apiBase() + '/crm/api/v1/accounts?page=0&size=1', { headers: { 'Tenant-Id': TENANT() } }).catch(() => ({ status: 0 })); if (![401, 403].includes(r.status)) throw new Error('expected 401/403 got ' + r.status); return 'HTTP ' + r.status; });
      await step('API · invalid key → 401/403', async () => { const x = await api('GET', '/crm/api/v1/accounts?page=0&size=1', null, { auth: 'key', key: 'rvc_invalid_automation_key' }); expect(x, [401, 403], 'invalid key'); return 'HTTP ' + x.status; });
    },
    async accounts() {
      let id;
      await step('API · GET /crm/api/v1/accounts', async () => { const x = expect(await call('GET', '/crm/api/v1/accounts?page=0&size=20'), 200, 'list'); const l = items(x.body); id = l[0]?.id; return `${l.length} accounts`; });
      await step('API · POST /crm/api/v1/accounts', async () => {
        const x = expect(await call('POST', '/crm/api/v1/accounts', { name: `AT API Account ${R.tag}`, accountNumber: `API-${R.tag}`, annualRevenue: 1200, employeesCount: 120, businessActivities: 'API automation', type: 'customer', jurisdiction: 'INDIA', industry: 'banking', accountSource: 'CRM', accountWebsite: 'automation.example', tags: [] }), [200, 201], 'create');
        id = x.body?.id || id; R.data.apiAccountId = x.body?.id; return 'id ' + x.body?.id;
      });
      await step('API · GET /crm/api/v1/accounts/{id}', async () => { if (!id) throw new Error('no account id'); return expect(await call('GET', `/crm/api/v1/accounts/${id}`), 200, 'get').body?.name; });
      await step('API · POST account without name → 4xx', async () => { const x = await call('POST', '/crm/api/v1/accounts', { accountNumber: `BAD-${R.tag}` }); if (x.status < 400) throw new Error(`accepted invalid payload (${x.status})`); return 'HTTP ' + x.status; });
    },
    async entitlements() {
      let ent = R.data.entitlement?.id, plan = R.data.entitlement?.planId, pn = R.data.entitlement?.planNumber, rm;
      await step('API · GET revenue-entitlements', async () => { const l = items(expect(await call('GET', '/revenue-management/api/v1/revenue-entitlements'), 200, 'list').body); ent = ent || l.find(e => /activ/i.test(e.status))?.id || l[0]?.id; return `${l.length} entitlements`; });
      await step('API · GET revenue-entitlements/{id}', async () => { if (!ent) throw new Error('no entitlement'); const x = expect(await call('GET', `/revenue-management/api/v1/revenue-entitlements/${ent}`), 200, 'get'); return `${x.body?.name} · ${x.body?.status}`; });
      await step('API · GET plans/entitlement/{id}', async () => { const l = items(expect(await call('GET', `/revenue-management/api/v1/plans/entitlement/${ent}`), 200, 'plans').body); plan = plan || l[0]?.id; pn = pn || l[0]?.planNumber; return `${l.length} plans`; });
      await step('API · GET plans/{planId}', async () => { if (!plan) throw new Error('no plan'); const x = expect(await call('GET', `/revenue-management/api/v1/plans/${plan}`), 200, 'plan'); pn = pn || x.body?.planNumber; return x.body?.planNumber || 'ok'; });
      await step('API · GET plan-order-transactions', async () => `${items(expect(await call('GET', `/revenue-management/api/v1/plan-order-transactions/revenue-entitlement/${ent}`), 200, 'txns').body).length} transactions`);
      await step('API · GET plan-rate-matrices', async () => { const x = expect(await call('GET', `/revenue-management/api/v1/plan-rate-matrices/plan?planId=${plan}`), 200, 'rate matrix'); const l = items(x.body); rm = l[0]?.id || x.body?.id; return `${l.length || (x.body ? 1 : 0)} matrices`; });
      await step('API · GET plan-rate-matrix-entries', async () => { if (!rm) return 'no rate matrix on this plan — skipped'; return `${items(expect(await call('GET', `/revenue-management/api/v1/plan-rate-matrix-entries/rate-matrix?rateMatrixId=${rm}`), 200, 'entries').body).length} entries`; });
      await step('API · GET usage-summaries', async () => `${items(expect(await call('GET', `/revenue-management/api/v1/usage-summaries?scopeNumber=${encodeURIComponent(pn || '')}`), 200, 'summaries').body).length} summaries`);
      await step('API · GET entitlement with bad id → 4xx', async () => { const x = await call('GET', '/revenue-management/api/v1/revenue-entitlements/00000000-0000-0000-0000-000000000000'); if (x.status < 400) throw new Error('returned ' + x.status); return 'HTTP ' + x.status; });
      R.data.api = { entitlementId: ent, planId: plan, planNumber: pn };
    },
    async wallets() {
      const acct = R.data.apiAccountId || items((await call('GET', '/crm/api/v1/accounts?page=0&size=1')).body)[0]?.id;
      let wallet, carry;
      await step('API · POST /crm/api/v1/wallets', async () => { const x = expect(await call('POST', '/crm/api/v1/wallets', { name: `AT Wallet ${R.tag}`, accountId: acct, transactionUnit: 'CREDIT', balance: 3000, status: 'Draft', carryOver: true, topupAllowed: true, allowNegativeBalance: false, expirationLogic: 365 }), [200, 201], 'create wallet'); wallet = x.body?.id; R.data.walletId = wallet; return 'wallet ' + wallet; });
      await step('API · GET wallets/account/{accountId}', async () => { expect(await call('GET', `/crm/api/v1/wallets/account/${acct}`), 200, 'by account'); return 'ok'; });
      await step('API · POST carry-over-rules', async () => { const x = expect(await call('POST', '/crm/api/v1/wallets/carry-over-rules', { walletId: wallet, carryOverFrequency: 'wallet_end_date', carryOverPercentage: 20, carryOverMaxAmount: '', isActive: true }), [200, 201], 'carryover'); carry = x.body?.id; return 'rule ' + carry; });
      await step('API · GET carry-over-rules/wallet/{id}', async () => { expect(await call('GET', `/crm/api/v1/wallets/carry-over-rules/wallet/${wallet}`), 200, 'get carryover'); return 'ok'; });
      await step('API · PUT carry-over-rules/{id}', async () => { if (!carry) return 'no rule id returned — skipped'; expect(await call('PUT', `/crm/api/v1/wallets/carry-over-rules/${carry}`, { walletId: wallet, carryOverFrequency: 'wallet_end_date', carryOverPercentage: 25, carryOverMaxAmount: 500, isActive: true }), 200, 'update carryover'); return '25% cap 500'; });
      await step('API · POST consumption-rules', async () => { const now = Date.now(); const x = expect(await call('POST', '/crm/api/v1/consumption-rules', { transactionUnit: 'CURRENCY', currencyIsoCode: 'USD', totalCredit: 3000, validFrom: now, validTo: now + 365 * 864e5, type: 'discrete', price: 200, scope: 'wallet', allocation: 0, balance: 0, scopeValue: wallet, condition: 'consumption' }), [200, 201], 'consumption rule'); return 'rule ' + x.body?.id; });
      await step('API · GET consumption-rules/scope', async () => { expect(await call('GET', `/crm/api/v1/consumption-rules/scope?scope=wallet&scopeValue=${wallet}`), 200, 'rules'); return 'ok'; });
      await step('API · GET wallets/activate/{id}', async () => { const x = await call('GET', `/crm/api/v1/wallets/activate/${wallet}`); expect(x, [200, 201, 400, 422], 'activate'); return x.status < 300 ? 'activated' : `rejected without 100% allocation (${x.status})`; });
      await step('API · POST wallets/top-up', async () => { const x = await call('POST', '/crm/api/v1/wallets/top-up', { id: wallet, amount: 100 }); expect(x, [200, 201, 400, 422], 'top-up'); return 'HTTP ' + x.status; });
      await step('API · GET wallet-transactions/wallet/{id}', async () => `${items(expect(await call('GET', `/crm/api/v1/wallet-transactions/wallet/${wallet}`), 200, 'transactions').body).length} transactions`);
      await step('API · DELETE carry-over-rules/{id}', async () => { if (!carry) return 'skipped'; expect(await call('DELETE', `/crm/api/v1/wallets/carry-over-rules/${carry}`), [200, 204], 'delete'); return 'deleted'; });
    },
    async usage() {
      const plan = R.data.entitlement?.externalPlanId || R.data.api?.planNumber || R.data.entitlement?.planNumber || UI.val('planNumber').trim();
      await step('API · POST usage/ingest', async () => `${expect(await call('POST', '/usage-ingestion/api/v1/usage/ingest', usageEvent(plan)), [200, 201, 202], 'ingest').status} · plan ${plan || '(none)'}`);
      await step('API · POST usage/ingest/bulk (5 events)', async () => { const x = expect(await call('POST', '/usage-ingestion/api/v1/usage/ingest/bulk', [0, 1, 2, 3, 4].map(i => usageEvent(plan, i))), [200, 201, 202], 'bulk'); return `${x.body?.successCount ?? '?'} / ${x.body?.totalEvents ?? 5}`; });
      await step('API · ingest with invalid provider → 4xx', async () => { const x = await call('POST', '/usage-ingestion/api/v1/usage/ingest', { ...usageEvent(plan, 9), provider: 'not_a_provider' }); if (x.status < 400) throw new Error(`accepted invalid provider (${x.status})`); return 'HTTP ' + x.status; });
    },
  };

  const SUITES = [
    { id: 'admin', title: 'Admin setup', options: [['currency', 'Currency'], ['exchangeRate', 'Currency exchange rate'], ['uom', 'Unit of measure'], ['attribute', 'Attribute (PickList)'], ['attributeGroup', 'Attribute group'], ['priceProfile', 'Price profile'], ['costProfile', 'Cost profile'], ['account', 'Customer account']], run: async picks => { for (const [id, l] of SUITES[0].options) if (picks.includes(id)) await step('Admin · ' + l, ADMIN[id]); } },
    { id: 'apikey', title: 'API key', options: [['ensure', 'Find or create API key']], run: async () => step('API key · find or create', KEYS.ensure) },
    { id: 'products', title: 'Product setup', options: PRODUCTS.map(p => [p.id, p.label]), run: async picks => { for (const o of PRODUCTS) if (picks.includes(o.id)) await step('Product · ' + o.label, () => o.special === 'optionGroup' ? optionGroup() : o.special === 'agent' ? agent(o) : createProduct(o)); } },
    { id: 'q2c', title: 'Quote · Order · Entitlement', options: [['quote', 'Quote → bag → finalize → lifecycle'], ['order', 'Order → bag → finalize'], ['entitlement', 'Activate entitlement + map external ID'], ['usage', 'Send a usage event to the plan']], run: async picks => { for (const [id, l] of SUITES[3].options) if (picks.includes(id)) await step('Q2C · ' + l, Q2C[id]); } },
    { id: 'api', title: 'API testing', options: [['auth', 'Auth & headers (positive + negative)'], ['accounts', 'Accounts — list, get, create'], ['entitlements', 'Entitlements, plans, rating, usage summaries'], ['wallets', 'Wallets, carryover & consumption rules'], ['usage', 'Usage ingestion — single & bulk']], run: async picks => {
      if (!R.apiKey) { const s = LS.get('apiKey.' + HOST, null); const p = UI.val('apiKey').trim(); R.apiKey = p || s?.key || null; }
      UI.log(`API base ${apiBase()} · tenant ${TENANT()} · auth ${R.apiKey ? 'API key' : 'session token'}`);
      for (const [id] of SUITES[4].options) if (picks.includes(id)) await APITESTS[id]();
    } },
  ];

  async function step(name, fn) {
    if (R.stop) throw new Error('Stopped');
    const s = { name, status: 'running', start: Date.now() };
    R.steps.push(s); UI.step(s);
    try {
      const d = await fn();
      s.status = 'passed'; if (d) s.detail = String(d).slice(0, 400);
      UI.log('✓ ' + name + (s.detail ? ' — ' + s.detail : ''), 'ok');
    } catch (e) {
      if (R.stop) { s.status = 'failed'; s.error = 'Stopped'; s.end = Date.now(); UI.step(s); throw e; }
      s.status = 'failed'; s.error = String(e.message || e).slice(0, 400);
      s.where = frame ? W().location.pathname : '';
      UI.log('✗ ' + name + ': ' + s.error, 'error');
    }
    s.end = Date.now(); UI.step(s);
  }

  async function runAll(picks) {
    R.running = true; R.stop = false; R.steps = []; R.data = {}; R.calls = []; R.apiKey = null;
    R.tag = 'AT' + Date.now().toString(36).toUpperCase().slice(-5);
    R.started = new Date();
    UI.reset(); UI.running(true);
    UI.log(`Run started · tag ${R.tag} · ${HOST} · tenant ${TENANT()}`);
    try {
      if (!TOKEN()) throw new Error('Not logged in — sign in to Revinci in this tab first');
      for (const s of SUITES) {
        if (!picks[s.id]?.length) continue;
        UI.log('── ' + s.title + ' ──', 'head');
        await s.run(picks[s.id]);
      }
    } catch (e) { UI.log('Run ended: ' + e.message, 'error'); }
    R.running = false; UI.running(false);
    const p = R.steps.filter(s => s.status === 'passed').length, f = R.steps.filter(s => s.status === 'failed').length;
    UI.log(`Finished: ${p} passed, ${f} failed`, f ? 'error' : 'ok');
    const hist = LS.get('history', []); hist.unshift({ at: Date.now(), tag: R.tag, passed: p, failed: f }); LS.set('history', hist.slice(0, 20));
    LS.set('lastReport', report()); UI.done(p, f);
  }

  function report() {
    return { tag: R.tag, workspace: HOST, tenant: TENANT(), started: R.started, finished: new Date(), steps: R.steps, data: R.data, apiCalls: R.calls.map(({ sample, ...c }) => c) };
  }
  function reportHtml(r) {
    const rows = r.steps.map((s, i) => `<tr><td>${i + 1}</td><td>${html(s.name)}</td><td class="${s.status}">${s.status}</td><td>${s.end ? ((s.end - s.start) / 1000).toFixed(1) + 's' : ''}</td><td>${html(s.error || s.detail || '')}${s.where ? `<br><small>${html(s.where)}</small>` : ''}</td></tr>`).join('');
    const p = r.steps.filter(s => s.status === 'passed').length, f = r.steps.length - p;
    return `<!doctype html><meta charset="utf-8"><title>Revinci test report ${r.tag}</title><style>body{font-family:Inter,system-ui,sans-serif;margin:24px;color:#1d231d}h1{font-size:20px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e3e8e0;padding:7px 9px;text-align:left;font-size:13px;vertical-align:top}.passed{color:#2d7a12}.failed{color:#c23b3b}pre{background:#f5f7f3;padding:10px;font-size:12px;overflow:auto}</style><h1>Revinci test report · ${html(r.workspace)} · ${html(r.tag)}</h1><p>${new Date(r.started).toLocaleString()} · <b class="passed">${p} passed</b> · <b class="failed">${f} failed</b></p><table><tr><th>#</th><th>Step</th><th>Status</th><th>Time</th><th>Detail</th></tr>${rows}</table><h2>Records created</h2><pre>${html(JSON.stringify(r.data, null, 2))}</pre><h2>API calls</h2><pre>${html(r.apiCalls.map(c => `${c.method} ${c.path} → ${c.status} (${c.ms}ms, ${c.auth})`).join('\n'))}</pre>`;
  }
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

  // ───────────────────────── UI (shadow DOM overlay) ─────────────────────────
  const UI = (() => {
    const host = document.createElement('div');
    host.id = 'rv-auto-root';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
:host{all:initial}*{box-sizing:border-box;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{position:absolute;inset:0;display:grid;grid-template-columns:1fr 440px;background:#f5f7f3;color:#1d231d;font-size:13px}
.view{display:flex;flex-direction:column;min-width:0;border-right:1px solid #e3e8e0}
.bar{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#1d231d;color:#fff}
.logo{width:28px;height:28px;border-radius:8px;background:#a6e46b;display:grid;place-items:center}.logo svg{width:18px}
.bar b{font-size:14px;font-weight:600}.bar small{color:#b9c4b6}
.url{flex:1;font:12px ui-monospace,Menlo,monospace;background:#2c352b;color:#cfe9b8;padding:5px 9px;border-radius:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar button{background:#2c352b;color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:12px}
iframe{flex:1;border:0;width:100%;background:#fff}
.panel{overflow:auto;padding:14px}
h2{font-size:11px;letter-spacing:.7px;text-transform:uppercase;color:#6b7569;margin:16px 0 8px;font-weight:600}
.card{background:#fff;border:1px solid #e3e8e0;border-radius:12px;padding:10px 12px;margin-bottom:10px}
.suite b{display:flex;justify-content:space-between;font-size:13.5px;margin-bottom:4px}
.suite b label{font-weight:400;font-size:12px;color:#6b7569}
label.c{display:flex;gap:7px;align-items:flex-start;margin:4px 0;cursor:pointer}
label.c input{margin-top:2px;accent-color:#5fa52b}
.presets{display:flex;flex-wrap:wrap;gap:6px}
.presets button,.btn{border:1px solid #d9f5bf;background:#f0fbe6;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12px;color:#1d231d}
.run{width:100%;margin-top:6px;background:#1d231d;color:#fff;border:0;border-radius:10px;padding:11px;font-weight:600;font-size:14px;cursor:pointer}
.run:disabled{opacity:.45;cursor:not-allowed}.stop{background:#fff;color:#c23b3b;border:1px solid #f0c9c9}
input[type=text],input[type=password]{width:100%;padding:7px 9px;border:1px solid #e3e8e0;border-radius:8px;font-size:12.5px;background:#fbfcfa}
.hint{font-size:11.5px;color:#6b7569;line-height:1.45;margin-top:4px}
.key{font:12px ui-monospace,Menlo,monospace;background:#1d231d;color:#d9f5bf;border-radius:8px;padding:8px;word-break:break-all}
.key.empty{background:#fdf3df;color:#b7791f;font-family:inherit}
.kpis{display:flex;gap:8px}.kpi{flex:1;background:#fff;border:1px solid #e3e8e0;border-radius:10px;padding:6px 10px}.kpi b{display:block;font-size:20px}
.tabs{display:flex;gap:2px;border-bottom:1px solid #e3e8e0;margin:10px 0 8px}.tabs button{border:0;background:none;padding:6px 10px;cursor:pointer;color:#6b7569;border-bottom:2px solid transparent;font-size:12.5px}.tabs button.on{color:#1d231d;border-color:#1d231d;font-weight:600}
ul{list-style:none;margin:0;padding:0}li{display:grid;grid-template-columns:14px 1fr auto;gap:8px;padding:6px 2px;border-bottom:1px solid #f0f3ee}
.dot{width:12px;height:12px;border-radius:50%;background:#dfe5dc;margin-top:3px}.dot.running{background:#a6e46b}.dot.passed{background:#5fa52b}.dot.failed{background:#c23b3b}
.d{grid-column:2/4;font-size:11.5px;color:#6b7569;word-break:break-word}.d.err{color:#c23b3b}
.log{font:11.5px ui-monospace,Menlo,monospace;background:#121712;color:#cdd8c9;border-radius:8px;padding:8px;height:300px;overflow:auto;white-space:pre-wrap}
.log .ok{color:#a6e46b}.log .error{color:#ff8a8a}.log .warn{color:#f5c26b}.log .head{color:#fff;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:11.5px}td{padding:4px;border-bottom:1px solid #f0f3ee;font-family:ui-monospace,Menlo,monospace}.s2{color:#2d7a12}.s4,.s5,.s0{color:#c23b3b}
details summary{cursor:pointer;margin:6px 0;color:#3b443a}
.mini{position:fixed;right:16px;bottom:16px;background:#1d231d;color:#fff;border-radius:99px;padding:8px 14px;display:none;align-items:center;gap:8px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25)}
@media(max-width:900px){.wrap{grid-template-columns:1fr}.view{height:45vh}}
</style>
<div class="wrap" id="wrap">
  <div class="view">
    <div class="bar"><div class="logo">${LOGO}</div><b>Revinci</b><small>Test Automation</small><div class="url" id="url">${html(HOST)}</div><button id="min">Minimise</button><button id="close">Close</button></div>
    <iframe id="frame" title="Revinci automation view"></iframe>
  </div>
  <div class="panel">
    <div class="kpis"><div class="kpi">Passed<b id="kp" style="color:#2d7a12">0</b></div><div class="kpi">Failed<b id="kf" style="color:#c23b3b">0</b></div><div class="kpi">Steps<b id="kt">0</b></div></div>
    <h2>What do you want to test?</h2>
    <div class="presets"><button data-p="admin">Admin setup</button><button data-p="products">Product setup</button><button data-p="q2c">Quote → Order → Entitlement</button><button data-p="api">API testing</button><button data-p="full">Full end-to-end</button><button data-p="none">Clear</button></div>
    <div id="suites" style="margin-top:8px"></div>
    <button class="run" id="run">▶ Run tests</button>
    <button class="run stop" id="stop" style="display:none">■ Stop</button>
    <div class="tabs"><button class="on" data-t="steps">Steps</button><button data-t="log">Log</button><button data-t="apis">API calls</button></div>
    <div data-pane="steps"><ul id="steps"><li><span></span><span class="hint">Pick options and click Run. Records get a unique tag so runs never collide.</span></li></ul></div>
    <div data-pane="log" hidden><div class="log" id="log"></div></div>
    <div data-pane="apis" hidden><table id="apis"></table></div>
    <div style="display:flex;gap:6px;margin-top:8px"><button class="btn" id="dlHtml">Download report</button><button class="btn" id="dlJson">JSON</button></div>
    <h2>API key</h2>
    <div class="card">
      <div id="keyBox" class="key empty">No key stored in this browser for ${html(HOST)}.</div>
      <div style="display:flex;gap:6px;margin-top:6px"><button class="btn" id="reveal">Reveal</button><button class="btn" id="copy">Copy</button></div>
      <div class="hint" id="keyList"></div>
      <div class="hint" style="margin-top:8px">Paste existing key (optional)</div><input type="password" id="apiKey" placeholder="rvc_…">
      <label class="c"><input type="checkbox" id="rotateKey"> Revoke the active key &amp; create a new one</label>
      <div class="hint">Revinci allows one active key and shows its secret once. The key is saved only in this browser.</div>
    </div>
    <details><summary>Advanced</summary><div class="card">
      <div class="hint">API base URL</div><input type="text" id="apiBase" placeholder="${html(apiBase())}">
      <div class="hint">Product to sell (code/name)</div><input type="text" id="product" placeholder="defaults to product created in this run">
      <div class="hint">Account for quote/order</div><input type="text" id="account" placeholder="defaults to account created in this run">
      <div class="hint">Plan number for usage</div><input type="text" id="planNumber" placeholder="defaults to activated entitlement">
    </div></details>
    <h2>Recent runs</h2><div class="card hint" id="hist">No runs yet.</div>
  </div>
</div>
<div class="mini" id="mini"><div class="logo">${LOGO}</div><span id="miniTxt">Revinci Test Automation</span></div>`;
    document.documentElement.appendChild(host);
    const $ = id => root.getElementById(id);
    frame = $('frame');
    frame.src = ORIGIN + '/dashboard';

    const presets = { admin: ['admin', 'apikey'], products: ['products'], q2c: ['q2c'], api: ['apikey', 'api'], full: ['admin', 'apikey', 'products', 'q2c', 'api'], none: [] };
    $('suites').innerHTML = SUITES.map(s => `<div class="card suite"><b>${s.title}<label><input type="checkbox" data-all="${s.id}"> all</label></b>${s.options.map(([id, l]) => `<label class="c"><input type="checkbox" data-s="${s.id}" value="${id}"> ${l}</label>`).join('')}</div>`).join('');
    const sel = () => Object.fromEntries(SUITES.map(s => [s.id, [...root.querySelectorAll(`[data-s="${s.id}"]:checked`)].map(c => c.value)]));
    const sync = () => { SUITES.forEach(s => { const all = root.querySelectorAll(`[data-s="${s.id}"]`), on = root.querySelectorAll(`[data-s="${s.id}"]:checked`); root.querySelector(`[data-all="${s.id}"]`).checked = all.length === on.length; }); LS.set('sel', sel()); };
    const apply = ids => { SUITES.forEach(s => root.querySelectorAll(`[data-s="${s.id}"]`).forEach(c => c.checked = ids === true || ids.includes(s.id))); sync(); };
    const saved = LS.get('sel', null);
    if (saved) SUITES.forEach(s => root.querySelectorAll(`[data-s="${s.id}"]`).forEach(c => c.checked = (saved[s.id] || []).includes(c.value))); else apply(presets.full);
    sync();
    $('suites').addEventListener('change', e => { const a = e.target.dataset.all; if (a) root.querySelectorAll(`[data-s="${a}"]`).forEach(c => c.checked = e.target.checked); sync(); });
    root.querySelectorAll('[data-p]').forEach(b => b.onclick = () => apply(presets[b.dataset.p]));
    root.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { root.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === b)); root.querySelectorAll('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== b.dataset.t); });
    ['apiBase', 'product', 'account', 'planNumber'].forEach(id => { $(id).value = LS.get('f.' + id, ''); $(id).onchange = () => LS.set(id === 'apiBase' ? 'apiBase' : 'f.' + id, $(id).value.trim()); });
    $('run').onclick = () => { const s = sel(); if (!Object.values(s).some(v => v.length)) return alert('Pick at least one option'); if ($('rotateKey').checked && !confirm('This revokes the active API key in Revinci. Anything using it stops working. Continue?')) return; runAll(s); };
    $('stop').onclick = () => { R.stop = true; api_log('Stop requested…', 'warn'); };
    $('close').onclick = () => { if (R.running && !confirm('A run is in progress. Close anyway?')) return; R.stop = true; host.remove(); delete window.__rvAuto; };
    $('min').onclick = () => { $('wrap').style.display = 'none'; $('mini').style.display = 'flex'; host.style.inset = 'auto'; host.style.right = '0'; host.style.bottom = '0'; };
    $('mini').onclick = () => show();
    $('dlHtml').onclick = () => { const r = R.steps.length ? report() : LS.get('lastReport', null); if (!r) return alert('No report yet'); download(`revinci-report-${r.tag}.html`, reportHtml(r), 'text/html'); };
    $('dlJson').onclick = () => { const r = R.steps.length ? report() : LS.get('lastReport', null); if (!r) return alert('No report yet'); download(`revinci-report-${r.tag}.json`, JSON.stringify(r, null, 2), 'application/json'); };
    const stored = () => LS.get('apiKey.' + HOST, null);
    const mask = k => k.slice(0, 12) + '••••••••' + k.slice(-4);
    $('reveal').onclick = () => { const s = stored(); if (s) $('keyVal').textContent = s.key; };
    $('copy').onclick = async () => { const s = stored(); if (s) { await navigator.clipboard.writeText(s.key).catch(() => {}); $('copy').textContent = 'Copied'; setTimeout(() => $('copy').textContent = 'Copy', 1500); } };
    function showKey(s) { const b = $('keyBox'); if (!s) return; b.className = 'key'; b.innerHTML = `<div>${html(s.name)} <span style="opacity:.6">(${html(s.source)})</span></div><div id="keyVal">${html(mask(s.key))}</div><div style="opacity:.6">saved ${new Date(s.savedAt).toLocaleString()}</div>`; }
    showKey(stored());
    function hist() { const h = LS.get('history', []); $('hist').innerHTML = h.length ? h.slice(0, 8).map(r => `<div style="display:flex;justify-content:space-between;padding:3px 0"><span>${new Date(r.at).toLocaleString()} · ${html(r.tag)}</span><span><b style="color:#2d7a12">${r.passed}</b> / <b style="color:#c23b3b">${r.failed}</b></span></div>`).join('') : 'No runs yet.'; }
    hist();
    function api_log(msg, level) { const d = document.createElement('div'); d.className = level || ''; d.textContent = new Date().toLocaleTimeString() + '  ' + msg; $('log').appendChild(d); $('log').scrollTop = 1e9; }
    function show() { $('wrap').style.display = ''; $('mini').style.display = 'none'; host.style.inset = '0'; host.style.right = ''; host.style.bottom = ''; }
    const lis = new Map();
    return {
      show, url: u => { $('url').textContent = HOST + u; },
      val: id => $(id).value || '', checked: id => $(id).checked,
      log: api_log,
      reset() { lis.clear(); $('steps').innerHTML = ''; $('log').innerHTML = ''; $('apis').innerHTML = ''; ['kp', 'kf', 'kt'].forEach(i => $(i).textContent = 0); },
      running(on) { $('run').style.display = on ? 'none' : ''; $('stop').style.display = on ? '' : 'none'; $('miniTxt').textContent = on ? 'Running…' : 'Revinci Test Automation'; },
      step(s) {
        let li = lis.get(s); if (!li) { li = document.createElement('li'); lis.set(s, li); $('steps').appendChild(li); $('kt').textContent = lis.size; }
        const d = s.error || s.detail || '';
        li.innerHTML = `<span class="dot ${s.status}"></span><span>${html(s.name)}</span><span class="hint">${s.end ? ((s.end - s.start) / 1000).toFixed(1) + 's' : ''}</span>${d ? `<span class="d ${s.error ? 'err' : ''}">${html(d)}</span>` : ''}`;
        $('kp').textContent = R.steps.filter(x => x.status === 'passed').length; $('kf').textContent = R.steps.filter(x => x.status === 'failed').length;
        li.scrollIntoView({ block: 'nearest' });
      },
      call(c) { const tr = document.createElement('tr'); tr.innerHTML = `<td>${c.method}</td><td>${html(c.path)}</td><td class="s${String(c.status)[0]}">${c.status}</td><td>${c.ms}ms</td>`; tr.title = c.sample; $('apis').appendChild(tr); },
      key: showKey,
      keyList(list) { $('keyList').textContent = list.length ? 'In Revinci: ' + list.map(k => `${k.name} (${k.keyPrefix}…, ${k.isActive ? 'active' : 'inactive'})`).join(', ') : 'No API keys in Revinci yet.'; },
      done(p, f) { hist(); $('miniTxt').textContent = `Done · ${p} passed · ${f} failed`; },
    };
  })();

  window.__rvAuto = { show: UI.show, run: runAll, state: R };
})();
