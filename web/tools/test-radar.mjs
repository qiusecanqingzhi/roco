/**
 * 六维雷达图的几何与渲染检查。
 * 用 DOM 桩执行 app.js，直接调用 spiritDetail，然后解析生成的 SVG：
 *   - 六个轴、四圈网格、六个数据顶点、六个标签
 *   - 数值为 0 的项不会塌到圆心（否则看不出是哪一项）
 *   - 数值越高，顶点离圆心越远（方向正确）
 *
 * 用法: node web/tools/test-radar.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); else { problems.push(m); console.log('  ✗ ' + m); } };

/* ---------------------------------------------------------- DOM 桩 */
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
  setTimeout, clearTimeout, fetch: () => Promise.reject(new Error('no fetch')),
  HTMLImageElement: class {}, Error, JSON, Math, Date, Number, String, Object, Array, Set, Map, Promise, RegExp, isNaN, parseInt, parseFloat,
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(WEB, 'data-bundle.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(WEB, 'app.js'), 'utf8'), ctx);
await new Promise((r) => setTimeout(r, 80));

const api = window.__roco;
ok(!!api, 'app.js 已加载并暴露测试钩子');

/* ---------------------------------------------------------- 解析 SVG */
const num = (s) => Number(s);

function parsePoints(svg) {
  // 数据多边形：<path class="radar-area" d="M.. .. L.. .. Z">
  const m = /<path class="radar-area" d="([^"]+)"/.exec(svg);
  if (!m) return null;
  return m[1].split(/[MLZ]/).map((s) => s.trim()).filter(Boolean).map((p) => p.split(/\s+/).map(num));
}

console.log('\n· 结构');
api.spiritDetail('466:1');           // 果实立方人：105/132/50/120/98/95
const svg = ids.get('modalBody').innerHTML.match(/<svg class="radar"[\s\S]*?<\/svg>/)?.[0] ?? '';
ok(svg.length > 200, '详情里渲染出了雷达图 SVG');
ok((svg.match(/class="radar-spoke"/g) || []).length === 6, `六条轴线（实际 ${(svg.match(/class="radar-spoke"/g) || []).length}）`);
ok((svg.match(/class="radar-ring"/g) || []).length === 4, `四圈网格（实际 ${(svg.match(/class="radar-ring"/g) || []).length}）`);
ok((svg.match(/class="radar-dot/g) || []).length === 6, '六个数据顶点');
ok((svg.match(/class="radar-label"/g) || []).length === 6, '六个轴标签');
for (const label of ['生命', '物攻', '魔攻', '物防', '魔防', '速度']) {
  ok(svg.includes(`>${label} <`), `含标签「${label}」`);
}

console.log('\n· 几何');
const pts = parsePoints(svg);
ok(Array.isArray(pts) && pts.length === 6, `数据多边形有 6 个顶点（实际 ${pts?.length}）`);

const C = 120;                        // viewBox 240 -> 圆心 120
const dist = ([x, y]) => Math.hypot(x - C, y - C);
if (pts) {
  // 第 1 个点是“生命”，向上（y 更小）；值 105/200 = 0.525R
  const R = 78;
  const expect = R * (105 / 200);
  ok(Math.abs(dist(pts[0]) - expect) < 1.5, `生命顶点半径 ≈ ${expect.toFixed(1)}（实际 ${dist(pts[0]).toFixed(1)}）`);
  ok(pts[0][1] < C, '生命顶点在圆心上方（第一轴朝向正确）');
  // 魔攻 50/180 应比 物攻 132/180 更靠内
  ok(dist(pts[2]) < dist(pts[1]), '魔攻(50) 比 物攻(132) 更靠内 —— 数值越大越外');
}

// 极端值：全 0 与超高
const zeroSpirit = { ...api.STATE.bySpirit.get('466:1'), stats: { hp: 0, patk: 0, satk: 0, pdef: 0, sdef: 0, spd: 0 } };
api.STATE.bySpirit.set('9999:1', zeroSpirit);
api.spiritDetail('9999:1');
const svg0 = ids.get('modalBody').innerHTML.match(/<svg class="radar"[\s\S]*?<\/svg>/)?.[0] ?? '';
const pts0 = parsePoints(svg0);
ok(pts0 && pts0.length === 6 && pts0.every((p) => dist(p) > 3), '全 0 时六个顶点仍在圆心外（不塌陷）');
ok(pts0 && new Set(pts0.map((p) => p.map((x) => x.toFixed(1)).join(','))).size === 6, '全 0 时六个顶点位置互不相同（能看出是哪一项）');
api.STATE.bySpirit.delete('9999:1');

console.log('');
if (problems.length) {
  console.log(`✗ ${problems.length} 项不通过:`);
  problems.forEach((p) => console.log('   - ' + p));
  process.exit(1);
}
console.log('✓ 雷达图检查通过');
