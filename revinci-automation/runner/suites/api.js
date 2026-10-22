// API testing from https://docs.revinci.ai/#api-endpoints.
// Uses the stored/created API key (Authorization: Bearer + Tenant-Id); falls back to the
// logged-in session token when no key is available, and says so in each result.
const http = require('../http');

const title = 'API testing';
const OPTIONS = [
  { id: 'auth', label: 'Auth & headers (positive + negative)' },
  { id: 'accounts', label: 'Accounts — list, get, create' },
  { id: 'entitlements', label: 'Entitlements, plans, rating & usage summaries' },
  { id: 'wallets', label: 'Wallets — create, carryover, consumption rules, activate, top-up, transactions' },
  { id: 'usage', label: 'Usage ingestion — single & bulk' },
];

const mode = r => (r.apiKey ? 'key' : 'session');
const call = (r, m, p, b, o = {}) => http.call(r, m, p, b, { auth: mode(r), ...o });

function expect(res, codes, what) {
  const ok = [].concat(codes).includes(res.status);
  if (!ok) throw new Error(`${what}: expected ${[].concat(codes).join('/')} got ${res.status} ${String(res.text || '').slice(0, 140)}`);
  return res;
}

const T = {
  async auth(r) {
    await r.step('API · smoke: list accounts (200)', async () => { const x = expect(await call(r, 'GET', '/crm/api/v1/accounts?page=0&size=5'), 200, 'list'); return `${http.items(x.body).length} rows · auth=${mode(r)}`; });
    await r.step('API · missing Authorization → 401/403', async () => {
      const url = http.apiBase(r) + '/crm/api/v1/accounts?page=0&size=1';
      const res = await fetch(url, { headers: { 'Tenant-Id': r.tenantId } });
      if (![401, 403].includes(res.status)) throw new Error(`expected 401/403 got ${res.status}`);
      return `HTTP ${res.status}`;
    });
    await r.step('API · invalid key → 401/403', async () => { const x = await http.call(r, 'GET', '/crm/api/v1/accounts?page=0&size=1', null, { auth: 'key', key: 'rvc_invalid_automation_key' }); expect(x, [401, 403], 'invalid key'); return `HTTP ${x.status}`; });
  },

  async accounts(r) {
    let id;
    await r.step('API · GET /crm/api/v1/accounts', async () => { const x = expect(await call(r, 'GET', '/crm/api/v1/accounts?page=0&size=20'), 200, 'list'); const l = http.items(x.body); id = l[0]?.id; return `${l.length} accounts`; });
    await r.step('API · POST /crm/api/v1/accounts', async () => {
      const body = { name: `AT API Account ${r.tag}`, accountNumber: `API-${r.tag}`, annualRevenue: 1200, employeesCount: 120, businessActivities: 'API automation', type: 'customer', jurisdiction: 'INDIA', industry: 'banking', accountSource: 'CRM', accountWebsite: 'automation.example', tags: [] };
      const x = expect(await call(r, 'POST', '/crm/api/v1/accounts', body), [200, 201], 'create');
      id = x.body?.id || id; r.data.apiAccountId = x.body?.id;
      return `id ${x.body?.id}`;
    });
    await r.step('API · GET /crm/api/v1/accounts/{id}', async () => { if (!id) throw new Error('no account id'); const x = expect(await call(r, 'GET', `/crm/api/v1/accounts/${id}`), 200, 'get'); return x.body?.name; });
    await r.step('API · POST account without name → 4xx', async () => { const x = await call(r, 'POST', '/crm/api/v1/accounts', { accountNumber: `BAD-${r.tag}` }); if (x.status < 400) throw new Error(`accepted invalid payload (${x.status})`); return `HTTP ${x.status}`; });
  },

  async entitlements(r) {
    let ent = r.data.entitlement?.id, plan = r.data.entitlement?.planId, planNumber = r.data.entitlement?.planNumber, rm;
    await r.step('API · GET revenue-entitlements', async () => { const x = expect(await call(r, 'GET', '/revenue-management/api/v1/revenue-entitlements'), 200, 'list'); const l = http.items(x.body); ent = ent || l.find(e => /activ/i.test(e.status))?.id || l[0]?.id; return `${l.length} entitlements`; });
    await r.step('API · GET revenue-entitlements/{id}', async () => { if (!ent) throw new Error('no entitlement'); const x = expect(await call(r, 'GET', `/revenue-management/api/v1/revenue-entitlements/${ent}`), 200, 'get'); return `${x.body?.name} · ${x.body?.status}`; });
    await r.step('API · GET plans/entitlement/{id}', async () => { const x = expect(await call(r, 'GET', `/revenue-management/api/v1/plans/entitlement/${ent}`), 200, 'plans'); const l = http.items(x.body); plan = plan || l[0]?.id; planNumber = planNumber || l[0]?.planNumber; return `${l.length} plans`; });
    await r.step('API · GET plans/{planId}', async () => { if (!plan) throw new Error('no plan'); const x = expect(await call(r, 'GET', `/revenue-management/api/v1/plans/${plan}`), 200, 'plan'); planNumber = planNumber || x.body?.planNumber; return x.body?.planNumber || 'ok'; });
    await r.step('API · GET plan-order-transactions', async () => { const x = expect(await call(r, 'GET', `/revenue-management/api/v1/plan-order-transactions/revenue-entitlement/${ent}`), 200, 'txns'); return `${http.items(x.body).length} transactions`; });
    await r.step('API · GET plan-rate-matrices', async () => { const x = expect(await call(r, 'GET', `/revenue-management/api/v1/plan-rate-matrices/plan?planId=${plan}`), 200, 'rate matrix'); const l = http.items(x.body); rm = l[0]?.id || x.body?.id; return `${l.length || (x.body ? 1 : 0)} matrices`; });
    await r.step('API · GET plan-rate-matrix-entries', async () => { if (!rm) return 'no rate matrix on this plan — skipped'; const x = expect(await call(r, 'GET', `/revenue-management/api/v1/plan-rate-matrix-entries/rate-matrix?rateMatrixId=${rm}`), 200, 'entries'); return `${http.items(x.body).length} entries`; });
    await r.step('API · GET usage-summaries', async () => { const x = expect(await call(r, 'GET', `/revenue-management/api/v1/usage-summaries?scopeNumber=${encodeURIComponent(planNumber || '')}`), 200, 'summaries'); return `${http.items(x.body).length} summaries`; });
    await r.step('API · GET entitlement with bad id → 4xx', async () => { const x = await call(r, 'GET', '/revenue-management/api/v1/revenue-entitlements/00000000-0000-0000-0000-000000000000'); if (x.status < 400) throw new Error(`returned ${x.status}`); return `HTTP ${x.status}`; });
    r.data.api = { ...(r.data.api || {}), entitlementId: ent, planId: plan, planNumber };
  },

  async wallets(r) {
    const acct = r.data.apiAccountId || (http.items((await call(r, 'GET', '/crm/api/v1/accounts?page=0&size=1')).body)[0] || {}).id;
    let wallet, carry, rule;
    await r.step('API · POST /crm/api/v1/wallets', async () => {
      const body = { name: `AT Wallet ${r.tag}`, accountId: acct, transactionUnit: 'CREDIT', balance: 3000, status: 'Draft', carryOver: true, topupAllowed: true, allowNegativeBalance: false, expirationLogic: 365 };
      const x = expect(await call(r, 'POST', '/crm/api/v1/wallets', body), [200, 201], 'create wallet');
      wallet = x.body?.id; r.data.walletId = wallet; return `wallet ${wallet}`;
    });
    await r.step('API · GET wallets/account/{accountId}', async () => { const x = expect(await call(r, 'GET', `/crm/api/v1/wallets/account/${acct}`), 200, 'by account'); return `${http.items(x.body).length || 1} wallet(s)`; });
    await r.step('API · POST carry-over-rules', async () => { const x = expect(await call(r, 'POST', '/crm/api/v1/wallets/carry-over-rules', { walletId: wallet, carryOverFrequency: 'wallet_end_date', carryOverPercentage: 20, carryOverMaxAmount: '', isActive: true }), [200, 201], 'carryover'); carry = x.body?.id; return `rule ${carry}`; });
    await r.step('API · GET carry-over-rules/wallet/{id}', async () => { expect(await call(r, 'GET', `/crm/api/v1/wallets/carry-over-rules/wallet/${wallet}`), 200, 'get carryover'); return 'ok'; });
    await r.step('API · PUT carry-over-rules/{id}', async () => { if (!carry) return 'no rule id returned — skipped'; expect(await call(r, 'PUT', `/crm/api/v1/wallets/carry-over-rules/${carry}`, { walletId: wallet, carryOverFrequency: 'wallet_end_date', carryOverPercentage: 25, carryOverMaxAmount: 500, isActive: true }), 200, 'update carryover'); return '25% cap 500'; });
    await r.step('API · POST consumption-rules (consumption)', async () => {
      const now = Date.now();
      const x = expect(await call(r, 'POST', '/crm/api/v1/consumption-rules', { transactionUnit: 'CURRENCY', currencyIsoCode: 'USD', totalCredit: 3000, validFrom: now, validTo: now + 365 * 864e5, type: 'discrete', price: 200, scope: 'wallet', allocation: 0, balance: 0, scopeValue: wallet, condition: 'consumption' }), [200, 201], 'consumption rule');
      rule = x.body?.id; return `rule ${rule}`;
    });
    await r.step('API · GET consumption-rules/scope', async () => { const x = expect(await call(r, 'GET', `/crm/api/v1/consumption-rules/scope?scope=wallet&scopeValue=${wallet}`), 200, 'rules'); return `${http.items(x.body).length || 1} rule(s)`; });
    await r.step('API · GET wallets/activate/{id}', async () => { const x = await call(r, 'GET', `/crm/api/v1/wallets/activate/${wallet}`); expect(x, [200, 201, 400, 422], 'activate'); return x.status < 300 ? `status ${x.body?.status || 'ACTIVE'}` : `rejected as expected without 100% allocation (${x.status})`; });
    await r.step('API · POST wallets/top-up', async () => { const x = await call(r, 'POST', '/crm/api/v1/wallets/top-up', { id: wallet, amount: 100 }); expect(x, [200, 201, 400, 422], 'top-up'); return `HTTP ${x.status}`; });
    await r.step('API · GET wallet-transactions/wallet/{id}', async () => { const x = expect(await call(r, 'GET', `/crm/api/v1/wallet-transactions/wallet/${wallet}`), 200, 'transactions'); return `${http.items(x.body).length} transactions`; });
    await r.step('API · DELETE carry-over-rules/{id}', async () => { if (!carry) return 'skipped'; expect(await call(r, 'DELETE', `/crm/api/v1/wallets/carry-over-rules/${carry}`), [200, 204], 'delete carryover'); return 'deleted'; });
  },

  async usage(r) {
    const plan = r.data.entitlement?.externalPlanId || r.data.api?.planNumber || r.data.entitlement?.planNumber || r.cfg.planNumber;
    const ev = (i = 0) => ({ provider: 'openai', planNumber: plan || 'NO-PLAN', customerId: 'automation@revinci.ai', externalAccountId: `ACC-${r.tag}`,
      apiResponse: { id: `chatcmpl_${r.tag}_${Date.now()}_${i}`, model: 'gpt-4o', usage: { input_tokens: 1000 + i, output_tokens: 500, cache_read_input_tokens: 0 } },
      metadata: { session_id: `sess-${r.tag}`, agent_name: 'revinci-automation', outcome_id: 'task_completed', source_platform: 'revinci_automation' }, eventTimestamp: Date.now() });
    await r.step('API · POST usage/ingest', async () => { const x = expect(await call(r, 'POST', '/usage-ingestion/api/v1/usage/ingest', ev()), [200, 201, 202], 'ingest'); return `${x.body?.status || x.status} · plan ${plan || '(none)'}`; });
    await r.step('API · POST usage/ingest/bulk (5 events)', async () => { const x = expect(await call(r, 'POST', '/usage-ingestion/api/v1/usage/ingest/bulk', [0, 1, 2, 3, 4].map(ev)), [200, 201, 202], 'bulk'); return `${x.body?.successCount ?? '?'} / ${x.body?.totalEvents ?? 5}`; });
    await r.step('API · ingest with invalid provider → 4xx', async () => { const x = await call(r, 'POST', '/usage-ingestion/api/v1/usage/ingest', { ...ev(9), provider: 'not_a_provider' }); if (x.status < 400) throw new Error(`accepted invalid provider (${x.status})`); return `HTTP ${x.status}`; });
  },
};

async function run(r, picks) {
  if (!r.apiKey) {
    const store = require('../store');
    const s = store.getApiKey(r.cfg.baseUrl);
    if (r.cfg.apiKey) r.apiKey = r.cfg.apiKey; else if (s) r.apiKey = s.key;
  }
  r.log(`API base ${http.apiBase(r)} · tenant ${r.tenantId} · auth ${r.apiKey ? 'API key' : 'session token (no API key available)'}`);
  for (const o of OPTIONS) if (picks.includes(o.id)) await T[o.id](r);
}

module.exports = { title, OPTIONS, run };
