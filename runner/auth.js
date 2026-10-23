// Login through Revinci's Keycloak sign-in page (auth-*.revinci.ai/realms/<tenant>).
// The workspace redirects to Keycloak client-side after it loads, so we wait for either
// the sign-in form or an already-authenticated workspace before acting.
const { waitIdle } = require('./ui');

// Works with Revinci's hosted Keycloak and local ones (e.g. http://localhost:8080 with a custom theme).
const LOGIN_FORM = '#username, input[name="username"], input[name="email"], input[type="email"], #email';
const PASSWORD = '#password, input[name="password"], input[type="password"]';
const SUBMIT = '#kc-login, button[type=submit], input[type=submit], button:has-text("Sign In"), button:has-text("Log In")';
const LOGIN_ERROR = '#input-error, .kc-feedback-text, #kc-error-message, .alert-error, .pf-c-alert__title';

async function loggedIn(page, origin) {
  if (!page.url().startsWith(origin) || /\/realms\//.test(page.url())) return false;
  return page.evaluate(() => {
    const has = st => { try { return Object.keys(st).some(k => /accessToken|access_token|kc[-_]?token|^token$/i.test(k) && st.getItem(k)); } catch (_) { return false; } };
    return has(localStorage) || has(sessionStorage);
  }).catch(() => false);
}

// A Keycloak error page ("We are sorry…", "Invalid parameter: redirect_uri", "Page not found") instead of the form.
async function keycloakError(page) {
  if (!/\/realms\//.test(page.url())) return null;
  const t = await page.locator('#kc-error-message, .kc-feedback-text, .instruction, #kc-page-title').first().innerText().catch(() => '');
  return /sorry|invalid|not found|error|expired/i.test(t) ? t.trim().replace(/\s+/g, ' ').slice(0, 200) : null;
}

async function login(run) {
  const { page, cfg } = run;
  const base = new URL(cfg.baseUrl);
  const origin = base.origin;
  run.origin = origin;

  await page.goto(cfg.baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // 1. Wait until we are either on the sign-in form or inside the workspace.
  //    Local Keycloak can be slow on its first request, so wait longer and reload once if the page stays blank.
  const waitMs = Math.max(90000, require('./ant').to(60000));
  const end1 = Date.now() + waitMs;
  let state = null;
  let kcClicked = false, reloaded = false;
  const started = Date.now();
  const kcRe = /sign\s*in\s*with\s*keycloak/i;
  const kcButton = page.getByRole('button', { name: kcRe }).or(page.getByRole('link', { name: kcRe })).or(page.getByText(kcRe)).first();
  while (Date.now() < end1 && !state) {
    // Some workspaces first show a "Sign in with Keycloak" button — click it when present, otherwise skip.
    if (!kcClicked && await kcButton.isVisible().catch(() => false)) {
      await kcButton.click({ timeout: 5000 }).catch(() => kcButton.click({ force: true }).catch(() => {}));
      kcClicked = true;
      run.log('  clicked "Sign in with Keycloak"');
      await page.waitForTimeout(800);
      continue;
    }
    if (await page.locator(LOGIN_FORM).first().isVisible().catch(() => false)) { state = 'form'; break; }
    if (await loggedIn(page, origin)) { state = 'in'; break; }
    const kcErr = await keycloakError(page);
    if (kcErr) throw new Error(`Keycloak showed an error instead of the sign-in form: "${kcErr}" (${page.url().split('?')[0]})`);
    if (!reloaded && Date.now() - started > 30000) {
      const blank = await page.evaluate(() => (document.body?.innerText || '').trim().length < 20).catch(() => true);
      if (blank) { run.log('  sign-in page still blank after 30s — reloading once', 'warn'); reloaded = true; await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}); continue; }
    }
    await page.waitForTimeout(500);
  }
  if (!state) {
    const title = await page.title().catch(() => '');
    const body = await page.evaluate(() => (document.body?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 160)).catch(() => '');
    throw new Error(`Neither the sign-in form nor the workspace appeared within ${Math.round(waitMs / 1000)}s at ${page.url().split('?')[0]}` +
      (title || body ? ` — page shows: "${title}${body ? ' · ' + body : ''}"` : ' — the page is blank (is the local Keycloak running?)'));
  }

  const realm = (page.url().match(/\/realms\/([^/]+)\//) || [])[1];
  if (realm) run.tenantId = realm;

  // 2. Sign in.
  if (state === 'form') {
    await page.locator(LOGIN_FORM).first().fill(cfg.email);
    const pw = page.locator(PASSWORD).first();
    if (!(await pw.isVisible().catch(() => false))) { // two-step forms: email first, then password
      await page.locator(SUBMIT).first().click().catch(() => {});
      await pw.waitFor({ state: 'visible', timeout: 20000 });
    }
    await pw.fill(cfg.password);
    await page.locator(SUBMIT).first().click();

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
