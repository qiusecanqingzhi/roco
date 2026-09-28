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

console.log('\n· 外侧标签（图标 + 数值）');
// 顺序必须与原站一致：正上方顺时针 生命 → 魔攻 → 魔防 → 速度 → 物防 → 物攻
// （果实立方人：105 / 50 / 98 / 95 / 120 / 132）
const EXPECT_ORDER = [105, 50, 98, 95, 120, 132];
const EXPECT_LABELS = ['生命', '魔攻', '魔防', '速度', '物防', '物攻'];
const hasIcons = /class="radar-icon"/.test(svg);
if (hasIcons) {
  ok((svg.match(/class="radar-icon"/g) || []).length === 6, '六个维度图标（当 CSS mask 用）');
  ok((svg.match(/--tint:\d+%/g) || []).length === 6, '每个图标带按数值算出的染色比例 --tint');
  ok(/mask-image:url\('assets\//.test(svg), 'mask 指向本地 assets 图片');
  const vals = [...svg.matchAll(/class="radar-val"[^>]*>(\d+)</g)].map((m) => Number(m[1]));
  ok(vals.length === 6, `六个数值文字（实际 ${vals.length}）`);
  ok(vals.join(',') === EXPECT_ORDER.join(','),
    `数值顺序与原站一致：${vals.join(',')}（期望 ${EXPECT_ORDER.join(',')}）`);
  // 染色比例跟随数值：生命 105/200=52%、魔攻 50/180=28%、物攻 132/180=73%
  const tints = [...svg.matchAll(/--tint:(\d+)%/g)].map((m) => Number(m[1]));
  ok(Math.abs(tints[0] - 52) <= 1, `生命染色 ≈52%（实际 ${tints[0]}%）`);
  ok(tints[1] < tints[5], `魔攻(50) 染色比物攻(132) 更淡（${tints[1]}% < ${tints[5]}%）`);
} else {
  ok((svg.match(/class="radar-label"/g) || []).length === 6, '无图标时退回六个文字标签');
}
for (const label of EXPECT_LABELS) {
  ok(svg.includes(`aria-label="六维种族值雷达图：`) && svg.includes(`${label} `), `无障碍标签含「${label}」`);
}
// aria 里的顺序也要对
const ariaSeq = /aria-label="六维种族值雷达图：([^"]+)"/.exec(svg)?.[1] ?? '';
ok(ariaSeq.split('，').map((x) => x.split(' ')[0]).join(',') === EXPECT_LABELS.join(','),
  `无障碍标签顺序一致：${ariaSeq.split('，').map((x) => x.split(' ')[0]).join(',')}`);

console.log('\n· 几何');
const pts = parsePoints(svg);
ok(Array.isArray(pts) && pts.length === 6, `数据多边形有 6 个顶点（实际 ${pts?.length}）`);

