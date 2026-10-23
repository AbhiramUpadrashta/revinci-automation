// Quote to cash: quote (bag, finalize, lifecycle) → order (bag, finalize) → entitlement
// (activate, map external plan ID) → usage event against the plan.
const a = require('../ant');
const { waitIdle } = require('../ui');
const { go, nameFor } = require('./admin');
const http = require('../http');

const title = 'Quote · Order · Entitlement';
const OPTIONS = [
  { id: 'quote', label: 'Create quote, add to bag, finalize & move through lifecycle' },
  { id: 'order', label: 'Create order (type account), add first agent, LLM popup, finalize' },
  { id: 'entitlement', label: 'Open first entitlement & activate (today)' },
  { id: 'usage', label: 'Send a usage event to the plan (needs API key)' },
];

function productToSell(run) {
  const p = run.data.products || {};
  return run.cfg.product || p.standalone?.code || p.agentSimple?.code || p.bundle?.code || null;
}

async function pickAccount(page, run, label, id) {
  if (run.data.account) { const ok = await a.select(page, label, run.data.account, { id, optional: true }); if (ok) return ok; }
  if (run.cfg.account) { const ok = await a.select(page, label, run.cfg.account, { id, optional: true }); if (ok) return ok; }
  return a.selectFirst(page, label, { id });
}

// Generic bag: search a product, select it, add to bag.
async function addToBag(run, query) {
  const { page } = run;
  if (!query) throw new Error('No product to add — run Product setup first or set "Product to sell" in the panel');
  await a.buttonAny(page, ['Add Product', 'Add Products', '+ Add', 'Add'], 3000);
  const search = page.locator('input[placeholder*="search" i]:visible').last();
  await search.waitFor({ timeout: 15000 });
  await search.fill(query);
  await search.press('Enter').catch(() => {});
  await page.waitForTimeout(1500);
  const hit = page.getByText(query, { exact: false }).last();
  await hit.click();
  await page.locator('.ant-checkbox-input:visible').last().check().catch(() => {});
  await page.waitForTimeout(600);
  await a.buttonAny(page, ['LLM'], 300); // agents with a cost profile ask for a model
  const model = page.locator('.ant-modal:visible .ant-select, .ant-drawer:visible .ant-select').first();
  if (await model.count()) { await model.locator('.ant-select-selector').click(); await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first().click().catch(() => {}); }
  const added = await a.buttonAny(page, ['Add to Bag', 'Add To Bag', 'Add to bag', 'Add Selected', 'Add'], 6000);
  if (!added) throw new Error('No "Add to Bag" button after selecting the product');
  await a.toast(page, 8000).catch(() => '');
  await waitIdle(page, 1500);
  return query;
}

async function quote(run) {
  const { page } = run;
  await go(run, '/dashboard/cpq/quote');
  await a.button(page, 'Quote');
  await waitIdle(page, 1500);
  const name = nameFor(run, 'q2c.quote', 'AT Quote');
  await a.fill(page, 'Name', name, { id: 'name' });
  const acct = await pickAccount(page, run, 'Account Id', 'accountId');
  await a.select(page, 'Currency Id', 'USD', { id: 'currencyId', optional: true }) || await a.selectFirst(page, 'Currency Id', { id: 'currencyId' });
  await a.select(page, 'Billing Frequency', 'Monthly', { id: 'billingFrequency', optional: true });
  await a.select(page, 'Payment Term', '30', { id: 'paymentTerm', optional: true }) || await a.selectFirst(page, 'Payment Term', { id: 'paymentTerm' }).catch(() => {});
  const start = new Date(); const end = new Date(); end.setFullYear(end.getFullYear() + 1); end.setDate(end.getDate() - 1);
  await a.date(page, 'startDate', start);
  await a.date(page, 'endDate', end);
  await a.button(page, 'Save & Go to Bag');
  await a.toast(page).catch(() => '');
  await waitIdle(page, 2500);
  run.data.quote = { name, url: page.url(), account: acct };
  const item = await addToBag(run, productToSell(run));
  const trail = [];
  for (const b of ['Finalize', 'Submit for Approval', 'Generate Document', 'Accept', 'Convert to Order']) {
    if (await a.buttonAny(page, [b], 4000)) {
      await a.buttonAny(page, ['Yes', 'Confirm', 'OK', 'Submit'], 2500);
      await a.toast(page, 8000).catch(e => trail.push(`${b} ✗ ${e.message}`));
      trail.push(b);
      await waitIdle(page, 1500);
    }
  }
  return `${name} · ${acct} · ${item} · ${trail.join(' → ') || 'no lifecycle buttons shown'}`;
}

