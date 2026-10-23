// Agent builder flows, mapped live on tessla-workspace-dev (see docs-mapping/flows.md).
//  Simple:   Identify → Outcomes → Price (One Time + Subscription + Consumption[Attribute Based] + Margin) → Actions (Skip) → Publish
//  Workflow: Identify → Price (With pricing · Subscription $0) → Sub-agents (action + Consumption matrix) → Outcomes → Offerings (Subscription + Included) → Publish
const a = require('../ant');
const { waitIdle } = require('../ui');
const { go, nameFor } = require('./admin');

const seen = (loc, ms) => loc.waitFor({ state: 'visible', timeout: ms }).then(() => true).catch(() => false);
const dd = page => page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function click(page, text, { timeout = 20000, exact = false } = {}) {
  const re = exact ? new RegExp(`^\\s*\\+?\\s*${esc(text)}\\s*$`, 'i') : new RegExp(`^\\s*\\+?\\s*${esc(text)}`, 'i');
  const b = page.locator('button:visible, [role=button]:visible, .ant-segmented-item:visible').filter({ hasText: re }).first();
  await b.waitFor({ state: 'visible', timeout: a.to(timeout) });
  await b.scrollIntoViewIfNeeded().catch(() => {});
  await b.click();
  await waitIdle(page, 600);
}

// Open a select (Locator of .ant-select), optionally type, then click the first (or matching) option.
async function pick(page, sel, { type, match, enter } = {}) {
  await sel.scrollIntoViewIfNeeded().catch(() => {});
  await sel.locator('.ant-select-selector').click();
  if (type) {
    const s = sel.locator('input.ant-select-selection-search-input');
    await s.fill('');
    await s.pressSequentially(type, { delay: 40 });
    await page.waitForTimeout(500);
    if (enter) { await s.press('Enter'); await page.waitForTimeout(400); return type; }
  }
  const opts = dd(page).locator('.ant-select-item-option:not(.ant-select-item-option-disabled)');
  const opt = match ? opts.filter({ hasText: new RegExp(esc(match), 'i') }).first() : opts.first();
  await opt.waitFor({ state: 'visible', timeout: a.to(10000) });
  const t = (await opt.innerText()).trim();
  await opt.click();
  await page.waitForTimeout(350);
  return t;
}
const pageOf = scope => (typeof scope.page === 'function' ? scope.page() : scope);
const selectIn = (scope, label) => scope.locator('.ant-form-item:visible').filter({ has: pageOf(scope).locator('.ant-form-item-label', { hasText: new RegExp(`^\\s*\\*?\\s*${esc(label)}`, 'i') }) }).locator('.ant-select').first();
const inputIn = (scope, label) => scope.locator('.ant-form-item:visible').filter({ has: pageOf(scope).locator('.ant-form-item-label', { hasText: new RegExp(`^\\s*\\*?\\s*${esc(label)}`, 'i') }) }).locator('input:not([type=hidden]):not(.ant-select-selection-search-input)').first();

async function fillLast(page, selector, value) {
  const el = page.locator(`${selector}:visible`).last();
  await el.waitFor({ state: 'visible', timeout: a.to(15000) });
  await el.fill(''); await el.fill(String(value));
}

// ---------- step 1: identify ----------
async function identify(run, mode, name, code) {
  const { page } = run;
  await go(run, `/dashboard/agents/new?mode=${mode}`);
  await fillLast(page, '#name', name);
  await fillLast(page, '#productCode', code);
  if (await seen(page.getByText(/More fields \(optional\)/i).first(), 2000)) {
    await page.getByText(/More fields \(optional\)/i).first().click();
    const cp = selectIn(page, 'Cost Profile');
    if (await seen(cp, 3000)) await pick(page, cp, run.data.costProfile ? { match: run.data.costProfile } : {}).catch(() => pick(page, cp));
  }
  await click(page, 'Save details');
  await page.waitForURL(u => /\/dashboard\/agents\/(?!new)[^/?]+/.test(String(u)), { timeout: a.to(30000) });
  await waitIdle(page, 1200);
  return page.url();
}

// ---------- outcomes (ids mapped live) ----------
const selById = (page, id) => page.locator('.ant-select').filter({ has: page.locator(`#${id}`) }).first();
async function outcomes(run) {
  const { page } = run;
  await click(page, 'Add Outcome');
  await fillLast(page, '#outcomes_0_outcomeId', 'task_completed');
  await fillLast(page, '#outcomes_0_outcomeName', 'Task completed');
  // success criteria: field "outcomeId" → operator "=" and value fill themselves
  await pick(page, selById(page, 'outcomes_0_successCriteria_0_successCriteriaName'), { type: 'outcomeId', enter: true });
  await page.keyboard.press('Escape').catch(() => {});
  // value rule: Time Based (default) → Agent Time Field processedAt, baseline 45 min, hourly cost 40
  await a.segment(page, 'Time Based').catch(() => {});
  await pick(page, selById(page, 'outcomes_0_pricingModels_0_eventVariables_0'), { type: 'processedAt', enter: true });
  await page.keyboard.press('Escape').catch(() => {});
  await fillLast(page, '#outcomes_0_pricingModels_0_baseline', '45');
  await fillLast(page, '#outcomes_0_pricingModels_0_cost', '40');
  await click(page, 'Save outcomes');
  const msg = await a.toast(page, 10000);
  return `outcome task_completed · criteria outcomeId = task_completed · time based 45 min @ 40/h${msg ? '' : ''}`;
}