const C = 120;                        // viewBox 240 -> 圆心 120
const dist = ([x, y]) => Math.hypot(x - C, y - C);
if (pts) {
  // 第 1 个点是「生命」（向上）；第 2 个是「魔攻」（右上），值 50 应比第 6 个「物攻」132 更靠内
  const R = 78;
  const expect = R * (105 / 200);
  ok(Math.abs(dist(pts[0]) - expect) < 1.5, `生命顶点半径 ≈ ${expect.toFixed(1)}（实际 ${dist(pts[0]).toFixed(1)}）`);
  ok(pts[0][1] < C, '生命顶点在圆心上方（第一轴朝向正确）');
  ok(pts[1][0] > C && pts[1][1] < C, '第二轴（魔攻）在右上方 —— 顺时针排列');
  ok(dist(pts[1]) < dist(pts[5]), '魔攻(50) 比 物攻(132) 更靠内 —— 数值越大越外');
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

/* ---------------------------------------------------------- 图标类需求 */
console.log('\n· 特性 / 技能 / 系别图标');
api.spiritDetail('466:1');
const detail = ids.get('modalBody').innerHTML;
ok(/class="passive-icon"/.test(detail), '特性（被动技能）旁显示图标');
ok(/passive-icon"[^>]*>\s*<img[^>]+src="assets\//.test(detail), '特性图标指向本地 assets');
const skillIconsInDetail = (detail.match(/class="skill-icon"/g) || []).length;
ok(skillIconsInDetail >= 13, `精灵详情的技能表每行都有图标（${skillIconsInDetail} 个）`);
ok(/class="tbadge-img"/.test(detail), '系别改成圆形图标徽章');
ok(/class="type-icon"/.test(detail), '系别徽章内是 img 图标');

// 技能详情：可学精灵列表带头像
const firstSkill = api.spiritSkillsOf(api.STATE.bySpirit.get('466:1')).level[0];
api.skillDetail(firstSkill.id);
const skDetail = ids.get('modalBody').innerHTML;
ok((skDetail.match(/class="spirit-head"/g) || []).length > 0, '技能详情的可学精灵列表显示头像');
ok(/class="type-icon"/.test(skDetail), '技能详情的系别列也是图标');

// 系别页：矩阵表头有图标
api.STATE.view = 'types';
// 直接调用内部渲染（通过 hash 路由无法在桩里完整模拟，这里用钩子里的 render）
ids.get('app').innerHTML = '';
api.render();
const typesHtml = ids.get('app').innerHTML;
ok(/class="type-icon"/.test(typesHtml), '系别克制页的表头用图标徽章');
ok((typesHtml.match(/<td class="mx/g) || []).length === 324, '克制矩阵仍是 324 格');

/* ---------------------------------------------------------- 血脉技能 */
console.log('\n· 血脉技能');
api.STATE.expandedBloodlines = false;
api.spiritDetail('466:1');
const blHtml = ids.get('modalBody').innerHTML;
const bl = api.STATE.data.spiritBloodlines['466:1'] ?? [];
ok(bl.length === 18, `果实立方人有 18 种血脉（实际 ${bl.length}）`);
ok(/血脉技能/.test(blHtml), '详情里有「血脉技能」区块');
ok(/展开全部 18 种/.test(blHtml), '默认折叠，提供「展开全部」按钮');
ok((blHtml.match(/class="bl-icon"/g) || []).length === 6, `默认显示 6 行（实际 ${(blHtml.match(/class="bl-icon"/g) || []).length}）`);
ok((blHtml.match(/class="bl-item"/g) || []).length === 6, '每行显示秘药图标');
ok(/徒长/.test(blHtml) && /引燃/.test(blHtml), '给出了血脉技能名（徒长/引燃）');
ok(/data-skill="7020880"/.test(blHtml), '血脉技能可点开技能详情');
const blMeta = api.STATE.data.meta.bloodlines ?? {};
const blSkillIcons = api.STATE.data.meta.bloodlineSkillIcons ?? {};
ok(bl[0].skill === '拍击' && bl[0].lv === 15, `首条血脉：${blMeta[bl[0].id]?.name} -> ${bl[0].skill} Lv${bl[0].lv}`);
// 图标/名称/秘药已按 bloodline_id 去重到 meta 里（每行只留 id/skillId/skill/lv）
ok(bl.every((x) => blMeta[x.id]?.icon && (x.skillId ? blSkillIcons[x.skillId] : true)),
  '18 条血脉都能从 meta 查到图标与技能图标');
ok(bl.every((b) => !('icon' in b) && !('item' in b)),
  '血脉行里不再重复存图标路径（体积优化：6.1 MB -> 3.3 MB）');

// 展开状态
api.STATE.expandedBloodlines = true;
api.spiritDetail('466:1');
const blFull = ids.get('modalBody').innerHTML;
ok((blFull.match(/class="bl-icon"/g) || []).length === 18, `展开后 18 行（实际 ${(blFull.match(/class="bl-icon"/g) || []).length}）`);
ok(/收起/.test(blFull), '展开后按钮变成「收起」');
api.STATE.expandedBloodlines = false;

// 不同精灵的同一种血脉给的技能不同（源数据特性，界面上必须显示各自的值）
const blOther = api.STATE.data.spiritBloodlines['1:1'] ?? [];
ok(blOther.length >= 18, `#1 也有全部血脉（实际 ${blOther.length} 行）`);
ok(blOther[0].skill !== bl[0].skill, `同一种血脉不同精灵给的技能不同：#466=${bl[0].skill} / #1=${blOther[0].skill}`);

// 有的精灵多一条「首领血脉」且不给技能，界面必须能显示而不报错
const boss = blOther.find((x) => !x.skillId);
ok(!!boss, `存在不给技能的血脉：${blMeta[boss?.id]?.name ?? '(没找到)'}`);
api.STATE.expandedBloodlines = true;   // 它在第 19 位，默认折叠时看不到
api.spiritDetail('1:1');
const bossHtml = ids.get('modalBody').innerHTML;
ok(/首领血脉/.test(bossHtml), '展开后首领血脉出现在详情里');
ok(/class="desc">—</.test(bossHtml), '不给技能的血脉显示为「—」而不是空白');
ok(!/undefined|NaN/.test(bossHtml), '不给技能的血脉没有渲染出 undefined/NaN');
api.STATE.expandedBloodlines = false;

// 全库抽查：任何精灵的血脉区块都不应出现 undefined
let bad = 0;
for (const key of Object.keys(api.STATE.data.spiritBloodlines).slice(0, 40)) {
  api.STATE.expandedBloodlines = true;
  api.spiritDetail(key);
  if (/undefined|NaN/.test(ids.get('modalBody').innerHTML)) bad++;
}
ok(bad === 0, `抽查 40 只精灵的血脉区块，无 undefined/NaN（实际 ${bad}）`);
api.STATE.expandedBloodlines = false;

// 血脉技能区块必须在「技能石」之后
api.spiritDetail('466:1');
const orderHtml = ids.get('modalBody').innerHTML;
const at = (s) => orderHtml.indexOf(s);
ok(at('技能石') > 0 && at('血脉技能') > at('技能石'),
  `「血脉技能」排在「技能石」之后（技能石@${at('技能石')} < 血脉技能@${at('血脉技能')}）`);
ok(at('升级学会') < at('技能石'), '顺序为 升级学会 → 技能石 → 血脉技能');
// 血脉技能行里要有技能图标
ok(/class="skill-icon"/.test(orderHtml) && /data-skill="7020880"/.test(orderHtml), '血脉技能行带技能图标且可点开');

/* ---------------------------------------------------------- 传说技能 */
// source_type=legendary 的技能只有 7 只精灵有，早先模板没渲染这一桶、被静默丢弃。
console.log('\n· 传说技能');
const legendSpirits = Object.entries(api.STATE.data.spiritSkills)
  .filter(([, list]) => list.some((r) => r.src === 'legendary'))
  .map(([k]) => k);
ok(legendSpirits.length === 7, `有传说技能的精灵 7 只（实际 ${legendSpirits.length}）`);
const lk = legendSpirits[0];
api.spiritDetail(lk);
const lHtml = ids.get('modalBody').innerHTML;
ok(/传说技能/.test(lHtml), `详情里出现「传说技能」区块（${lk}）`);
const expectName = api.STATE.data.spiritSkills[lk].find((r) => r.src === 'legendary');
ok(new RegExp(api.STATE.bySkill.get(expectName.id).name).test(lHtml),
  `该区块列出了 ${api.STATE.bySkill.get(expectName.id).name}`);
// 每只都渲染得出来，且不出现 undefined
let legendBad = 0;
for (const k of legendSpirits) {
  api.spiritDetail(k);
  const h = ids.get('modalBody').innerHTML;
  if (!/传说技能/.test(h) || /undefined/.test(h)) legendBad++;
}
ok(legendBad === 0, `7 只精灵的传说技能都能渲染（异常 ${legendBad}）`);

console.log('');
if (problems.length) {
  console.log(`✗ ${problems.length} 项不通过:`);
  problems.forEach((p) => console.log('   - ' + p));
  process.exit(1);
}
console.log('✓ 雷达图检查通过');
