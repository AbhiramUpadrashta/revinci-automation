// Agent builder flows, mapped live on tessla-workspace-dev (see docs-mapping/flows.md).
//  Simple:   Identify → Outcomes → Price (One Time + Subscription + Consumption[Attribute Based] + Margin) → Actions (Skip) → Publish
//  Workflow: Identify → Price (Without pricing) → Sub-agents (action + Consumption matrix) → Outcomes → Offerings (Subscription + Included) → Publish
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
const selectIn = (scope, label) => scope.locator('.ant-form-item:visible').filter({ has: scope.page().locator('.ant-form-item-label', { hasText: new RegExp(`^\\s*\\*?\\s*${esc(label)}`, 'i') }) }).locator('.ant-select').first();
const inputIn = (scope, label) => scope.locator('.ant-form-item:visible').filter({ has: scope.page().locator('.ant-form-item-label', { hasText: new RegExp(`^\\s*\\*?\\s*${esc(label)}`, 'i') }) }).locator('input:not([type=hidden]):not(.ant-select-selection-search-input)').first();

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
  await page.waitForURL(u => /\/dashboard\/agents\/[0-9a-f-]{36}/.test(String(u)), { timeout: a.to(30000) });
  await waitIdle(page, 1200);
  return page.url();
}

// ---------- outcomes ----------
async function outcomes(run) {
  const { page } = run;
  await click(page, 'Add Outcome');
  await fillLast(page, '#outcomes_0_outcomeId', 'task_completed');
  await fillLast(page, '#outcomes_0_outcomeName', 'Task completed');
  const cap = inputIn(page, 'Value Cap');
  if (await seen(cap, 1500)) { await cap.fill('1000'); }
  // success criteria: field select — type "outcomeId" + Enter (operator and value fill themselves)
  const crit = page.locator('.ant-select:visible').filter({ has: page.locator('[id*="criteria" i], [id*="field" i]') }).first();
  const critAlt = selectIn(page, 'Field');
  const critSel = (await crit.count()) ? crit : critAlt;
  if (await seen(critSel, 3000)) await pick(page, critSel, { type: 'outcomeId', enter: true });
  // value rule: Time Based (default) → Agent Time Field "processedAt", baseline 45, cost 40
  await a.segment(page, 'Time Based').catch(() => {});
  const tf = selectIn(page, 'Agent Time Field');
  if (await seen(tf, 3000)) await pick(page, tf, { type: 'processedAt', enter: true });
  await fillLast(page, '#outcomes_0_pricingModels_0_baseline', '45');
  await fillLast(page, '#outcomes_0_pricingModels_0_cost', '40');
  await click(page, 'Save outcomes');
  await a.toast(page, 10000).catch(() => '');
  return 'outcome task_completed (time based 45/40)';
}

// ---------- price list items ----------
async function methodCard(page, method) {
  const card = page.locator('button:visible, [role=button]:visible, div.cursor-pointer:visible').filter({ hasText: new RegExp(`^\\s*${esc(method)}\\b`, 'i') }).first();
  await card.waitFor({ state: 'visible', timeout: a.to(15000) });
  await card.click();
  await waitIdle(page, 700);
}
async function priceForm(run, method, { name, start, saveText = 'Save price' }) {
  const { page } = run;
  await fillLast(page, '#name', name);
  await pick(page, selectIn(page, 'Transaction Unit'), { match: 'Currency' }).catch(() => {});
  if (method === 'Consumption') await a.segment(page, 'Attribute Based');
  if (method === 'Margin') {
    await a.segment(page, 'Percentage').catch(() => {});
    const mv = inputIn(page, 'Margin Value'); await mv.fill('25');
  } else {
    await a.priceUom(page, 'Each');
    if (start !== undefined) { const sp = inputIn(page, 'Start Price'); if (await seen(sp, 2000)) await sp.fill(String(start)); }
  }
  await click(page, saveText);
  await a.toast(page, 10000).catch(() => '');
}
async function matrix(run, { attribute } = {}) {
  const { page } = run;
  if (attribute) {
    const at = page.locator('.ant-select:visible').filter({ hasText: /Select attributes/i }).first();
    if (await seen(at, 5000)) { await pick(page, at, run.data.attribute ? { match: run.data.attribute } : {}).catch(() => pick(page, at)); await page.keyboard.press('Escape'); }
  }
  await click(page, 'Create Agent Matrix');
  const price = page.locator('input[placeholder*="Enter price" i]:visible').last();
  await price.waitFor({ state: 'visible', timeout: a.to(15000) });
  await price.fill('5');
  const row = price.locator('xpath=ancestor::*[.//div[contains(@class,"ant-select")]][1]');
  const v = await pick(page, row.locator('.ant-select').last());
  await click(page, 'Save Entries');
  await a.toast(page, 10000).catch(() => '');
  return v;
}