// Always go to the Accounts screen and copy the name of the first account in the list.
async function accountName(run) {
  const { page } = run;
  await go(run, '/dashboard/crm/account');
  const cell = page.locator('.ag-row[row-index="0"] [col-id="name"]').first();
  await cell.waitFor({ state: 'visible', timeout: a.to(20000) });
  const n = (await cell.innerText()).trim();
  if (!n || n === '-') throw new Error('Could not read the first account name on the Accounts screen');
  run.log(`  copied first account on the Accounts screen: ${n}`);
  return n;
}

// Type the account name into the Account select and take the first result.
async function typeAccount(run, name) {
  const { page } = run;
  const sel = a.item(page, 'Account').locator('.ant-select').first();
  await sel.waitFor({ state: 'visible', timeout: a.to(20000) });
  await sel.locator('.ant-select-selector').click();
  const search = sel.locator('input.ant-select-selection-search-input');
  await search.fill('');
  await search.pressSequentially(name, { delay: 40 });
  const first = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first();
  await first.waitFor({ state: 'visible', timeout: a.to(15000) });
  const picked = (await first.innerText()).trim();
  await first.click();
  await page.waitForTimeout(400);
  return picked;
}

// antd date picker → "Today" link in its footer.
async function pickToday(page, input) {
  await input.click();
  const today = page.locator('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden) .ant-picker-now-btn, .ant-picker-dropdown:not(.ant-picker-dropdown-hidden) .ant-picker-today-btn').first();
  if (await seen(today, 3000)) await today.click();
  else { await input.fill(a.fmt(new Date())); await input.press('Enter'); }
  await page.waitForTimeout(400);
  return input.inputValue().catch(() => '');
}

async function selectByLabel(page, label, want) {
  const fi = a.item(page, label);
  if (!(await fi.count()) || !(await fi.isVisible().catch(() => false))) return null;
  return await a.select(page, label, want, { optional: true, search: false }) || await a.selectFirst(page, label);
}

// Playwright's isVisible() never waits — this does.
const seen = (loc, ms) => loc.waitFor({ state: 'visible', timeout: ms }).then(() => true).catch(() => false);

// LLM popup after "Add to bag": open the LLM pick list, select the first model, click Configure.
async function costProfilePopup(run) {
  const { page } = run;
  const modal = page.locator('.ant-modal-content').filter({ hasText: /Configure Cost Profiles/i }).first();
  if (!(await seen(modal, 15000))) return 'no LLM popup';
  await page.waitForTimeout(800);
  // Done inside the page, the same way it was verified by hand: open each pick list with a mousedown,
  // click its first option, then press "Configure Cost Profiles". (Real mouse clicks were landing on the
  // modal's animation layer and waiting forever.)
  const pickAll = async onlyLlm => page.evaluate(async onlyLlm => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const m = [...document.querySelectorAll('.ant-modal-content')].find(x => /Configure Cost Profiles/i.test(x.innerText));
    if (!m) return { closed: true, picked: [] };
    const sels = [...m.querySelectorAll('.ant-select')];
    const targets = onlyLlm ? [sels.find(x => /LLM/i.test(x.innerText)) || sels[0]] : sels.filter(x => !x.querySelector('.ant-select-selection-item'));
    const picked = [];
    for (const sel of targets.filter(Boolean)) {
      for (let i = 0; i < 3; i++) {
        sel.querySelector('.ant-select-selector').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await wait(900);
        const dd = [...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')].pop();
        const opt = dd && dd.querySelector('.ant-select-item-option:not(.ant-select-item-option-disabled)');
        if (opt) { const t = opt.innerText.trim(); opt.click(); await wait(500); if (sel.querySelector('.ant-select-selection-item')) { picked.push(t); break; } }
      }
    }
    return { closed: false, picked, filled: sels.map(x => (x.querySelector('.ant-select-selection-item') || {}).innerText || '') };
  }, onlyLlm);
  const configure = () => page.evaluate(() => {
    const m = [...document.querySelectorAll('.ant-modal-content')].find(x => /Configure Cost Profiles/i.test(x.innerText));
    const b = m && [...m.querySelectorAll('button')].find(x => /^\s*Configure/i.test(x.innerText));
    if (b) b.click(); return !!b;
  });
  const r1 = await pickAll(true);
  if (!r1.picked.length) throw new Error('LLM pick list: could not select the first model');
  run.log(`  LLM model → ${r1.picked[0]}`);
  await configure();
  if (!(await modal.waitFor({ state: 'hidden', timeout: 6000 }).then(() => true).catch(() => false))) {
    const r2 = await pickAll(false);              // other pick lists required — fill them too
    run.log(`  popup still open; also picked ${r2.picked.join(', ') || 'nothing'}`);
    await configure();
    if (!(await modal.waitFor({ state: 'hidden', timeout: 10000 }).then(() => true).catch(() => false))) {
      const err = await page.locator('.ant-modal-content .ant-form-item-explain-error, .ant-message-error').allInnerTexts().catch(() => []);
      throw new Error('LLM popup did not close after Configure' + (err.length ? ': ' + err.join('; ') : ''));
    }
  }
  await a.toast(page, 8000).catch(() => '');
  return `LLM → ${r1.picked[0]} → Configure`;
}

