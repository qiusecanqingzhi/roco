/** 打印实际生成的雷达图 SVG，用于肉眼确认结构（配合 test-radar.mjs 的断言） */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  console: { log() {}, warn() {}, error() {} },
  setTimeout, clearTimeout, fetch: () => Promise.reject(new Error('x')),
  HTMLImageElement: class {}, Error, JSON, Math, Date, Number, String, Object, Array, Set, Map, Promise, RegExp, isNaN, parseInt, parseFloat,
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(WEB, 'data-bundle.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(WEB, 'app.js'), 'utf8'), ctx);
await new Promise((r) => setTimeout(r, 150));

for (const key of ['466:1', '1:1']) {
  const sp = window.__roco.STATE.bySpirit.get(key);
  window.__roco.spiritDetail(key);
  const html = ids.get('modalBody').innerHTML;
  const svg = html.match(/<svg class="radar"[\s\S]*?<\/svg>/)?.[0] ?? '';
  console.log(`\n=== ${sp.name}（#${sp.id}）===`);
  console.log('六维:', Object.entries(sp.stats).map(([k, v]) => `${k}=${v}`).join(' '), ' 总和', sp.bst);
  console.log('SVG 长度:', svg.length);
  const poly = /<path class="radar-area" d="([^"]+)"/.exec(svg)?.[1];
  console.log('数据多边形:', poly);
  const labels = [...svg.matchAll(/class="radar-label"[^>]*>([^<]+)<tspan class="radar-val">(\d+)/g)]
    .map((m) => `${m[1].trim()}=${m[2]}`).join('  ');
  console.log('轴上标签:', labels);
  console.log('保留数值条:', /class="stat-bars"/.test(html) ? '✓ 是（图和条并存）' : '✗ 否');
  console.log('默认折叠? 检查 stat-wrap:', /class="stat-wrap"/.test(html) ? '✓ 有容器' : '✗ 缺容器');
}
