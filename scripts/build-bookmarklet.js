// Builds the in-browser runner into a bookmarklet + console snippet (dist/).
const fs = require('fs');
const path = require('path');
const { minify } = require('terser');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'browser', 'runner.js'), 'utf8');
  const out = await minify(src, { compress: { passes: 2 }, mangle: true, format: { comments: false } });
  const dir = path.join(__dirname, '..', 'dist');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'revinci-runner.min.js'), out.code);
  // Console installer: saves the runner in this browser (per Revinci workspace) and starts it.
  const installer = `localStorage.setItem("rvAuto.code",${JSON.stringify(out.code)});localStorage.setItem("rvAuto.codeAt",Date.now());(0,eval)(localStorage.getItem("rvAuto.code"));`;
  fs.writeFileSync(path.join(dir, 'console-installer.js'), installer);
  // Tiny launcher bookmark: starts the saved runner (no large URL for the browser to mangle).
  const launcher = `javascript:(function(){var c=localStorage.getItem("rvAuto.code");if(c){(0,eval)(c)}else{alert("Revinci Test Automation is not set up in this browser yet. Paste the runner code into the console once (see the setup page).")}})()`;
  fs.writeFileSync(path.join(dir, 'bookmarklet.txt'), launcher);
  console.log(`runner ${src.length} → ${out.code.length} bytes · installer ${installer.length} · launcher ${launcher.length} chars`);
})();

// Also render the install page with the runner and logo embedded.
(async () => {
  await new Promise(r => setTimeout(r, 300));
  const fs = require('fs'), path = require('path');
  const root = path.join(__dirname, '..');
  const code = fs.readFileSync(path.join(root, 'dist', 'console-installer.js'), 'utf8').replace(/<\//g, '<\\/');
  const launcher = fs.readFileSync(path.join(root, 'dist', 'bookmarklet.txt'), 'utf8');
  const logo = fs.readFileSync(path.join(root, 'public', 'revinci-logo.svg'), 'utf8').replace(/width="804" height="603" /, '').trim();
  const page = fs.readFileSync(path.join(root, 'browser', 'install.template.html'), 'utf8')
    .split('__LOGO__').join(logo).replace('__CODE__', () => code).replace('__LAUNCHER__', () => launcher.replace(/"/g, '&quot;'));
  fs.writeFileSync(path.join(root, 'dist', 'install.html'), page);
  console.log('install page', page.length, 'bytes');
})();
