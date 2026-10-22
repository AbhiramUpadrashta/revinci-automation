// Admin setup: currency, exchange rate, UOM, attribute, attribute group, price profile,
// cost profile and customer account — the foundations every product and order depends on.
const a = require('../ant');
const { waitIdle } = require('../ui');

const title = 'Admin setup';
const OPTIONS = [
  { id: 'currency', label: 'Currency' },
  { id: 'exchangeRate', label: 'Currency exchange rate' },
  { id: 'uom', label: 'Unit of measure' },
  { id: 'attribute', label: 'Attribute (PickList)' },
  { id: 'attributeGroup', label: 'Attribute group' },
  { id: 'priceProfile', label: 'Price profile' },
  { id: 'costProfile', label: 'Cost profile' },
  { id: 'account', label: 'Customer account' },
];

const PREFERRED_CURRENCIES = ['GBP', 'AUD', 'CAD', 'SGD', 'JPY', 'AED', 'CHF', 'NZD', 'ZAR', 'SEK', 'NOK', 'DKK', 'HKD', 'MXN', 'BRL'];

// Name typed in the panel for this option (mandatory there) + the run tag so every run is unique.
function nameFor(run, key, fallback) {
  const n = (run.cfg.names && run.cfg.names[key] || '').trim() || fallback;
  return `${n} ${run.tag}`;
}

async function go(run, path) {
  await run.page.goto(new URL(path, run.origin).toString(), { waitUntil: 'domcontentloaded' });
  await waitIdle(run.page, 1200);
}