// ---------- price list items ----------
// Inline panel (sub-agent / offering) that owns a given button — keeps clicks away from the agent's own price cards.
const panel = (page, buttonText) => page.locator('div.rounded-xl').filter({ has: page.locator('button', { hasText: new RegExp(`^\\s*${esc(buttonText)}\\s*$`) }) }).last();
async function methodCard(scope, method) {
  // Card text is "Subscription" + "A recurring charge…" with no space between them in textContent,
  // so match the card by its title element instead of a word boundary.
  const title = pageOf(scope).locator('*', { hasText: new RegExp(`^\\s*${esc(method)}\\s*$`) });
  const card = scope.locator('button:visible').filter({ has: title }).first();
  await card.waitFor({ state: 'visible', timeout: a.to(15000) });
  await card.scrollIntoViewIfNeeded().catch(() => {});
  await card.click();
  await waitIdle(pageOf(scope), 800);
}
async function withPricing(scope) {
  const b = scope.locator('button:visible').filter({ hasText: /^\s*With pricing/i }).first();
  await b.waitFor({ state: 'visible', timeout: a.to(15000) });
  await b.click();
  await waitIdle(pageOf(scope), 600);
}
async function priceForm(run, scope, method, { name, start, saveText = 'Save price' }) {
  const { page } = run;
  await fillLast(page, '#name', name);
  await pick(page, selectIn(scope, 'Transaction Unit'), { match: 'Currency' }); // default is Credit
  if (method === 'Consumption') await scope.locator('.ant-segmented-item:visible').filter({ hasText: /^\s*Attribute Based\s*$/ }).first().click();
  await a.priceUom(page, 'Each'); // every method, Margin included, needs Price UOM
  if (method === 'Margin') {
    await scope.locator('.ant-segmented-item:visible').filter({ hasText: /^\s*Percentage\s*$/ }).first().click().catch(() => {});
    const mv = scope.locator('#marginValue:visible').first();
    await mv.fill(''); await mv.fill('25');
  } else if (start !== undefined) {
    const sp = inputIn(scope, 'Start Price');
    if (await seen(sp, 2000)) { await sp.fill(''); await sp.fill(String(start)); }
  }
  const save = scope.locator('button:visible').filter({ hasText: new RegExp(`^\\s*${esc(saveText)}\\s*$`) }).first();
  await save.click();
  await a.toast(page, 10000);
  await waitIdle(page, 800);
}
async function matrix(run, { attribute } = {}) {
  const { page } = run;
  if (attribute) {
    const at = page.locator('.ant-select:visible').filter({ hasText: /Select attributes/i }).first();
    await at.waitFor({ state: 'visible', timeout: a.to(15000) });
    await pick(page, at, run.data.attribute ? { match: run.data.attribute } : {}).catch(() => pick(page, at));
    await page.keyboard.press('Escape');
  }
  await click(page, 'Create Agent Matrix');
  const price = page.locator('input[placeholder="Enter price"]:visible').last();
  await price.waitFor({ state: 'visible', timeout: a.to(15000) });
  await price.fill('5');
  const v = await pick(page, page.locator('.ant-select:visible').filter({ hasText: /Select value/i }).last());
  await click(page, 'Save Entries');
  await a.toast(page, 10000);
  return v;
}

// Each phase is its own step in the panel; if one fails, the rest of that agent is skipped.
async function phases(run, label, list) {
  for (let i = 0; i < list.length; i++) {
    const [name, fn] = list[i];
    const ok = await run.step(`${label} · ${name}`, fn);
    if (!ok) { run.log(`  skipped ${list.slice(i + 1).map(x => x[0]).join(', ') || 'nothing'} — "${name}" failed`, 'warn'); return false; }
  }
  return true;
}