async function order(run) {
  const { page } = run;
  const acct = await accountName(run);
  await go(run, '/dashboard/orders/new');
  const name = nameFor(run, 'q2c.order', 'AT Order');
  const number = `ORD-${run.tag}`;
  const picked = await typeAccount(run, acct);
  if (picked !== acct) throw new Error(`Account pick list showed "${picked}" first, expected "${acct}"`);
  await a.fill(page, 'Name', name, { id: 'name' });
  await a.fill(page, 'Number', number, { id: 'quoteNumber' });
  await a.fill(page, 'Description', 'Created by Revinci Test Automation', { id: 'description' });
  const start = await pickToday(page, a.item(page, 'Start Date').locator('.ant-picker input').first());
  await selectByLabel(page, 'Billing Frequency', 'Monthly');
  await a.segment(page, '30 Days').catch(() => {});
  await selectByLabel(page, 'Currency', 'USD');
  // Fields after Currency (e.g. Rate Type) only show for some currencies — fill them if present, otherwise just Continue.
  await page.waitForTimeout(600);
  for (const [label, want] of [['Rate Type', 'Budgeted']]) {
    try { const v = await selectByLabel(page, label, want); if (!v) run.log(`  ${label} not shown — continuing`); }
    catch (e) { run.log(`  ${label} skipped (${e.message.slice(0, 80)}) — continuing`); await page.keyboard.press('Escape').catch(() => {}); }
  }
  await a.button(page, 'Continue');
  await page.waitForURL(u => /\/dashboard\/orders\/[0-9a-f-]{36}/.test(String(u)), { timeout: a.to(30000) });
  run.data.order = { name, number, account: picked, url: page.url() };

  // Bag: click the first product (agent) in the left list, then Add to bag.
  const list = page.locator('input[placeholder="Search products"]').locator('xpath=ancestor::div[contains(@class,"w-1/4")][1]');
  const firstItem = list.locator('.space-y-1 > div.cursor-pointer').first();
  await firstItem.waitFor({ state: 'visible', timeout: a.to(30000) });
  const product = (await firstItem.innerText()).split('\n').pop().trim();
  await firstItem.click();
  await waitIdle(page, 1500);
  await a.button(page, 'Add to bag', { timeout: 30000 });
  const popup = await costProfilePopup(run);
  // Finalize: click it directly and confirm the order leaves the bag (lands on the Orders list)
  const fin = page.locator('button').filter({ hasText: /^\s*Finalize\s*$/ }).first();
  await fin.waitFor({ state: 'visible', timeout: a.to(30000) });
  const listUrl = u => /\/dashboard\/orders\/?(\?.*)?$/.test(String(u));
  for (let i = 0; i < 3 && !listUrl(page.url()); i++) {
    await fin.evaluate(b => { b.scrollIntoView({ block: 'center' }); b.click(); }).catch(() => {});
    await a.buttonAny(page, ['Yes', 'Confirm', 'OK'], 2500);
    await page.waitForURL(listUrl, { timeout: 15000 }).catch(() => {});
  }
  if (!listUrl(page.url())) {
    const err = await page.locator('.ant-message-error, .ant-notification-notice-error').allInnerTexts().catch(() => []);
    throw new Error('Finalize did not complete' + (err.length ? ': ' + err.join('; ') : ' — still on the order bag'));
  }
  run.data.order.product = product;
  return `${name} (${number}) · account ${picked} · start ${start} · ${product} added · ${popup} · finalized`;
}

