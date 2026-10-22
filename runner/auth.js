// Login through Revinci's Keycloak sign-in page (auth-*.revinci.ai/realms/<tenant>).
const { waitIdle } = require('./ui');

async function login(run) {
  const { page, cfg } = run;
  const base = new URL(cfg.baseUrl);
  run.origin = base.origin;
  await page.goto(cfg.baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const url = page.url();
  const realm = (url.match(/\/realms\/([^/]+)\//) || [])[1];
  if (realm) run.tenantId = realm;

  if (await page.locator('#username').count()) {
    await page.fill('#username', cfg.email);
    await page.fill('#password', cfg.password);
    await Promise.all([
      page.waitForURL(u => u.origin === base.origin || u.href.startsWith(base.origin), { timeout: 45000 }),
      page.click('#kc-login'),
    ]);
  }
  if (await page.locator('#input-error, .kc-feedback-text, #kc-error-message').first().isVisible().catch(() => false)) {
    throw new Error('Sign-in rejected: ' + (await page.locator('#input-error, .kc-feedback-text').first().innerText()));
  }
  await waitIdle(page, 1500);
  if (!page.url().startsWith(base.origin)) throw new Error('Login did not return to the workspace: ' + page.url());
  run.tenantId = run.tenantId || base.hostname.split('-')[0];
  return `tenant ${run.tenantId}`;
}

module.exports = { login };
