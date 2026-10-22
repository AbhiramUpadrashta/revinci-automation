// Builds the public site for GitHub Pages (docs/) and the artifact copy.
//   docs/index.html  — setup page (browser runner + Terminal steps)
//   docs/runner.js   — the in-browser runner, loaded by the bookmark / console line
const fs = require('fs');
const path = require('path');
const { minify } = require('terser');
const PAGES = 'https://abhiramupadrashta.github.io/revinci-automation';
(async () => {
  const root = path.join(__dirname, '..');
  const src = fs.readFileSync(path.join(root, 'browser', 'runner.js'), 'utf8');
  const min = (await minify(src, { compress: { passes: 2 }, mangle: true })).code;
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'runner.js'), min);
  fs.writeFileSync(path.join(root, 'docs', '.nojekyll'), '');
  const loader = `(function(){var s=document.createElement('script');s.src='${PAGES}/runner.js?v='+Date.now();s.onerror=function(){alert('Could not load Revinci Test Automation from ${PAGES}')};document.body.appendChild(s)})()`;
  const consoleLine = `var s=document.createElement('script');s.src='${PAGES}/runner.js?v='+Date.now();document.body.appendChild(s)`;
  const logo = fs.readFileSync(path.join(root, 'public', 'revinci-logo.svg'), 'utf8').replace(/width="804" height="603" /, '').trim();
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const body = fs.readFileSync(path.join(root, 'browser', 'site.template.html'), 'utf8')
    .split('__LOGO__').join(logo)
    .replace('__LAUNCHER__', () => esc('javascript:' + loader))
    .replace('__CONSOLE__', () => esc(consoleLine));
  // Artifact copy (the artifact host adds the document skeleton)
  fs.writeFileSync(path.join(root, 'revinci-test-automation.html'), body);
  // GitHub Pages copy (needs its own skeleton)
  const page = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(logo)}">\n${body.replace(/<\/style>[\s\S]*$/, '</style>')}\n</head>\n<body>\n${body.slice(body.indexOf('</style>') + 8)}\n</body>\n</html>\n`;
  fs.writeFileSync(path.join(root, 'docs', 'index.html'), page);
  console.log('docs/runner.js', min.length, '· docs/index.html', page.length, '· bookmark', ('javascript:' + loader).length, 'chars');
})();
