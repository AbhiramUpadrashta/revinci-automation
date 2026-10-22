// Quote to cash: quote (bag, finalize, lifecycle) → order (bag, finalize) → entitlement
// (activate, map external plan ID) → usage event against the plan.
const a = require('../ant');
const { waitIdle } = require('../ui');
const { go } = require('./admin');
const http = require('../http');

const title = 'Quote · Order · Entitlement';
const OPTIONS = [
  { id: 'quote', label: 'Create quote, add to bag, finalize & move through lifecycle' },
  { id: 'order', label: 'Create order, add to bag & finalize' },
  { id: 'entitlement', label: 'Activate entitlement & map external plan ID' },
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
  const name = `AT Quote ${run.tag}`;
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

async function order(run) {
  const { page } = run;
  await go(run, '/dashboard/orders/new');
  const name = `AT Order ${run.tag}`;
  const number = `ORD-${run.tag}`;
  const acct = await pickAccount(page, run, 'Account');
  await a.fill(page, 'Name', name, { id: 'name' });
  await a.fill(page, 'Number', number, { id: 'quoteNumber' });
  await a.fill(page, 'Description', 'Created by Revinci Test Automation', { id: 'description' });
  const start = new Date();
  await a.date(page, 'startDate', start);
  const ppd = new Date(); ppd.setMonth(ppd.getMonth() + 6);
  await a.date(page, 'priceProtectionDate', ppd).catch(() => {});
  await a.select(page, 'Billing Frequency', 'Monthly', { optional: true }) || await a.selectFirst(page, 'Billing Frequency');
  await a.segment(page, '30 Days');
  await a.select(page, 'Currency', 'USD', { optional: true }) || await a.selectFirst(page, 'Currency');
  await a.select(page, 'Rate Type', 'Budgeted', { optional: true }) || await a.selectFirst(page, 'Rate Type');
  await a.button(page, 'Continue');
  await a.toast(page).catch(() => '');
  await waitIdle(page, 2500);
  run.data.order = { name, number, account: acct, url: page.url() };
  const item = await addToBag(run, productToSell(run));
  const fin = await a.buttonAny(page, ['Finalize', 'Finalize Order'], 8000);
  if (!fin) throw new Error('Finalize button not found on the order bag');
  await a.buttonAny(page, ['Yes', 'Confirm', 'OK', 'Finalize'], 3000);
  await a.toast(page).catch(() => '');
  return `${name} (${number}) · ${acct} · ${item} · finalized`;
}

async function findEntitlement(run) {
  const target = run.data.order?.name || run.data.quote?.name;
  for (let i = 0; i < 10; i++) {
    const res = await http.call(run, 'GET', '/revenue-management/api/v1/revenue-entitlements?page=0&size=50&sort=createdDate,desc', null, { auth: 'session' });
    const list = http.items(res.body);
    const hit = list.find(e => target && JSON.stringify(e).includes(target)) || (target ? null : list[0]);
    if (hit) return hit;
    await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

async function entitlement(run) {
  const { page } = run;
  const ent = await findEntitlement(run);
  if (!ent) throw new Error(`No entitlement found for ${run.data.order?.name || 'the order'} — finalize the order first`);
  run.data.entitlement = { id: ent.id, name: ent.name, status: ent.status };
  await go(run, `/dashboard/revenueEntitlement/${ent.id}`);
  if (!(await a.hasButton(page, 'Activate', 4000))) {
    await go(run, '/dashboard/revenueEntitlement');
    await page.getByText(ent.name).first().click();
    await waitIdle(page, 2000);
  }
  let activated = false;
  if (await a.buttonAny(page, ['Activate'], 6000)) {
    const picker = page.locator('.ant-modal:visible .ant-picker input').first();
    if (await picker.count()) { await picker.click(); await picker.fill(a.fmt(new Date())); await picker.press('Enter'); }
    await a.buttonAny(page, ['Confirm', 'Activate', 'Yes', 'OK'], 4000);
    await a.toast(page).catch(() => '');
    activated = true;
  }
  const ext = `WT-${run.tag}`;
  let mapped = false;
  const kebab = page.locator('button:has(.anticon-more), button:has(.anticon-ellipsis), [aria-label*="more" i]').first();
  if (await kebab.count()) {
    await kebab.click();
    const m = page.getByText(/map external id/i).first();
    if (await m.isVisible().catch(() => false)) {
      await m.click();
      const inp = page.locator('.ant-modal:visible input[type=text], .ant-modal:visible input:not([type])').first();
      await inp.fill(ext);
      await a.buttonAny(page, ['Save', 'Map', 'Confirm', 'OK'], 3000);
      await a.toast(page).catch(() => '');
      mapped = true;
    } else await page.keyboard.press('Escape');
  }
  run.data.entitlement.externalPlanId = mapped ? ext : null;
  const after = await http.call(run, 'GET', `/revenue-management/api/v1/revenue-entitlements/${ent.id}`, null, { auth: 'session' });
  const status = after.body?.status || '?';
  const plans = await http.call(run, 'GET', `/revenue-management/api/v1/plans/entitlement/${ent.id}`, null, { auth: 'session' });
  const planList = http.items(plans.body);
  run.data.entitlement.status = status;
  run.data.entitlement.planNumber = planList[0]?.planNumber || planList[0]?.number || null;
  run.data.entitlement.planId = planList[0]?.id || null;
  return `${ent.name} · ${activated ? 'activated' : 'Activate button not shown'} · status ${status} · ${mapped ? 'external ID ' + ext : 'external ID not mapped'} · ${planList.length} plan(s)`;
}

async function usage(run) {
  const plan = run.data.entitlement?.externalPlanId || run.data.entitlement?.planNumber || run.cfg.planNumber;
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
