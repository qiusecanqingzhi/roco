/**
 * 验证 dist-share/ 这份「分享包」自身可用：
 *  1) 通过 HTTP 取关键文件（模拟托管）
 *  2) 用 DOM 桩执行包里的 app.js（模拟双击 file://）
 * 用法: node tools/verify-share.mjs [包目录]
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';

const dir = path.resolve(process.argv[2] ?? 'dist-share');
const port = process.argv[3] ?? '8100';
const problems = [];
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); else { problems.push(m); console.log('  ✗ ' + m); } };

console.log(`· 校验分享包 ${dir}`);

ok(fs.existsSync(path.join(dir, 'index.html')), 'index.html 在根目录');
ok(fs.existsSync(path.join(dir, 'app.js')), 'app.js 存在');
ok(fs.existsSync(path.join(dir, 'style.css')), 'style.css 存在');
ok(fs.existsSync(path.join(dir, 'data-bundle.js')), 'data-bundle.js 存在（file:// 双击需要）');
ok(fs.existsSync(path.join(dir, 'README.txt')), 'README.txt 存在（含说明与版权提示）');
ok(fs.existsSync(path.join(dir, 'robots.txt')), 'robots.txt 存在（默认禁止收录）');

// 不该带进去的东西
for (const junk of ['export-data.mjs', 'fetch-assets.mjs', 'tools', '.cache', 'data/assets.json']) {
  ok(!fs.existsSync(path.join(dir, junk)), `未包含 ${junk}`);
}

// 图片齐全
const assets = fs.existsSync(path.join(dir, 'assets')) ? fs.readdirSync(path.join(dir, 'assets')) : [];
ok(assets.length > 2300, `assets/ 图片 ${assets.length} 张`);

/* ---------------- 1) HTTP 取文件（托管场景） ---------------- */
// 注意：这里用原生 http 而不是 fetch —— Node 自带 undici 与 python -m http.server
// 的连接复用会触发 undici 内部断言（与本分享包无关），换 http 模块最省事。
console.log('\n· HTTP 访问（模拟静态托管）');
const httpGet = (p) => new Promise((resolve) => {
  const req = http.get({ host: '127.0.0.1', port: Number(port), path: p, agent: false }, (res) => {
    res.resume();
    res.on('end', () => resolve({ status: res.statusCode }));
  });
  req.on('error', (e) => resolve({ error: e.message }));
  req.setTimeout(8000, () => { req.destroy(new Error('超时')); });
});
for (const p of ['/', '/app.js', '/style.css', '/data/meta.json', '/data/spirit-skills.json', '/assets/' + (assets[0] ?? '')]) {
  const r = await httpGet(p);
  if (r.error) ok(false, `GET ${p} 失败: ${r.error}（服务器没起？）`);
  else ok(r.status === 200, `GET ${p} -> ${r.status}`);
}

/* ---------------- 2) DOM 桩执行包里的 app.js ---------------- */
console.log('\n· 离线渲染（模拟双击 index.html）');
function el() {
  return {
    tagName: 'DIV', id: '', _html: '', textContent: '', hidden: false, dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    value: '', checked: false,
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    setAttribute() {}, getAttribute() { return null; }, focus() {}, scrollTop: 0, setSelectionRange() {},
    addEventListener() {}, closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
  };
}
const ids = new Map(['app', 'modal', 'modalBody', 'toast', 'searchSuggest', 'statLine', 'tabs', 'globalSearch', 'themeBtn'].map((i) => [i, el()]));
const document = {
  body: el(), documentElement: { dataset: {} }, activeElement: null,
  querySelector: (s) => (s.startsWith('#') ? ids.get(s.slice(1)) ?? null : el()),
  querySelectorAll: () => [], addEventListener() {}, createElement: () => el(),
};
let hash = '#/spirits';
const hl = [];
const location = { get hash() { return hash; }, set hash(v) { hash = v; hl.forEach((f) => f()); } };
const window = { ROCO_DATA: null, addEventListener(t, f) { if (t === 'hashchange') hl.push(f); }, location };
const sandbox = {
  window, document, location,
  localStorage: { getItem: () => null, setItem() {} },
  navigator: { clipboard: { writeText: async () => {} } },
  console: { log() {}, error() {}, warn() {} },
  setTimeout, clearTimeout, fetch: () => Promise.reject(new Error('file:// 下不应 fetch')),
  HTMLImageElement: class {}, Error, JSON, Math, Date, Number, String, Object, Array, Set, Map, Promise, RegExp, isNaN, parseInt,
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(dir, 'data-bundle.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'app.js'), 'utf8'), ctx);
await new Promise((r) => setTimeout(r, 100));

const html = ids.get('app').innerHTML;
const cards = (html.match(/class="card"/g) || []).length;
ok(cards === 466, `离线渲染出 ${cards} 张卡片（应为 466）`);
ok(/果实立方人/.test(html), '内容含「果实立方人」');
ok(!/正在加载数据/.test(html), '不在 loading 状态');
ok(!/数据加载失败/.test(html), '没有加载失败提示');
const imgs = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
ok(imgs.length > 0 && imgs.every((s) => s.startsWith('assets/')), `卡片图片走本地路径（${imgs.length} 张）`);
const missing = [...new Set(imgs)].filter((s) => !fs.existsSync(path.join(dir, s)));
ok(missing.length === 0, `引用的图片都存在于包内（缺失 ${missing.length}）`);

console.log('');
if (problems.length) {
  console.log(`✗ ${problems.length} 项不通过`);
  problems.forEach((p) => console.log('   - ' + p));
  process.exit(1);
}
console.log('✓ 分享包校验通过：能离线打开，也能直接托管');
