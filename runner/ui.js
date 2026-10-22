// Resilient UI helpers for the Revinci web app.
// Every helper tries several locator strategies (label -> placeholder -> nearby text -> name)
// so small markup changes in the app don't break the suites.

const DEFAULT_TIMEOUT = 15000;

function rx(text, exact = false) {
  const esc = String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return exact ? new RegExp(`^\\s*${esc}\\s*\\*?\\s*$`, 'i') : new RegExp(esc, 'i');
}

async function firstVisible(candidates, timeout = DEFAULT_TIMEOUT) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const loc of candidates) {
      try {
        const n = await loc.count();
        for (let i = 0; i < n; i++) {
          const el = loc.nth(i);
          if (await el.isVisible()) return el;
        }
      } catch (_) { /* try next */ }
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return null;
}

async function waitIdle(page, ms = 600) {
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch (_) {}
  await page.waitForTimeout(ms);
}

// Click a button / link / tab / menu item by its visible text.
async function click(page, text, opts = {}) {
  const scope = opts.within || page;
  const r = rx(text, opts.exact !== false);
  const el = await firstVisible([
    scope.getByRole('button', { name: r }),
    scope.getByRole('link', { name: r }),
    scope.getByRole('menuitem', { name: r }),
    scope.getByRole('tab', { name: r }),
    scope.getByRole('option', { name: r }),
    scope.getByText(r),
    scope.getByText(rx(text)),
  ], opts.timeout || DEFAULT_TIMEOUT);
  if (!el) throw new Error(`Could not find clickable "${text}"`);
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.click();
  await waitIdle(page, opts.settle ?? 400);
  return el;
}

async function exists(page, text, timeout = 3000) {
  const el = await firstVisible([page.getByText(rx(text))], timeout);
  return !!el;
}

// Find an input/textarea associated with a field label.
async function fieldFor(page, label, scope) {
  const s = scope || page;
  const r = rx(label, true);
  return firstVisible([
    s.getByLabel(r),
    s.getByPlaceholder(rx(label)),
    s.getByRole('textbox', { name: rx(label) }),
    s.getByRole('spinbutton', { name: rx(label) }),
    // label text followed by an input in the same field container
    s.locator(`xpath=//*[self::label or self::span or self::p or self::div][normalize-space(translate(text(),'*',''))="${label}"]/following::*[self::input or self::textarea][1]`),
    s.locator(`xpath=//*[contains(normalize-space(.),"${label}") and not(*)]/following::*[self::input or self::textarea][1]`),
    s.locator(`input[name*="${label.replace(/\s+/g, '').toLowerCase()}" i], textarea[name*="${label.replace(/\s+/g, '').toLowerCase()}" i]`),
  ], 8000);
}

async function fill(page, label, value, opts = {}) {
  if (value === undefined || value === null) return;
  const el = await fieldFor(page, label, opts.within);
  if (!el) throw new Error(`Field "${label}" not found`);
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.click({ clickCount: 3 }).catch(() => {});
  await el.fill('');
  await el.fill(String(value));
  if (opts.enter) await el.press('Enter');
  await page.waitForTimeout(150);
}

// Select an option in a dropdown / combobox / autocomplete identified by its label.
async function select(page, label, optionText, opts = {}) {
  if (!optionText) return;
  const s = opts.within || page;
  // 1) native <select>
  const native = await firstVisible([s.getByLabel(rx(label, true)).locator('xpath=self::select')], 1000);
  if (native) { await native.selectOption({ label: optionText }).catch(() => native.selectOption(optionText)); return; }

  // 2) custom combobox: click the control near the label
  const trigger = await firstVisible([
    s.getByRole('combobox', { name: rx(label) }),
    s.getByLabel(rx(label, true)),
    s.locator(`xpath=//*[normalize-space(translate(text(),'*',''))="${label}"]/following::*[@role="combobox" or self::button or self::input][1]`),
    s.getByPlaceholder(rx(`select ${label}`)),
    s.getByText(rx(`select ${label}`)),
  ], 8000);
  if (!trigger) throw new Error(`Dropdown "${label}" not found`);
  await trigger.scrollIntoViewIfNeeded().catch(() => {});
  await trigger.click();
  await page.waitForTimeout(300);
  // type to filter when it is a searchable input
  const tag = await trigger.evaluate(e => e.tagName).catch(() => '');
  if (tag === 'INPUT' && opts.type !== false) await trigger.fill(String(optionText)).catch(() => {});
  await page.waitForTimeout(400);
  const opt = await firstVisible([
    page.getByRole('option', { name: rx(optionText, true) }),
    page.getByRole('option', { name: rx(optionText) }),
    page.getByRole('menuitem', { name: rx(optionText) }),
    page.locator('[role="listbox"] >> text=' + JSON.stringify(String(optionText))),
    page.getByText(rx(optionText, true)),
  ], 6000);
  if (!opt) {
    if (opts.optional) { await page.keyboard.press('Escape'); return false; }
    throw new Error(`Option "${optionText}" not found in "${label}"`);
  }
  await opt.click();
  await page.waitForTimeout(300);
  return true;
}

// Pick the first available option in a dropdown (when the exact value doesn't matter).
async function selectFirst(page, label, opts = {}) {
  const s = opts.within || page;
  const trigger = await firstVisible([
    s.getByRole('combobox', { name: rx(label) }),
    s.getByLabel(rx(label, true)),
    s.locator(`xpath=//*[normalize-space(translate(text(),'*',''))="${label}"]/following::*[@role="combobox" or self::button or self::input][1]`),
  ], 8000);
  if (!trigger) throw new Error(`Dropdown "${label}" not found`);
  await trigger.click();
  await page.waitForTimeout(500);
  const opt = await firstVisible([page.getByRole('option')], 6000);
  if (!opt) throw new Error(`No options in "${label}"`);
  const text = (await opt.innerText()).trim();
  await opt.click();
  await page.waitForTimeout(300);
  return text;
}

async function check(page, label, on = true) {
  const el = await firstVisible([
    page.getByRole('checkbox', { name: rx(label) }),
    page.getByRole('switch', { name: rx(label) }),
    page.getByLabel(rx(label)),
  ], 6000);
  if (!el) throw new Error(`Checkbox "${label}" not found`);
  const state = await el.isChecked().catch(() => null);
  if (state !== on) await el.click();
}

// Wait for a success toast or a given text; returns the toast text if any.
async function expectSuccess(page, text, timeout = 15000) {
  const el = await firstVisible([
    ...(text ? [page.getByText(rx(text))] : []),
    page.getByText(/success|created|saved|added|updated|published|finali[sz]ed|activated/i),
  ], timeout);
  const err = await firstVisible([page.getByText(/error|failed|already exists|required|invalid/i)], 500);
  if (!el && err) throw new Error('App reported: ' + (await err.innerText()).slice(0, 200));
  return el ? (await el.innerText().catch(() => '')).slice(0, 200) : '';
}

async function gotoPath(page, base, path) {
  const url = new URL(path, base).toString();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitIdle(page, 800);
}

// Left-nav navigation by label path, e.g. ['Setup', 'Currency Management', 'Currency']
async function nav(page, labels) {
  for (const l of labels) await click(page, l, { settle: 600 });
}

module.exports = { rx, firstVisible, waitIdle, click, exists, fill, select, selectFirst, check, expectSuccess, gotoPath, nav, fieldFor };