async function simple(run) {
  const { page } = run;
  const name = nameFor(run, 'products.agentSimple', 'AT Simple Agent');
  const code = `AGT-S-${run.tag}`;
  await identify(run, 'simple', name, code);
  const out = await outcomes(run);
  await click(page, 'With pricing');
  const plis = [];
  await methodCard(page, 'One Time'); await priceForm(run, 'One Time', { name: `One Time ${run.tag}`, start: 99 }); plis.push('One Time $99');
  await methodCard(page, 'Subscription'); await priceForm(run, 'Subscription', { name: `Subscription ${run.tag}`, start: 149 }); plis.push('Subscription $149/mo');
  await methodCard(page, 'Consumption'); await priceForm(run, 'Consumption', { name: `Consumption ${run.tag}` });
  const val = await matrix(run); plis.push(`Consumption attribute-based ($5 · ${val})`);
  await methodCard(page, 'Margin'); await priceForm(run, 'Margin', { name: `Margin ${run.tag}` }); plis.push('Margin 25%');
  // agent actions: skip for the simple agent
  if (await seen(page.locator('button:visible').filter({ hasText: /Skip for now/i }).first(), a.to(8000))) await click(page, 'Skip for now');
  await click(page, 'Publish', { timeout: 30000 });
  await page.waitForURL(u => /\/dashboard\/agents\/?(\?.*)?$/.test(String(u)), { timeout: a.to(30000) }).catch(() => {});
  run.data.products = run.data.products || {};
  run.data.products.agentSimple = { name, code, published: true };
  return `${name} [${code}] · ${out} · PLIs: ${plis.join(', ')} · actions skipped · PUBLISHED`;
}

async function workflow(run) {
  const { page } = run;
  const name = nameFor(run, 'products.agentWorkflow', 'AT Workflow Agent');
  const code = `AGT-W-${run.tag}`;
  await identify(run, 'workflow', name, code);
  // price: without pricing (offerings carry the real price)
  await click(page, 'Without pricing');
  await click(page, 'Save price');
  await a.toast(page, 10000).catch(() => '');
  // sub-agent (agent action) with a consumption, attribute-based price
  await click(page, 'Add sub-agent');
  await fillLast(page, '#name', `AT Action ${run.tag}`);
  await fillLast(page, '#productCode', `ACT-${run.tag}`);
  await click(page, 'Continue');
  await a.toast(page, 10000).catch(() => '');
  await click(page, 'With pricing');
  await methodCard(page, 'Consumption');
  await priceForm(run, 'Consumption', { name: `Action usage ${run.tag}`, saveText: 'Create sub-agent' });
  const val = await matrix(run, { attribute: true });
  await click(page, 'Done');
  // outcomes
  const out = await outcomes(run);
  // offering with a subscription price; include the sub-agent
  await click(page, 'Add offering');
  await fillLast(page, '#name', `AT Offering ${run.tag}`);
  await fillLast(page, '#productCode', `OFF-${run.tag}`);
  await click(page, 'Continue');
  await a.toast(page, 10000).catch(() => '');
  await click(page, 'With pricing');
  await methodCard(page, 'Subscription');
  await priceForm(run, 'Subscription', { name: `Offering plan ${run.tag}`, start: 1500, saveText: 'Create offering' });
  const inc = page.locator('button:visible').filter({ hasText: /^\s*Included\s*$/ });
  await inc.first().waitFor({ state: 'visible', timeout: a.to(15000) });
  for (let i = 0, n = await inc.count(); i < n; i++) await inc.nth(i).click();
  await click(page, 'Save', { exact: true });
  await a.toast(page, 10000).catch(() => '');
  await click(page, 'Publish', { timeout: 30000 });
  await page.waitForURL(u => /\/dashboard\/agents\/?(\?.*)?$/.test(String(u)), { timeout: a.to(30000) }).catch(() => {});
  run.data.products = run.data.products || {};
  run.data.products.agentWorkflow = { name, code, published: true };
  return `${name} [${code}] · sub-agent ACT-${run.tag} (consumption matrix $5 · ${val}) · ${out} · offering OFF-${run.tag} $1500/mo (included) · PUBLISHED`;
}

module.exports = { simple, workflow };
