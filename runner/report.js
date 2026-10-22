// Self-contained HTML report for a run.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function html(r) {
  const rows = r.steps.map((s, i) => `
    <tr class="${s.status}">
      <td>${i + 1}</td>
      <td>${esc(s.name)}</td>
      <td><span class="pill ${s.status}">${s.status}</span></td>
      <td>${s.end ? ((s.end - s.start) / 1000).toFixed(1) + 's' : ''}</td>
      <td>${esc(s.error || s.detail || '')}${s.screenshot ? `<br><a href="${s.screenshot}" target="_blank">screenshot</a>` : ''}</td>
    </tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Revinci Test Report ${esc(r.id)}</title>
<style>
body{font-family:Inter,system-ui,sans-serif;margin:0;background:#f6f8f5;color:#1b1f1a}
header{background:#0f1a12;color:#fff;padding:20px 28px;display:flex;gap:16px;align-items:center}
header b{color:#9be15d}main{padding:24px 28px}
.k{display:flex;gap:12px;margin-bottom:18px}.k div{background:#fff;border:1px solid #e3e8e0;border-radius:10px;padding:12px 16px;min-width:110px}
.k span{display:block;font-size:24px;font-weight:600}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e3e8e0;border-radius:10px;overflow:hidden}
td,th{padding:9px 12px;border-bottom:1px solid #eef1ec;text-align:left;font-size:14px;vertical-align:top}
th{background:#f0f4ee;font-weight:600}.pill{padding:2px 8px;border-radius:99px;font-size:12px}
.pill.passed{background:#e3f6d6;color:#2d6a12}.pill.failed{background:#fde3e3;color:#a31f1f}
pre{background:#fff;border:1px solid #e3e8e0;border-radius:10px;padding:12px;overflow:auto;font-size:12px}
</style></head><body>
<header><b>Revinci</b> Test Report · ${esc(r.id)} · ${esc(r.baseUrl)}</header>
<main>
<div class="k"><div>Total<span>${r.total}</span></div><div>Passed<span style="color:#2d6a12">${r.passed}</span></div><div>Failed<span style="color:#a31f1f">${r.failed}</span></div><div>Data tag<span style="font-size:16px">${esc(r.tag)}</span></div></div>
<table><tr><th>#</th><th>Step</th><th>Status</th><th>Time</th><th>Detail</th></tr>${rows}</table>
<h3>Records created</h3><pre>${esc(JSON.stringify(r.data, (k, v) => /key|secret|token/i.test(k) && typeof v === 'string' ? v.slice(0, 6) + '…' : v, 2))}</pre>
</main></body></html>`;
}
module.exports = { html };