async function simple(run) {
  const { page } = run;
  const name = nameFor(run, 'products.agentSimple', 'AT Simple Agent');
  const code = `AGT-S-${run.tag}`;
  const L = 'Simple agent';
  const ok = await phases(run, L, [
    ['1 Identify (name, code, save details)', async () => { await identify(run, 'simple', name, code); return `${name} [${code}]`; }],
    ['2 Value outcome', () => outcomes(run)],
    ['3 PLI · One Time', async () => { await withPricing(page); await methodCard(page, 'One Time'); await priceForm(run, page, 'One Time', { name: `One Time ${run.tag}`, start: 99 }); return 'One Time $99 · UOM Each'; }],
    ['3 PLI · Subscription', async () => { await methodCard(page, 'Subscription'); await priceForm(run, page, 'Subscription', { name: `Subscription ${run.tag}`, start: 149 }); return 'Subscription $149/mo · UOM Each'; }],
    ['3 PLI · Consumption (attribute based)', async () => { await methodCard(page, 'Consumption'); await priceForm(run, page, 'Consumption', { name: `Consumption ${run.tag}` }); const v = await matrix(run); return `Attribute based · matrix entry $5 · ${v}`; }],
    ['3 PLI · Margin', async () => { await methodCard(page, 'Margin'); await priceForm(run, page, 'Margin', { name: `Margin ${run.tag}` }); return 'Margin 25%'; }],
    ['4 Agent actions (Skip for now)', async () => { await click(page, 'Skip for now', { timeout: 15000 }); return 'skipped'; }],
    ['5 Publish', async () => { await click(page, 'Publish', { timeout: 30000 }); await page.waitForURL(u => /\/dashboard\/agents\/?(\?.*)?$/.test(String(u)), { timeout: a.to(30000) }); return 'published'; }],
  ]);
  run.data.products = run.data.products || {};
  run.data.products.agentSimple = { name, code, published: ok };
}

async function workflow(run) {
  const { page } = run;
  const name = nameFor(run, 'products.agentWorkflow', 'AT Workflow Agent');
  const code = `AGT-W-${run.tag}`;
  const L = 'Workflow agent';
  const ok = await phases(run, L, [
    ['1 Identify (name, code, save details)', async () => { await identify(run, 'workflow', name, code); return `${name} [${code}]`; }],
    ['2 Agent X price · Subscription $0', async () => {
      await withPricing(page); await methodCard(page, 'Subscription');
      await priceForm(run, page, 'Subscription', { name: `${name} platform`, start: 0 });
      return 'Subscription $0/mo · Currency USD · UOM Each';
    }],
    ['3 Sub-agent (action)', async () => {
      await click(page, 'Add sub-agent');
      await fillLast(page, '#name', `AT Action ${run.tag}`);
      await fillLast(page, '#productCode', `ACT-${run.tag}`);
      await click(page, 'Continue', { exact: true }); await a.toast(page, 10000);
      return `AT Action ${run.tag} [ACT-${run.tag}]`;
    }],
    ['3 Sub-agent PLI · Consumption (attribute based)', async () => {
      const sub = panel(page, 'Create sub-agent');
      await withPricing(sub); await methodCard(sub, 'Consumption');
      await priceForm(run, sub, 'Consumption', { name: `Action usage ${run.tag}`, saveText: 'Create sub-agent' });
      const v = await matrix(run, { attribute: true });
      await click(page, 'Done', { exact: true });
      return `attribute based · matrix entry $5 · ${v}`;
    }],
    ['4 Value outcome', () => outcomes(run)],
    ['5 Offering', async () => {
      await click(page, 'Add offering');
      await fillLast(page, '#name', `AT Offering ${run.tag}`);
      await fillLast(page, '#productCode', `OFF-${run.tag}`);
      await click(page, 'Continue', { exact: true }); await a.toast(page, 10000);
      return `AT Offering ${run.tag} [OFF-${run.tag}]`;
    }],
    ['5 Offering PLI · Subscription $1500 + include sub-agent', async () => {
      const off = panel(page, 'Create offering');
      await withPricing(off); await methodCard(off, 'Subscription');
      await priceForm(run, off, 'Subscription', { name: `Offering plan ${run.tag}`, start: 1500, saveText: 'Create offering' });
      const inc = page.locator('button').filter({ hasText: /^\s*Included\s*$/ });
      await inc.first().waitFor({ state: 'visible', timeout: a.to(15000) });
      const n = await inc.count();
      for (let i = 0; i < n; i++) { await inc.nth(i).scrollIntoViewIfNeeded().catch(() => {}); await inc.nth(i).click(); }
      await click(page, 'Save', { exact: true }); await a.toast(page, 10000);
      return `$1500/mo · ${n} sub-agent(s) Included`;
    }],
    ['6 Publish', async () => { await click(page, 'Publish', { exact: true, timeout: 30000 }); await page.waitForURL(u => /\/dashboard\/agents\/?(\?.*)?$/.test(String(u)), { timeout: a.to(30000) }); return 'published'; }],
  ]);
  run.data.products = run.data.products || {};
  run.data.products.agentWorkflow = { name, code, published: ok };
}

module.exports = { simple, workflow, _t: { selectIn, inputIn, pick, fillLast } };
