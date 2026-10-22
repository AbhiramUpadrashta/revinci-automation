# Revinci Test Automation

A browser-run, end-to-end test automation app for the Revinci platform. Enter the workspace URL, user name and password, tick what to test, click **Run** — a Chrome window drives Revinci step by step while the control panel shows live progress, API calls and a report.

## Quick start (macOS)

1. Install [Node.js 18+](https://nodejs.org).
2. Double-click **`Start Revinci Automation.command`** (first run installs dependencies), or:
   ```bash
   npm install
   npm start
   ```
3. The control panel opens at **http://localhost:4600**.

If Playwright's Chromium can't be downloaded, the app automatically uses your installed Google Chrome (or Edge).

## Public live link (hosted)

The app can run on a server so anyone on the team opens it by URL. In hosted mode the automation browser runs headless on the server and the **Live view** tab streams what it is doing; the whole panel is protected by `APP_PASSWORD`.

**Render (one click, free plan):**

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/abhiramupadrashta/revinci-automation)

1. Click the button and sign in to Render (GitHub sign-in is fine).
2. Choose a panel password for `APP_PASSWORD` → **Apply**. The first build takes a few minutes.
3. Open `https://revinci-automation-xxxx.onrender.com`, sign in with any user name + that password, enter the Revinci URL, email and password, tick the tests, click **Run tests**, and watch the **Live view** tab.

On the free plan the service sleeps when idle; the first visit after a while takes about a minute to wake. The API key is remembered in your own browser.

**Any Docker host:**
```bash
docker build -t revinci-automation .
docker run -p 4600:4600 -e APP_PASSWORD=choose-one -v revinci-data:/var/data -e DATA_DIR=/var/data revinci-automation
```

| Env var | Purpose |
|---|---|
| `HOSTED=1` | bind 0.0.0.0, force headless, don't open a local browser |
| `APP_PASSWORD` | password for the panel (HTTP Basic) — **always set this when public** |
| `DATA_DIR` | optional: server-side store for the API key (the panel also remembers it in your browser) |
| `PORT` | default 4600 |

The server must be able to reach your Revinci workspace and API hosts (e.g. `*-dev.revinci.ai`); if the dev environment is IP-restricted, allow the host's outbound IP or run locally.

## What it tests

| Suite | Options |
|---|---|
| **1 · Admin setup** | Currency · Exchange rate · Unit of measure · Attribute (PickList) · Attribute group · Price profile · Cost profile · Customer account |
| **2 · API key** | Settings ▸ API Keys — reuse stored key → use pasted key → create if none active → (opt-in) revoke & recreate |
| **3 · Product setup** | Feature · Option · Agent Feature · Feature Offering · Product (standalone, with attributes) · Option group · Bundle · Product with Features · Product with Feature Offerings · Simple agent · Workflow agent |
| **4 · Quote · Order · Entitlement** | Quote → bag → finalize → lifecycle · Order → bag → finalize · Activate entitlement + map external plan ID · Usage event to the plan |
| **5 · API testing** | Auth (positive/negative) · Accounts · Entitlements, plans, rate matrix, usage summaries · Wallets, carryover & consumption rules, activate, top-up, transactions · Usage ingest single & bulk |

Presets: **Admin setup**, **Product setup**, **Quote → Order → Entitlement**, **API testing**, **Full end-to-end**.

Every run tags the records it creates with a unique suffix (e.g. `AT Customer ATK3F9Q`) so runs never collide, and later suites reuse what earlier ones created (account → quote/order, product → bag, entitlement plan → usage).

## API key handling

Revinci allows **one active API key** and shows its secret **only once**. The app therefore:

1. reuses a key it stored on an earlier run (if it still matches the active key),
2. otherwise uses a key you paste into the panel (verified against the Accounts API),
3. otherwise creates a new key in Settings ▸ API Keys **if none is active**,
4. revokes and recreates the active key **only** when you tick *Revoke the active key & create a new one* (with a confirmation).

The key is stored locally in `data/state.json` (git-ignored, file mode 600) and shown masked in the panel with Reveal / Copy.

API calls go to the auto-detected API host (e.g. `https://api-dev.revinci.ai` for `*-dev` workspaces; override under *Advanced*) with `Authorization: Bearer <key>` and `Tenant-Id: <tenant>` per https://docs.revinci.ai/#api-auth. The tenant is read from the sign-in realm.

## Reports

Each run writes `reports/<run-id>/index.html` (+ `report.json`, failure screenshots, optional video). Recent runs are listed in the panel.

## Security

- The password is held in memory for the run only — never written to disk or git.
- The server listens on `127.0.0.1` only.
- `data/` (API keys) and `reports/` are git-ignored.

## Project layout

```
server.js                 control-panel server (Express + live event stream)
public/                   control panel UI + Revinci logo
runner/engine.js          run orchestration, step logging, report
runner/auth.js            Keycloak sign-in (#username / #password / #kc-login)
runner/ant.js             Ant Design helpers (form items, selects, DD-MM-YYYY dates, toasts)
runner/http.js            REST client (API key or session token)
runner/suites/*.js        admin · apikey · products · q2c · api
```

## Tuning selectors

Screens were mapped from the live app (Ant Design forms with stable ids such as `#name`, `#accountId`, `#startDate`). Later wizard steps (pricing, linking, offerings, publish) are driven adaptively by button text; if Revinci renames a button, update the label lists in `runner/suites/products.js` / `q2c.js`. Failures include a screenshot in the report.