// Entitlement list → open the first entitlement (eye button) → Activate → Activation Date = today → Activate.
async function entitlement(run) {
  const { page } = run;
  await go(run, '/dashboard/revenueEntitlement');
  const target = run.data.order?.name;
  await page.locator('.ag-row[row-index="0"]').first().waitFor({ state: 'visible', timeout: a.to(30000) });
  let idx = 0;
  if (target) {
    for (let i = 0; i < 20; i++) {
      const names = await page.locator('.ag-pinned-left-cols-container .ag-row').allInnerTexts();
      const k = names.findIndex(t => t.trim() === target);
      if (k >= 0) { idx = Number(await page.locator('.ag-pinned-left-cols-container .ag-row').nth(k).getAttribute('row-index')); break; }
      await page.waitForTimeout(3000); await page.reload({ waitUntil: 'domcontentloaded' }); await waitIdle(page, 1500);
    }
  }
  const entName = (await page.locator(`.ag-pinned-left-cols-container .ag-row[row-index="${idx}"]`).innerText().catch(() => '')).trim();
  // The eye icon only appears on hover: hover the row, then click the eye to open the detail view.
  const detail = u => /revenueEntitlement\/[0-9a-f-]{36}/.test(String(u));
  const rowSel = `.ag-row[row-index="${idx}"]`;
  const eye = page.locator(`.ag-pinned-right-cols-container ${rowSel} button:has(.anticon-eye), .ag-pinned-right-cols-container ${rowSel} button`).first();
  for (let attempt = 1; attempt <= 3 && !detail(page.url()); attempt++) {
    await page.locator(`.ag-pinned-left-cols-container ${rowSel}`).first().hover({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
    // click the eye button element directly (hover-only icons can't take a real mouse click reliably)
    await page.evaluate(sel => {
      const row = document.querySelector(`.ag-pinned-right-cols-container ${sel}`);
      const b = row && ((row.querySelector('.anticon-eye') || {}).closest ? row.querySelector('.anticon-eye').closest('button') : row.querySelector('button'));
      if (b) b.click();
    }, rowSel).catch(() => {});
    await page.waitForURL(detail, { timeout: 10000 }).catch(() => {});
  }
  if (!detail(page.url())) throw new Error('Could not open the entitlement detail view (eye icon on hover)');
  run.log('  opened entitlement detail via the eye icon');
  const id = page.url().match(/revenueEntitlement\/([0-9a-f-]{36})/)[1];
  run.data.entitlement = { id, name: entName };
  await a.button(page, 'Activate', { timeout: 30000 });
  const modal = page.locator('.ant-modal-wrap:visible').last();
  const dateInput = modal.locator('.ant-picker input').first();
  await dateInput.waitFor({ state: 'visible', timeout: a.to(15000) });
  const d = await pickToday(page, dateInput);
  if (await modal.isVisible().catch(() => false)) {
    const btn = modal.locator('button').filter({ hasText: /^\s*Activate\s*$/ }).first();
    if (await btn.isVisible().catch(() => false)) await btn.evaluate(b => b.click());
  }
  await a.toast(page, 8000).catch(() => '');
  const ok = await page.locator('button:visible').filter({ hasText: /^\s*Generate Invoice\s*$/ }).first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  if (!ok && await a.hasButton(page, 'Activate', 1500)) throw new Error('Entitlement still shows "Activate" after confirming');
  run.data.entitlement.status = 'Active';
  run.data.entitlement.activationDate = d;
  const plans = await http.call(run, 'GET', `/revenue-management/api/v1/plans/entitlement/${id}`, null, { auth: 'session' }).catch(() => null);
  const planList = plans ? http.items(plans.body) : [];
  run.data.entitlement.planNumber = planList[0]?.planNumber || planList[0]?.number || null;
  return `${entName || id} · activated on ${d} · Active${planList.length ? ` · ${planList.length} plan(s)` : ''}`;
}

async function usage(run) {
  const plan = run.data.entitlement?.planNumber || run.cfg.planNumber;
  if (!plan) throw new Error('No plan number — run the entitlement step or set "Plan number" in the panel');
  const body = {
    provider: 'openai', planNumber: plan, customerId: 'automation@revinci.ai', externalAccountId: `ACC-${run.tag}`,
    apiResponse: { id: `chatcmpl_${run.tag}_${Date.now()}`, model: 'gpt-4o', usage: { input_tokens: 5102, output_tokens: 2700, cache_read_input_tokens: 0 } },
    metadata: { session_id: `sess-${run.tag}`, agent_name: 'revinci-automation', outcome_id: 'task_completed', source_platform: 'revinci_automation' },
    eventTimestamp: Date.now(),
  };
  const res = await http.call(run, 'POST', '/usage-ingestion/api/v1/usage/ingest', body, { auth: run.apiKey ? 'key' : 'session' });
  if (res.status >= 300) throw new Error(`Ingest → HTTP ${res.status}: ${String(res.text).slice(0, 160)}`);
  return `HTTP ${res.status} · ${res.body?.status || ''} ${res.body?.idempotencyKey || ''}`;
}

async function run(r, picks) {
  const map = { quote, order, entitlement, usage };
  for (const o of OPTIONS) if (picks.includes(o.id)) await r.step(`Q2C · ${o.label}`, () => map[o.id](r));
}

module.exports = { title, OPTIONS, run };