const steps = {
  async currency(run) {
    const { page } = run;
    await go(run, '/dashboard/metabench/currency');
    const existing = (await page.locator('.ant-table-tbody tr, [role=row]').allInnerTexts()).join(' ');
    const iso = PREFERRED_CURRENCIES.find(c => !new RegExp(`\\b${c}\\b`).test(existing));
    if (!iso) return 'all candidate currencies already exist — skipped';
    await a.button(page, 'Currency');
    await a.select(page, 'Currency', iso, { optional: true }) || await a.selectFirst(page, 'Currency');
    await a.fill(page, 'Currency Display Name', `${iso} ${run.tag}`, { id: 'currencyDisplayName' });
    await a.button(page, 'Add Currency');
    const msg = await a.toast(page);
    run.data.currency = iso;
    return `${iso} added ${msg}`;
  },

  async exchangeRate(run) {
    const { page } = run;
    await go(run, '/dashboard/metabench/currencyExchangeRate');
    await a.button(page, 'Currency Exchange Rate');
    const base = await page.locator('.ant-form-item').filter({ hasText: 'Base Currency' }).locator('.ant-select-selection-item').innerText().catch(() => '');
    if (!base.trim()) await a.select(page, 'Base Currency Iso Code', 'USD', { optional: true });
    const target = run.data.currency || 'INR';
    await a.select(page, 'Target Currency Iso Code', target, { optional: true }) || await a.selectFirst(page, 'Target Currency Iso Code', { avoid: ['USD'] });
    await a.fill(page, 'Exchange Rate', target === 'INR' ? '83.25' : '1.35');
    await a.select(page, 'Rate Type', 'Spot', { optional: true }) || await a.selectFirst(page, 'Rate Type');
    const now = new Date(); const end = new Date(); end.setMonth(end.getMonth() + 2);
    await a.dateRange(page, 'Effective Date Range', now, end);
    await a.fill(page, 'Source', `automation ${run.tag}`, { id: 'source' });
    await a.button(page, 'Save');
    return `USD→${target} ${await a.toast(page)}`;
  },

  async uom(run) {
    const { page } = run;
    await go(run, '/dashboard/setup/uom');
    await a.button(page, 'Unit Of Measure');
    const name = `AT Per Token ${run.tag}`;
    await a.fill(page, 'Name', name, { id: 'name' });
    const fam = await a.select(page, 'UOM Family', 'Time', { optional: true }) || await a.selectFirst(page, 'UOM Family');
    await a.fill(page, 'Measure UOM', 'token', { id: 'measureUoM' });
    await a.button(page, 'Create');
    await a.toast(page);
    run.data.uom = name;
    return `${name} (${fam})`;
  },

  async attribute(run) {
    const { page } = run;
    await go(run, '/dashboard/setup/attribute');
    await a.button(page, 'Attribute');
    const name = `AT Region ${run.tag}`;
    await a.fill(page, 'Name', name, { id: 'name' });
    await a.fill(page, 'Description', 'Created by Revinci automation', { id: 'description' });
    await a.select(page, 'Attribute Type', 'PickList');
    await a.select(page, 'Attribute Value Type', 'String', { optional: true }) || await a.selectFirst(page, 'Attribute Value Type');
    await a.tags(page, 'Attribute Values (type and enter)', ['North', 'South', 'East']);
    await a.select(page, 'Default Value', 'North', { optional: true });
    await a.button(page, 'Save');
    await a.toast(page);
    run.data.attribute = name;
    return name;
  },

  async attributeGroup(run) {
    const { page } = run;
    await go(run, '/dashboard/setup/attributeGroup');
    await a.button(page, 'Attribute Group');
    const name = `AT-AG ${run.tag}`;
    await a.fill(page, 'Name', name, { id: 'name' });
    await a.button(page, 'Add Attribute');
    // the new attribute row/modal exposes an attribute picker
    const attr = run.data.attribute;
    const picker = page.locator('.ant-modal:visible .ant-select, .ant-table:visible .ant-select, .ant-form-item:visible:has-text("Attribute") .ant-select').last();
    await picker.locator('.ant-select-selector').click();
    const search = picker.locator('input.ant-select-selection-search-input');
    if (attr) await search.fill(attr);
    await page.waitForTimeout(700);
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first().click();
    await page.keyboard.press('Escape');
    await a.buttonAny(page, ['Add', 'OK', 'Confirm'], 1500);
    await a.button(page, 'Save');
    await a.toast(page);
    run.data.attributeGroup = name;
    return name;
  },

  async priceProfile(run) { return profile(run, 'priceProfile', 'Price Profile'); },
  async costProfile(run) { return profile(run, 'costProfile', 'Cost Profile'); },

  // Accounts screen → "Account" → form (/dashboard/crm/account/form) → Save → back on the list.
  async account(run) {
    const { page } = run;
    await go(run, '/dashboard/crm/account');
    await a.button(page, 'Account');
    await page.locator('#name').waitFor({ state: 'visible', timeout: a.to(20000) });
    const name = nameFor(run, 'admin.account', 'AT Customer');
    await a.fill(page, 'Name', name, { id: 'name' });
    await a.fill(page, 'Account Number', `ACC-${run.tag}`, { id: 'accountNumber' });
    await a.fill(page, 'Annual Revenue', '1200000', { id: 'annualRevenue' }).catch(() => {});
    await a.fill(page, 'Employees Count', '120', { id: 'employeesCount' }).catch(() => {});
    await a.select(page, 'Type', 'Customer', { optional: true }) || await a.selectFirst(page, 'Type').catch(() => {});
    await a.selectFirst(page, 'Industry').catch(() => {});
    await a.fill(page, 'Account Website', 'automation.example', { id: 'accountWebsite' }).catch(() => {});
    await a.button(page, 'Save');
    const msg = await a.toast(page);
    await page.waitForURL(u => !/\/form/.test(String(u)), { timeout: a.to(15000) }).catch(() => {});
    run.data.account = name;
    return `${name} · ${msg.replace(/\s+/g, ' ')}`;
  },
};

async function profile(run, route, label) {
  const { page } = run;
  await go(run, `/dashboard/setup/${route}`);
  await a.button(page, label);
  const name = `AT ${label} ${run.tag}`;
  await a.fill(page, 'Name', name, { id: 'name' });
  const scope = await a.select(page, 'Scope', 'Organization', { optional: true }) || await a.selectFirst(page, 'Scope');
  await a.button(page, 'Create');
  await a.toast(page).catch(() => '');
  await waitIdle(page, 1200);
  // cost/price profile opens a Draft canvas — publish it when the button is available
  const pub = await a.buttonAny(page, ['Publish'], 4000);
  if (pub) await a.buttonAny(page, ['Yes', 'Confirm', 'OK', 'Publish'], 3000);
  run.data[route] = name;
  return `${name} (${scope})${pub ? ' · published' : ' · draft'}`;
}

async function run(r, picks) {
  for (const o of OPTIONS) {
    if (!picks.includes(o.id)) continue;
    await r.step(`Admin · ${o.label}`, () => steps[o.id](r));
  }
}

module.exports = { title, OPTIONS, run, go, nameFor };
