/**
 * 线上站点体检：确认 GitHub Pages 上的页面、数据、图片都真的能取到。
 * 用法: node tools/check-live.mjs [baseUrl]
 */
const base = (process.argv[2] ?? 'https://qiusecanqingzhi.github.io/roco').replace(/\/$/, '');

const targets = [
  ['页面', '/'],
  ['样式', '/style.css'],
  ['脚本', '/app.js'],
  ['数据单文件包', '/data-bundle.js'],
  ['数据分片', '/data/spirits.json'],
  ['数据分片', '/data/meta.json'],
  ['禁止收录', '/robots.txt'],
  ['说明文件', '/README.txt'],
];
const need = ['/', '/style.css', '/app.js', '/data/spirits.json', '/data-bundle.js', '/robots.txt', '/README.txt'];

let bad = 0;
console.log(`· 体检 ${base}\n`);
const results = new Map();

for (const [label, p] of targets) {
  try {
    const r = await fetch(base + p, { redirect: 'follow', signal: AbortSignal.timeout(25000) });
    const len = r.headers.get('content-length');
    const ok = r.ok;
    if (!ok) bad++;
    results.set(p, { ok, status: r.status, len });
    console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(12)} ${String(r.status).padEnd(4)} ${p.padEnd(22)} ${len ? (len / 1024).toFixed(0) + ' KB' : ''}`);
    if (p === '/') var html = await r.text();
  } catch (e) {
    bad++;
    console.log(`  ✗ ${label.padEnd(12)} 失败 ${p}：${e.message}`);
  }
}

// 页面内容是否真的是我们的图鉴（而不是 404 页面）
if (html) {
  const checks = [
    ['标题含「图鉴浏览器」', /图鉴浏览器/.test(html)],
    ['引用了 app.js', /app\.js/.test(html)],
    ['引用了 data-bundle.js', /data-bundle\.js/.test(html)],
    ['引用了 style.css', /style\.css/.test(html)],
    ['没有 404 文案', !/404|Page not found/i.test(html)],
  ];
  console.log('\n· 页面内容自检');
  for (const [n, c] of checks) { if (!c) bad++; console.log(`  ${c ? '✓' : '✗'} ${n}`); }
}

// 抽 3 张图片验证
console.log('\n· 抽样图片');
let img = null;
try {
  const r = await fetch(`${base}/data/spirits.json`, { signal: AbortSignal.timeout(25000) });
  const list = await r.json();
  img = list.find((s) => s.id === 466) ?? list[0];
} catch { /* 忽略 */ }
if (img) {
  for (const [what, url] of [['头像', img.head], ['立绘', img.img]]) {
    if (!url) continue;
    try {
      const r = await fetch(`${base}/${url}`, { signal: AbortSignal.timeout(25000) });
      const ct = r.headers.get('content-type') ?? '';
      const ok = r.ok && /image/.test(ct);
      if (!ok) bad++;
      console.log(`  ${ok ? '✓' : '✗'} ${what} ${url.split('/').pop()} ${r.status} ${ct}`);
    } catch (e) { bad++; console.log(`  ✗ ${what} 失败：${e.message}`); }
  }
}

// data-bundle.js 里是否有真实数据
try {
  const r = await fetch(`${base}/data-bundle.js`, { signal: AbortSignal.timeout(30000) });
  const t = await r.text();
  const ok = t.startsWith('window.ROCO_DATA=') && t.includes('果实立方人');
  if (!ok) bad++;
  console.log(`\n· data-bundle.js 内容: ${ok ? '✓ 含 window.ROCO_DATA 与真实数据' : '✗ 内容异常'}（${(t.length / 1048576).toFixed(1)} MB）`);
} catch (e) { bad++; console.log(`\n· data-bundle.js 读取失败：${e.message}`); }

console.log(bad ? `\n✗ ${bad} 项有问题` : '\n✓ 线上站点全部正常');
process.exit(bad ? 1 : 0);
