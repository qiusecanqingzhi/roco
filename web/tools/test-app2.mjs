/**
 * 第二轮测试：筛选逻辑、详情弹窗、以及「没有 data-bundle.js 时走 data/*.json」的加载路径。
 * 用法: node web/tools/test-app2.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const ok = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { problems.push(msg); console.log('  ✗ ' + msg); } };

/* ---------------------------------------------------------- DOM 桩 */
function makeEl(tag = 'div', id = '') {
  return {
    tagName: tag.toUpperCase(), id, _html: '', textContent: '', hidden: false, dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    value: '', checked: false,
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    setAttribute() {}, getAttribute() { return null; }, focus() {}, scrollTop: 0, setSelectionRange() {},
    addEventListener() {}, closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
  };
}

function makeEnv({ withBundle, fetchImpl }) {
  const byId = new Map(['app', 'modal', 'modalBody', 'toast', 'searchSuggest', 'statLine', 'tabs', 'globalSearch', 'themeBtn']
    .map((i) => [i, makeEl('div', i)]));
  const document = {
    body: makeEl('body'), documentElement: { dataset: {} }, activeElement: null,
    querySelector: (s) => (s.startsWith('#') ? byId.get(s.slice(1)) ?? null : makeEl('div')),
    querySelectorAll: () => [], addEventListener() {}, createElement: (t) => makeEl(t),
  };
  let hash = '#/spirits';
  const hashListeners = [];
  const location = { get hash() { return hash; }, set hash(v) { hash = v; hashListeners.forEach((f) => f()); } };
  const window = { ROCO_DATA: null, addEventListener(t, f) { if (t === 'hashchange') hashListeners.push(f); }, location };
  const sandbox = {
    window, document, location,
    localStorage: { getItem: () => null, setItem() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout,
    fetch: fetchImpl ?? (() => Promise.reject(new Error('no fetch'))),
    HTMLImageElement: class {}, Error, JSON, Math, Date, Number, String, Object, Array, Set, Map, Promise, RegExp, isNaN, parseInt,
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  if (withBundle) vm.runInContext(fs.readFileSync(path.join(WEB, 'data-bundle.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(WEB, 'app.js'), 'utf8'), ctx);
  return { ctx, byId, window };
}

/* ============================================================
   1) 筛选 / 详情逻辑（有 bundle）
   ============================================================ */
console.log('· 加载方式 A：data-bundle.js');
const A = makeEnv({ withBundle: true });
await new Promise((r) => setTimeout(r, 60));
const api = A.window.__roco;
ok(!!api, 'app.js 暴露了 window.__roco 测试钩子');
if (!api) { console.log('  无法继续'); process.exit(1); }

const F = api.STATE.filters.spirits;
ok(api.filterSpirits().length === 466, `默认筛选出 466 个默认形态`);

F.types.add(3); // 草系
const grass = api.filterSpirits();
ok(grass.length > 0 && grass.every((s) => s.types.includes(3)), `按草系筛选：${grass.length} 个，且全部含草系`);
F.types.clear();

F.q = '果实';
const named = api.filterSpirits();
ok(named.length >= 1 && named.every((s) => s.name.includes('果实')), `按名称搜索"果实"：${named.length} 个`);
F.q = '';

F.forms = true;
const all = api.filterSpirits();
ok(all.length === 621, `勾选"显示其它形态"后 621 条（含 155 形态）`);
F.forms = false;

// 排序：种族值降序后第一条应是最大值
F.sort = 'bst'; F.dir = -1;
const byBst = api.filterSpirits();
const maxBst = Math.max(...api.STATE.data.spirits.filter((s) => s.formId === 1).map((s) => s.bst));
ok(byBst[0].bst === maxBst, `按种族值降序，首位 ${byBst[0].name} ${byBst[0].bst}（最大值 ${maxBst}）`);
F.sort = 'id'; F.dir = 1;

// 技能筛选
const SK = api.STATE.filters.skills;
SK.cats.add('状态');
const states = api.filterSkills();
ok(states.length > 0 && states.every((s) => s.cat === '状态'), `按分类筛选"状态"：${states.length} 个`);
SK.cats.clear();
SK.minDmg = '100';
const strong = api.filterSkills();
ok(strong.length > 0 && strong.every((s) => (s.dmgMax ?? 0) >= 100), `威力≥100：${strong.length} 个`);
SK.minDmg = '';
ok(api.filterSkills().length === 579, '清除筛选后 579 个技能');

// 详情弹窗（直接调用，检查生成的 HTML）
console.log('\n· 详情弹窗内容');
api.spiritDetail('466:1');
const sd = A.byId.get('modalBody').innerHTML;
ok(/果实立方人/.test(sd), '精灵详情含名称');
ok(/种族值总和/.test(sd) && /class="bar s-hp"/.test(sd), '精灵详情含种族值条形图');
ok(/升级学会/.test(sd) && /data-skill="/.test(sd), '精灵详情含技能表');
ok(/assets\//.test(sd), '精灵详情图片走本地路径');

const sk466 = api.spiritSkillsOf(api.STATE.bySpirit.get('466:1'));
ok(sk466.level.length === 13, `果实立方人升级技能 13 个（实际 ${sk466.level.length}）`);
ok(sk466.level[0].lv <= sk466.level[1].lv, '升级技能按解锁等级升序');

const first = sk466.level[0];
api.skillDetail(first.id, '466:1');
const kd = A.byId.get('modalBody').innerHTML;
ok(new RegExp(first.name).test(kd), `技能详情含技能名「${first.name}」`);
ok(/可学精灵/.test(kd) && /升级学会/.test(kd), '技能详情含可学精灵分组');
const learners = api.learnersOf(first.id);
ok(learners.length > 0, `技能「${first.name}」可学精灵 ${learners.length} 条`);

// 进化/形态链
api.spiritDetail('1:5');
const formDetail = A.byId.get('modalBody').innerHTML;
ok(/圣水迪莫/.test(formDetail), '形态详情显示形态名（圣水迪莫）');
ok((formDetail.match(/data-spirit="1:/g) || []).length >= 5, '形态链列出同编号的 5 个形态');

// ---- 富文本标记渲染（<desc_id=…>术语 与 <span fork_road="or">） ----
console.log('\n· 描述里的术语标记渲染');
api.skillDetail(7020450); // 突袭：造成魔伤，<desc_id=1015>应对状态</>：…
const tuxi = A.byId.get('modalBody').innerHTML;
ok(!/<desc_id=/.test(tuxi), '技能详情里不再出现 <desc_id=…> 原文');
ok(!/<\/>/.test(tuxi), '技能详情里不再出现 </> 原文');
ok(/class="dterm linked"[^>]*data-glossary="1015"/.test(tuxi), '术语渲染成可点标签（data-glossary=1015）');
ok(/应对状态/.test(tuxi), '保留了术语文字「应对状态」');

api.skillDetail(7150360); // 试飞：含 <span fork_road="or">或</>
const shifei = A.byId.get('modalBody').innerHTML;
ok(!/fork_road/.test(shifei), 'fork_road 标记不残留');
ok(/class="dfork">或</.test(shifei), 'fork_road 渲染成连接词「或」');

api.spiritDetail('30:1'); // 恶魔叮：被动里含 <desc_id=1029>吸血</>
const passive = A.byId.get('modalBody').innerHTML;
ok(!/<desc_id=/.test(passive), '被动技能描述里的标记也不残留');
ok(/吸血/.test(passive), '被动描述保留术语文字');

// 全量扫描：详情页里所有技能行都不应出现裸标记
let rawTagCount = 0;
for (const s of api.STATE.data.skills.slice(0, 40)) {
  api.skillDetail(s.id);
  if (/<desc_id=|<\/>|fork_road/.test(A.byId.get('modalBody').innerHTML)) rawTagCount++;
}
ok(rawTagCount === 0, `抽查 40 个技能详情，无一处残留裸标记（实际 ${rawTagCount}）`);

/* ============================================================
   2) 没有 bundle 时的 data/*.json 加载路径
   ============================================================ */
console.log('\n· 加载方式 B：data/*.json（托管场景，无 bundle）');
const fetchImpl = async (url) => {
  const file = path.join(WEB, url);
  if (!fs.existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
};
const B = makeEnv({ withBundle: false, fetchImpl });
await new Promise((r) => setTimeout(r, 120));
const bApp = B.byId.get('app').innerHTML;
ok(!/数据加载失败/.test(bApp), '未出现加载失败提示');
ok(/精灵图鉴/.test(bApp), '通过 JSON 分片也渲染出精灵图鉴');
ok((bApp.match(/class="card"/g) || []).length === 466, 'JSON 分片路径下卡片数一致（466）');
ok(!!B.window.__roco, 'JSON 分片路径下钩子同样可用');

// 分片列表必须覆盖所有导出文件 —— 曾经漏了 spirit-bloodlines.json，
// 导致托管（分片）模式下血脉区块空白，而 file://（bundle）模式正常。
const bApi = B.window.__roco;
ok((bApi.STATE.data.spiritBloodlines && Object.keys(bApi.STATE.data.spiritBloodlines).length) === 621,
  `分片模式也载入了血脉数据（${Object.keys(bApi.STATE.data.spiritBloodlines || {}).length} 个键）`);
bApi.spiritDetail('466:1');
const bDetail = B.byId.get('modalBody').innerHTML;
ok(/血脉技能/.test(bDetail), '分片模式下详情能渲染血脉区块');
ok(/class="bl-icon"/.test(bDetail), '分片模式下血脉图标正常');

console.log('');
if (problems.length) {
  console.log(`✗ ${problems.length} 项不通过:`);
  problems.forEach((p) => console.log('   - ' + p));
  process.exit(1);
}
console.log('✓ 全部通过');
