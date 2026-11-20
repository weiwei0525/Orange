// 更新 index.html / admin.html 裡 CSS、JS 網址的版本號（?v=...），讓瀏覽器重新下載新版
// 用法：node tools/bump.js
// 有設定 git pre-commit hook 時，commit 到 assets/css 或 assets/js 會自動執行
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const d = new Date(), p = n => String(n).padStart(2, '0');
const v = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;

['index.html', 'admin.html'].forEach(f => {
  const file = path.join(root, f);
  const src = fs.readFileSync(file, 'utf8');
  const out = src.replace(/((?:href|src)="assets\/(?:css|js)\/[\w.-]+\.(?:css|js))(?:\?v=\w+)?"/g, `$1?v=${v}"`);
  if (out !== src) { fs.writeFileSync(file, out); console.log(`${f}: v=${v}`); }
});
