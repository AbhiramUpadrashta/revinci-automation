// Login through Revinci's Keycloak sign-in page (auth-*.revinci.ai/realms/<tenant>).
// The workspace redirects to Keycloak client-side after it loads, so we wait for either
// the sign-in form or an already-authenticated workspace before acting.
const { waitIdle } = require('./ui');

const LOGIN_FORM = '#username';
const LOGIN_ERROR = '#input-error, .kc-feedback-text, #kc-error-message, .alert-error, .pf-c-alert__title';

async function loggedIn(page, origin) {
  if (!page.url().startsWith(origin)) return false;
  return page.evaluate(() => !!localStorage.getItem('accessToken')).catch(() => false);
}

async function login(run) {
  const { page, cfg } = run;
  const base = new URL(cfg.baseUrl);
  const origin = base.origin;
  run.origin = origin;

  await page.goto(cfg.baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // 1. Wait until we are either on the sign-in form or inside the workspace.
  const end1 = Date.now() + 60000;
  let state = null;
  let kcClicked = false;
  const kcButton = page.locator('button:visible, a:visible, [role=button]:visible').filter({ hasText: /sign\s*in\s*with\s*keycloak/i }).first();
  while (Date.now() < end1 && !state) {
    // Some workspaces first show a "Sign in with Keycloak" button — click it when present, otherwise skip.
    if (!kcClicked && await kcButton.isVisible().catch(() => false)) {
      await kcButton.click().catch(() => {});
      kcClicked = true;
      run.log('  clicked "Sign in with Keycloak"');
      await page.waitForTimeout(800);
      continue;
    }
    if (await page.locator(LOGIN_FORM).isVisible().catch(() => false)) state = 'form';
    else if (await loggedIn(page, origin)) state = 'in';
    else await page.waitForTimeout(500);
  }
  if (!state) throw new Error('Neither the sign-in page nor the workspace loaded within 60s: ' + page.url());

  const realm = (page.url().match(/\/realms\/([^/]+)\//) || [])[1];
  if (realm) run.tenantId = realm;

  // 2. Sign in.
  if (state === 'form') {
    await page.fill(LOGIN_FORM, cfg.email);
    await page.fill('#password', cfg.password);
    await page.click('#kc-login, button[type=submit], input[type=submit]');

    const end2 = Date.now() + 60000;
    while (Date.now() < end2) {
      if (await loggedIn(page, origin)) break;
      const err = page.locator(LOGIN_ERROR).first();
      if (await err.isVisible().catch(() => false)) {
        throw new Error('Sign-in rejected: ' + (await err.innerText()).trim());
      }
      // Keycloak "update password" / "verify email" / OTP screens need a human.
      if (/required-action|login-actions\/(required|authenticate)/.test(page.url()) && await page.locator('#password-new, #totp, #otp').count()) {
        throw new Error('Revinci needs an extra sign-in step (new password or one-time code). Finish it once in a normal browser, then rerun.');
      }
      await page.waitForTimeout(500);
    }
    if (!(await loggedIn(page, origin))) throw new Error('Login did not finish within 60s — still at ' + page.url().split('?')[0]);
  }

  await waitIdle(page, 1500);
  run.tenantId = run.tenantId || (await page.evaluate(() => localStorage.getItem('tenant')).catch(() => null)) || base.hostname.split('-')[0];
  return `signed in · tenant ${run.tenantId}${kcClicked ? ' · via Sign in with Keycloak' : ''}`;
}

module.exports = { login };
