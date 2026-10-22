// Ant Design–aware helpers, built from the live Revinci screens:
// every form field is an .ant-form-item with a label; inputs carry stable ids (#name, #accountId…);
// dropdowns are .ant-select; dates are .ant-picker in DD-MM-YYYY; toasts are .ant-message / .ant-notification.
const { waitIdle } = require('./ui');

// Wait mode: 'standard' uses the given timeout; 'visible' keeps waiting for required elements up to the max.
const WAIT = { mode: 'standard', maxMs: 10 * 60 * 1000 };
function setWait(mode, maxMin) { WAIT.mode = mode === 'visible' ? 'visible' : 'standard'; WAIT.maxMs = Math.max(1, Number(maxMin) || 10) * 60 * 1000; }
const to = ms => (WAIT.mode === 'visible' ? Math.max(ms, WAIT.maxMs) : ms);

const clean = s => String(s || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function item(page, label) {
  return page.locator('.ant-form-item:visible').filter({
    has: page.locator('.ant-form-item-label', { hasText: new RegExp(`^\\s*\\*?\\s*${esc(label)}\\s*\\*?\\s*$`, 'i') }),
  }).first();
}

async function fill(page, label, value, { id } = {}) {
  if (value === undefined || value === null) return;
  let el = id ? page.locator(`#${id}`).first() : null;
  if (!el || !(await el.count())) el = item(page, label).locator('input:not([type=hidden]):not(.ant-select-selection-search-input), textarea').first();
  await el.waitFor({ state: 'visible', timeout: to(15000) });
  await el.click();
  await el.fill('');
  await el.fill(String(value));
}

async function openSelect(page, label, { id } = {}) {
  let sel = id ? page.locator(`.ant-select:has(#${id})`).first() : null;
  if (!sel || !(await sel.count())) sel = item(page, label).locator('.ant-select').first();
  await sel.waitFor({ state: 'visible', timeout: to(15000) });
  await sel.locator('.ant-select-selector').click();
  await page.waitForTimeout(400);
  return sel;
}

const dropdown = page => page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();

// Choose an option by text. With {create:true} a typed value is accepted (tags / "type and enter").
async function select(page, label, text, opts = {}) {
  if (!text) return null;
  const sel = await openSelect(page, label, opts);
  const search = sel.locator('input.ant-select-selection-search-input');
  if (opts.search !== false && await search.count()) { await search.fill(String(text)); await page.waitForTimeout(700); }
  const dd = dropdown(page);
  const opt = dd.locator('.ant-select-item-option').filter({ hasText: new RegExp(`^\\s*${esc(text)}\\s*$`, 'i') }).first();
  const loose = dd.locator('.ant-select-item-option').filter({ hasText: new RegExp(esc(text), 'i') }).first();
  if (await opt.count()) await opt.click();
  else if (await loose.count()) await loose.click();
  else if (opts.create) await search.press('Enter');
  else { await page.keyboard.press('Escape'); if (opts.optional) return null; throw new Error(`Option "${text}" not found in ${label}`); }
  await page.waitForTimeout(300);
  if (opts.multi) await page.keyboard.press('Escape');
  return text;
}

// Choose the first (or n-th) available option; returns its text.
async function selectFirst(page, label, opts = {}) {
  await openSelect(page, label, opts);
  const options = dropdown(page).locator('.ant-select-item-option:not(.ant-select-item-option-disabled)');
  await options.first().waitFor({ state: 'visible', timeout: to(10000) });
  let idx = 0;
  if (opts.avoid) {
    const n = await options.count();
    for (let i = 0; i < n; i++) { const t = (await options.nth(i).innerText()).trim(); if (!opts.avoid.some(a => t.toLowerCase().includes(a.toLowerCase()))) { idx = i; break; } }
  }
  const o = options.nth(idx);
  const t = (await o.innerText()).trim();
  await o.click();
  await page.waitForTimeout(300);
  if (opts.multi) await page.keyboard.press('Escape');
  return t;
}

async function optionsOf(page, label, opts = {}) {
  await openSelect(page, label, opts);
  const options = dropdown(page).locator('.ant-select-item-option');
  await options.first().waitFor({ timeout: 8000 }).catch(() => {});
  const texts = (await options.allInnerTexts()).map(s => s.trim());
  await page.keyboard.press('Escape');
  return texts;
}

async function tags(page, label, values) {
  const sel = await openSelect(page, label);
  const input = sel.locator('input.ant-select-selection-search-input');
  for (const v of values) { await input.fill(v); await page.waitForTimeout(250); await input.press('Enter'); }
  await page.keyboard.press('Escape');
}

async function date(page, id, d) {
  const el = page.locator(`#${id}`).first();
  await el.click();
  await el.fill(fmt(d));
  await el.press('Enter');
  await page.waitForTimeout(300);
}

async function dateRange(page, label, from, to) {
  const inputs = item(page, label).locator('.ant-picker input');
  await inputs.nth(0).click();
  await inputs.nth(0).fill(fmt(from)); await inputs.nth(0).press('Enter');
  await inputs.nth(1).fill(fmt(to)); await inputs.nth(1).press('Enter');
  await page.waitForTimeout(300);
}

function fmt(d) {
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

// Price UOM: type the value into the dropdown's search box, pick the matching
// option from the pick list, and confirm it is shown as selected.
async function priceUom(page, value = 'Each') {
  const labels = ['Price UOM', 'Price Uom', 'Price Unit of Measure', 'UOM', 'Unit of Measure'];
  let fi = null;
  for (const l of labels) {
    const cand = item(page, l);
    if (await cand.count() && await cand.isVisible().catch(() => false)) { fi = cand; break; }
  }
  if (!fi) throw new Error('Price UOM field not found on this screen');
  const sel = fi.locator('.ant-select').first();
  await sel.scrollIntoViewIfNeeded().catch(() => {});
  for (let attempt = 1; attempt <= 3; attempt++) {
    await sel.locator('.ant-select-selector').click();
    const search = sel.locator('input.ant-select-selection-search-input');
    if (await search.count()) {
      await search.fill('');
      await search.pressSequentially(value, { delay: 60 });
    }
    const dd = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
    const exact = dd.locator('.ant-select-item-option').filter({ hasText: new RegExp(`^\\s*${esc(value)}\\s*$`, 'i') }).first();
    const loose = dd.locator('.ant-select-item-option').filter({ hasText: new RegExp(esc(value), 'i') }).first();
    try { await exact.or(loose).first().waitFor({ state: 'visible', timeout: 6000 }); } catch (_) {
      await page.keyboard.press('Escape'); await page.waitForTimeout(500); continue;
    }
    await ((await exact.count()) ? exact : loose).click();
    await page.waitForTimeout(400);
    const shown = (await sel.locator('.ant-select-selection-item').first().innerText().catch(() => '')).trim();
    if (shown.toLowerCase().includes(value.toLowerCase())) return shown;
  }
  throw new Error(`Price UOM: could not select "${value}" from the pick list`);
}

async function checkbox(page, text, on = true) {
  const w = page.locator('.ant-checkbox-wrapper:visible', { hasText: new RegExp(esc(text), 'i') }).first();
  const checked = await w.locator('.ant-checkbox-checked').count();
  if (!!checked !== on) await w.click();
}

async function switchOn(page, labelText, on = true) {
  const sw = labelText ? item(page, labelText).locator('.ant-switch') : page.locator('.ant-switch:visible').first();
  const isOn = await sw.evaluate(e => e.classList.contains('ant-switch-checked'));
  if (isOn !== on) await sw.click();
}

async function segment(page, text) {
  await page.locator('.ant-segmented-item:visible', { hasText: new RegExp(`^\\s*${esc(text)}\\s*$`, 'i') }).first().click();
}

// Click a visible button by its text (icons and "+" prefixes ignored).
async function button(page, text, { exact = true, within, timeout = 15000 } = {}) {
  timeout = to(timeout);
  const scope = within || page;
  const re = exact ? new RegExp(`^\\s*\\+?\\s*${esc(text)}\\s*(→)?\\s*$`, 'i') : new RegExp(esc(text), 'i');
  const b = scope.locator('button:visible, [role=button]:visible, a.ant-btn:visible').filter({ hasText: re }).first();
  await b.waitFor({ state: 'visible', timeout });
  if (await b.isDisabled().catch(() => false)) throw new Error(`Button "${text}" is disabled`);
  await b.click();
  await waitIdle(page, 500);
}

async function hasButton(page, text, timeout = 2500) {
  const re = new RegExp(`^\\s*\\+?\\s*${esc(text)}\\s*(→)?\\s*$`, 'i');
  try { await page.locator('button:visible').filter({ hasText: re }).first().waitFor({ state: 'visible', timeout }); return true; } catch (_) { return false; }
}

// Click the first of several possible buttons that is present; returns its label or null.
async function buttonAny(page, labels, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const l of labels) if (await hasButton(page, l, 200)) { await button(page, l); return l; }
    await page.waitForTimeout(250);
  }
  return null;
}

// Wait for an antd toast; throws on an error toast or inline validation errors.
async function toast(page, timeout = 15000) {
  const ok = page.locator('.ant-message-success, .ant-notification-notice-success, .ant-message-notice:not(:has(.ant-message-error))').first();
  const bad = page.locator('.ant-message-error, .ant-notification-notice-error').first();
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await bad.isVisible().catch(() => false)) throw new Error('App error: ' + (await bad.innerText()).trim().slice(0, 200));
    if (await ok.isVisible().catch(() => false)) return (await ok.innerText()).trim().slice(0, 160);
    const inline = page.locator('.ant-form-item-explain-error:visible').first();
    if (await inline.isVisible().catch(() => false)) {
      const errs = await page.locator('.ant-form-item-explain-error:visible').allInnerTexts();
      throw new Error('Validation: ' + errs.join('; ').slice(0, 200));
    }
    await page.waitForTimeout(250);
  }
  return '';
}

async function rowExists(page, text) {
  return (await page.locator(`text=${text}`).count()) > 0;
}

module.exports = { setWait, to, WAIT, priceUom, item, fill, select, selectFirst, optionsOf, tags, date, dateRange, fmt, checkbox, switchOn, segment, button, hasButton, buttonAny, toast, rowExists, clean };
