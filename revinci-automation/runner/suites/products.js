// Product setup: every product type on Setup ▸ Product ▸ Create Product, plus option groups and agents.
// Step 1 (Product Information) is identical for all types and fully mapped; the later wizard
// steps (pricing, linking, offerings, publish) are driven adaptively by the wizard driver below.
const a = require('../ant');
const { waitIdle } = require('../ui');
const { go } = require('./admin');

const title = 'Product setup';
const OPTIONS = [
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

function code(run, id) { return `AT-${id.replace(/[a-z]/g, '').toUpperCase() || id.slice(0, 3).toUpperCase()}${id.length}-${run.tag}`; }

async function productInfo(run, o, { withAttributes = false } = {}) {
  const { page } = run;
  await go(run, `/dashboard/setup/product/new?type=${o.type}${o.query || ''}`);
  const name = `AT ${o.label.replace(/\s*\(.*\)/, '')} ${run.tag}`;
  const pcode = code(run, o.id);
  await a.fill(page, 'Name', name, { id: 'name' });
  await a.select(page, 'Product Code', pcode, { create: true });
  await a.fill(page, 'Description', `Created by Revinci automation (${o.label})`, { id: 'description' });
  if (await page.locator('.ant-switch:visible').count()) await a.switchOn(page, null, withAttributes).catch(() => {});
  await a.select(page, '#tag', 'automation', { create: true, multi: true }).catch(() => {});
  if (o.type === 'AGENT_ACTION' && run.data.costProfile) await a.select(page, 'Cost Profile', run.data.costProfile, { optional: true }).catch(() => {});
  await a.button(page, 'Create Product');
  await a.toast(page).catch(() => '');
  await waitIdle(page, 1500);
  return { name, code: pcode, url: page.url() };
}

// Attach attribute group when the product was created with attributes = Yes.
async function attachAttributes(run) {
  const { page } = run;
  if (!run.data.attributeGroup) return false;
  const search = page.locator('input[placeholder*="search" i]:visible').first();
  if (await search.count()) await search.fill(run.data.attributeGroup);
  await page.getByText(run.data.attributeGroup, { exact: false }).first().click();
  await a.buttonAny(page, ['»', '>>', 'Add'], 3000);
  await a.buttonAny(page, ['Save'], 3000);
  return true;
}

// Pricing step: "Do you want to set a price?" → With pricing → method → PLI form → save.
async function price(run, method, amount) {
  const { page } = run;
  if (!(await page.getByText(/with pricing/i).first().isVisible().catch(() => false))) return 'no pricing step on this screen';
  await page.getByText(/^\s*with pricing\s*$/i).first().click();
  await page.waitForTimeout(500);
  await page.getByText(new RegExp(`^\\s*${method}\\s*$`, 'i')).first().click();
  await page.waitForTimeout(800);
  const nameEmpty = await a.item(page, 'Name').locator('input').inputValue().catch(() => 'x');
  if (!nameEmpty) await a.fill(page, 'Name', `${method} ${run.tag}`);
  await a.select(page, 'Transaction Unit', 'Currency', { optional: true }).catch(() => {});
  await a.checkbox(page, 'I Want to Set Price', true).catch(() => {});
  await a.select(page, 'Selling Model', method === 'One Time' ? 'One Time' : 'Recurring', { optional: true }).catch(() => {});
  await a.select(page, 'Selling Frequency', 'Monthly', { optional: true }).catch(() => {});
  await a.select(page, 'Price UOM', run.data.uom || 'Each', { optional: true }).catch(() => a.selectFirst(page, 'Price UOM').catch(() => {}));
  await a.fill(page, 'Start Price', String(amount)).catch(() => {});
  await page.getByText(/^\s*flat\s*$/i).first().click().catch(() => {});
  if (method === 'Consumption') {
    await a.fill(page, 'Outcome ID', 'task_completed').catch(() => {});
    await a.fill(page, 'Price', String(amount)).catch(() => {});
  }
  const saved = await a.buttonAny(page, ['Save Price Methods', 'Save Price Method', 'Save', 'Add'], 5000);
  await a.toast(page, 8000).catch(() => '');
  return `${method} $${amount}${saved ? '' : ' (no save button found)'}`;
}

// Drive the remaining wizard steps until Publish (or nothing left to click).
async function finishWizard(run, extra = {}) {
  const { page } = run;
  const trail = [];
  for (let i = 0; i < 12; i++) {
    if (extra.onStep) { const r = await extra.onStep(trail).catch(e => `onStep: ${e.message}`); if (r) trail.push(r); }
    const clicked = await a.buttonAny(page, ['Publish', 'Skip', 'Save & Next', 'Save and Next', 'Next', 'Continue', 'Review & Publish', 'Save details'], 3000);
    if (!clicked) break;
    trail.push(clicked);
    await waitIdle(page, 1000);
    if (clicked === 'Publish') { await a.buttonAny(page, ['Yes', 'Confirm', 'Publish', 'OK'], 2500); trail.push('published'); break; }
  }
  const published = /published/i.test(await page.locator('body').innerText());
  return { trail, published };
}

async function linkFromCatalog(run, names) {
  const { page } = run;
  if (!names.length) return null;
  if (!(await a.buttonAny(page, ['Reuse from the Catalog', 'Reuse from Catalog', 'Add Feature Offering', 'Add from Catalog'], 1500))) return null;
  for (const n of names) {
    const s = page.locator('.ant-modal:visible input[placeholder*="search" i], .ant-drawer:visible input[placeholder*="search" i]').first();
    if (await s.count()) { await s.fill(n); await page.waitForTimeout(800); }
    await page.locator('.ant-modal:visible, .ant-drawer:visible').getByText(n).first().click().catch(() => {});
    await page.locator('.ant-modal:visible .ant-checkbox-input, .ant-drawer:visible .ant-checkbox-input').first().check().catch(() => {});
  }
  await a.buttonAny(page, ['Add', 'Link', 'Save', 'Confirm', 'OK'], 3000);
  return `linked ${names.join(', ')}`;
}

async function createProduct(run, o) {
  const withAttr = o.id === 'standalone' && !!run.data.attributeGroup;
  const p = await productInfo(run, o, { withAttributes: withAttr });
  run.data.products = run.data.products || {};
  run.data.products[o.id] = p;
  run.log(`  created ${p.name} [${p.code}]`);
  let attrs = '';
  if (withAttr) attrs = await attachAttributes(run).then(ok => ok ? ' · attributes attached' : '').catch(e => ` · attributes: ${e.message}`);
  const priced = await price(run, o.price, o.amount).catch(e => `pricing failed: ${e.message}`);
  const linkNames = o.id === 'productWithFeatures' ? [run.data.products.feature?.name].filter(Boolean)
    : o.id === 'productWithOfferings' ? [run.data.products.featureOffering?.name].filter(Boolean)
    : o.id === 'featureOffering' ? [run.data.products.feature?.name].filter(Boolean) : [];
  const bundleGroups = o.id === 'bundle' && run.data.optionGroup ? run.data.optionGroup : null;
  let linked = false;
  const w = await finishWizard(run, {
    onStep: async () => {
      if (!linked && linkNames.length) { const r = await linkFromCatalog(run, linkNames); if (r) { linked = true; return r; } }
      if (!linked && bundleGroups && await a.hasButton(run.page, 'Add Option Group', 800)) {
        await a.button(run.page, 'Add Option Group');
        await run.page.getByText(bundleGroups).first().click();
        await a.buttonAny(run.page, ['Add', 'Save', 'OK'], 2500);
        linked = true; return `option group ${bundleGroups}`;
      }
      return null;
    },
  });
  p.published = w.published;
  return `${p.name}${attrs} · ${priced} · ${w.trail.join(' → ') || 'no further steps'}${w.published ? ' · PUBLISHED' : ''}`;
}

async function optionGroup(run) {
  const { page } = run;
  await go(run, '/dashboard/setup/optionGroup');
  await a.buttonAny(page, ['Option Group', 'Create', 'Create Option Group'], 8000);
  const name = `AT Options ${run.tag}`;
  await a.fill(page, 'Name', name, { id: 'name' });
  await a.select(page, 'Selection Type', 'Single select', { optional: true }) || await a.selectFirst(page, 'Selection Type').catch(() => {});
  const opt = run.data.products?.option?.name;
  if (opt && await a.buttonAny(page, ['Add Option'], 3000)) {
    const s = page.locator('.ant-modal:visible input, .ant-select:visible input.ant-select-selection-search-input').last();
    await s.fill(opt).catch(() => {});
    await page.waitForTimeout(800);
    await page.getByText(opt).last().click();
    await a.buttonAny(page, ['Add', 'OK', 'Confirm'], 2000);
    await page.locator('[aria-label*="star" i], .anticon-star').first().click().catch(() => {});
  }
  await a.button(page, 'Save');
  await a.toast(page).catch(() => '');
  run.data.optionGroup = name;
  return `${name}${opt ? ' with ' + opt : ' (no option product yet — create Option first)'}`;
}

async function agent(run, o) {
  const { page } = run;
  await go(run, `/dashboard/agents/new?mode=${o.mode}`);
  if (!/mode=/.test(page.url())) await a.button(page, o.mode === 'simple' ? 'Build a simple agent' : 'Build a workflow agent');
  const name = `AT ${o.mode === 'simple' ? 'Simple' : 'Workflow'} Agent ${run.tag}`;
  const acode = `AGT-${o.mode === 'simple' ? 'S' : 'W'}-${run.tag}`;
  await a.fill(page, 'Agent Name', name, { id: 'name' });
  await a.fill(page, 'Agent Code', acode, { id: 'productCode' });
  if (run.data.costProfile && await a.buttonAny(page, ['More fields (optional)'], 1500)) {
    await a.select(page, 'Cost Profile', run.data.costProfile, { optional: true }).catch(() => {});
  }
  await a.buttonAny(page, ['Save details', 'Save', 'Next'], 5000);
  await a.toast(page, 8000).catch(() => '');
  run.data.products = run.data.products || {};
  run.data.products[o.id] = { name, code: acode };
  let priced = '';
  const w = await finishWizard(run, {
    onStep: async () => {
      if (!priced && await page.getByText(/with pricing/i).first().isVisible().catch(() => false)) { priced = await price(run, o.price, o.amount); return priced; }
      return null;
    },
  });
  run.data.products[o.id].published = w.published;
  return `${name} [${acode}] · ${priced || 'no pricing'} · ${w.trail.join(' → ')}${w.published ? ' · PUBLISHED' : ''}`;
}

async function run(r, picks) {
  for (const o of OPTIONS) {
    if (!picks.includes(o.id)) continue;
    await r.step(`Product · ${o.label}`, () => o.special === 'optionGroup' ? optionGroup(r) : o.special === 'agent' ? agent(r, o) : createProduct(r, o));
  }
}

module.exports = { title, OPTIONS, run };
