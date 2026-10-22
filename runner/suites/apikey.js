// Settings ▸ API Keys. Revinci allows ONE active key and shows its secret only once, so:
//  1. a key this app stored earlier (matching the active key's prefix) is reused,
//  2. else a key pasted in the control panel is verified and stored,
//  3. else, if no active key exists, a new one is created in the UI and stored,
//  4. else, only when "Revoke & recreate" is ticked, the active key is revoked and a new one created.
const a = require('../ant');
const store = require('../store');
const { go } = require('./admin');
const http = require('../http');

const title = 'API key';
const OPTIONS = [{ id: 'ensure', label: 'Find or create API key' }];

async function listKeys(run) {
  const res = await http.call(run, 'GET', '/usage-ingestion/api/v1/usage/api-keys', null, { auth: 'session' });
  if (res.status !== 200) throw new Error(`List API keys → HTTP ${res.status}`);
  return Array.isArray(res.body) ? res.body : (res.body.content || []);
}

async function verify(run, key) {
  const res = await http.call(run, 'GET', '/crm/api/v1/accounts?page=0&size=1', null, { auth: 'key', key });
  return res.status === 200;
}

function save(run, rec) {
  store.setApiKey(run.cfg.baseUrl, rec);
  run.apiKey = rec.key;
  run.emit({ type: 'apikey', key: rec.key, name: rec.name, prefix: rec.prefix, source: rec.source });
}

async function createInUi(run) {
  const { page } = run;
  await go(run, '/dashboard/settings/apiKeys');
  await a.button(page, 'Create API Key');
  const dlg = page.locator('.ant-modal:visible, .ant-drawer:visible, [role=dialog]:visible').last();
  await dlg.waitFor({ timeout: 10000 });
  const name = `revinci-automation-${run.tag}`;
  const nameInput = dlg.locator('#name, input[placeholder*="name" i], input[type=text]').first();
  await nameInput.fill(name);
  const desc = dlg.locator('#description, textarea').first();
  if (await desc.count()) await desc.fill('Created by Revinci Test Automation');
  const sel = dlg.locator('.ant-select').first();
  if (await sel.count()) {
    await sel.locator('.ant-select-selector').click();
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').last().click().catch(() => {});
  }
  const picker = dlg.locator('.ant-picker input').first();
  if (await picker.count()) { const d = new Date(); d.setMonth(d.getMonth() + 6); await picker.click(); await picker.fill(a.fmt(d)); await picker.press('Enter'); }
  await a.buttonAny(page, ['Generate', 'Create', 'Create API Key', 'Save'], 5000);
  // the secret is displayed once — read it from text or an input
  let key = null;
  for (let i = 0; i < 20 && !key; i++) {
    await page.waitForTimeout(500);
    const txt = await page.locator('body').innerText();
    key = (txt.match(/rvc_[A-Za-z0-9_\-]{16,}/) || [])[0];
    if (!key) {
      const vals = await page.locator('input:visible, textarea:visible').evaluateAll(els => els.map(e => e.value));
      key = vals.find(v => /^rvc_/.test(v)) || null;
    }
  }
  if (!key) throw new Error('Key created but the secret could not be read from the dialog');
  await a.buttonAny(page, ['Done', 'Close', 'OK', 'I have copied it', 'Copy'], 2000);
  return { key, name };
}

async function revokeActive(run, active) {
  const { page } = run;
  await go(run, '/dashboard/settings/apiKeys');
  const row = page.locator('tr, [role=row], .ant-card, li').filter({ hasText: active.name }).first();
  await row.locator('button, [role=button]').filter({ hasText: /revoke/i }).first().click()
    .catch(async () => { await row.locator('button').last().click(); await page.getByText(/revoke/i).first().click(); });
  const reason = page.locator('.ant-modal:visible textarea, .ant-modal:visible input[type=text]').first();
  if (await reason.count()) await reason.fill('Rotated by Revinci Test Automation');
  await a.buttonAny(page, ['Revoke', 'Yes', 'Confirm', 'OK'], 5000);
  await page.waitForTimeout(1500);
}

async function ensure(run) {
  const keys = await listKeys(run);
  const active = keys.filter(k => k.isActive && !k.revokedAt);
  const stored = store.getApiKey(run.cfg.baseUrl);
  run.emit({ type: 'apikeys', list: keys.map(k => ({ name: k.name, prefix: k.keyPrefix, active: k.isActive, expiresAt: k.expiresAt, lastUsedAt: k.lastUsedAt })) });

  if (stored && active.some(k => stored.key.startsWith(k.keyPrefix)) && await verify(run, stored.key)) {
    save(run, { ...stored, source: 'stored' });
    return `reusing stored key ${stored.prefix || stored.key.slice(0, 16)}…`;
  }
  if (run.cfg.apiKey) {
    if (!(await verify(run, run.cfg.apiKey))) throw new Error('Pasted API key was rejected by the API');
    const k = active.find(x => run.cfg.apiKey.startsWith(x.keyPrefix));
    save(run, { key: run.cfg.apiKey, name: k?.name || 'pasted', prefix: k?.keyPrefix, source: 'pasted' });
    return `pasted key verified${k ? ' (' + k.name + ')' : ''}`;
  }
  if (active.length && !run.cfg.rotateKey) {
    throw new Error(`Active key "${active[0].name}" (${active[0].keyPrefix}…) exists but its secret isn't stored here. Paste it in the panel, or tick "Revoke & recreate".`);
  }
  if (active.length && run.cfg.rotateKey) { await revokeActive(run, active[0]); run.log(`Revoked ${active[0].name}`, 'warn'); }
  const created = await createInUi(run);
  const ok = await verify(run, created.key);
  save(run, { ...created, prefix: created.key.slice(0, 20), source: 'created' });
  return `created ${created.name}${ok ? ' · verified' : ' · NOT accepted by accounts API'}`;
}

async function run(r, picks) {
  if (picks.includes('ensure')) await r.step('API key · find or create', () => ensure(r));
}

module.exports = { title, OPTIONS, run };
