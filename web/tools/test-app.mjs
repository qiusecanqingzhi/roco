/**
 * 无浏览器环境下验证网页逻辑：用最小 DOM 桩真正执行 web/app.js，
 * 逐个视图渲染并断言内容，同时校验所有本地图片路径都真实存在。
 *
 * 用法: node web/tools/test-app.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const WEB = path.resolve('web');
const problems = [];
const ok = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { problems.push(msg); console.log('  ✗ ' + msg); } };

/* ---------------------------------------------------------- DOM 桩 */
function makeEl(tag = 'div', id = '') {
  const el = {
    tagName: tag.toUpperCase(), id, _html: '', textContent: '', hidden: false,
    dataset: {}, style: {}, classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    value: '', checked: false, children: [],
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    setAttribute() {}, getAttribute() { return null; }, focus() {}, scrollTop: 0,
    setSelectionRange() {}, addEventListener() {}, closest() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
  return el;
}

const byId = new Map();
for (const id of ['app', 'modal', 'modalBody', 'toast', 'searchSuggest', 'statLine', 'tabs', 'globalSearch', 'themeBtn']) {
  byId.set(id, makeEl('div', id));
}
const body = makeEl('body');
const docListeners = {};
const document = {
  body,
  documentElement: { dataset: {} },
  activeElement: null,
  querySelector(sel) {
    if (sel.startsWith('#')) return byId.get(sel.slice(1)) ?? null;
    if (sel === '.modal-panel') return makeEl('div');
    if (sel === 'body') return body;
    return null;
  },
  querySelectorAll(sel) {
    if (sel === '#tabs a') return [];
    return [];
  },
  addEventListener(type, fn) { (docListeners[type] ??= []).push(fn); },
  createElement: (t) => makeEl(t),
};

let hash = '#/spirits';
const hashListeners = [];
const location = { get hash() { return hash; }, set hash(v) { hash = v; hashListeners.forEach((f) => f()); } };
const window = { ROCO_DATA: null, addEventListener(type, fn) { if (type === 'hashchange') hashListeners.push(fn); }, location };
const localStorage = { _m: new Map(), getItem(k) { return this._m.get(k) ?? null; }, setItem(k, v) { this._m.set(k, v); } };
const navigator = { clipboard: { writeText: async () => {} } };

const sandbox = {
  window, document, location, localStorage, navigator, console,
  setTimeout, clearTimeout, fetch: () => Promise.reject(new Error('file:// 下不应触发 fetch')),
  HTMLImageElement: class {}, Error, JSON, Math, Date, Number, String, Object, Array, Set, Map, Promise, RegExp, isNaN, parseInt,
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

/* ---------------------------------------------------------- 执行 */
console.log('· 载入 data-bundle.js 与 app.js');
vm.runInContext(fs.readFileSync(path.join(WEB, 'data-bundle.js'), 'utf8'), ctx, { filename: 'data-bundle.js' });

// 先把 bundle 里的数据挂到 window 上（bundle 里是 window.ROCO_DATA=...）
ok(!!window.ROCO_DATA, 'data-bundle.js 提供 window.ROCO_DATA');
const D = window.ROCO_DATA;
ok(D && D.spirits?.length === 621, `bundle 里精灵 ${D?.spirits?.length} 条`);
ok(D && D.skills?.length === 579, `bundle 里技能 ${D?.skills?.length} 条`);

// app.js 是 IIFE + 顶层 await，执行后会自己 boot()；等待微任务结束
const appSrc = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
try {
  vm.runInContext(appSrc, ctx, { filename: 'app.js' });
} catch (e) {
  problems.push('app.js 执行抛错: ' + e.message);
  console.log('  ✗ app.js 执行抛错: ' + e.stack);
}
await new Promise((r) => setTimeout(r, 50));

/* ---------------------------------------------------------- 断言 */
const app = byId.get('app');
const html = () => app.innerHTML;

console.log('\n· 视图渲染');
const viewOf = (h) => ({ spirits: '精灵图鉴', skills: '技能库', types: '系别克制', glossary: '术语' }[h]);

// 精灵图鉴
ok(!/正在加载数据/.test(html()), '启动后离开 loading 状态');
ok(/精灵图鉴/.test(html()), '渲染出「精灵图鉴」页');
const cards = (html().match(/class="card"/g) || []).length;
ok(cards === 466, `默认形态卡片 ${cards} 张（应为 466）`);
ok(/data-spirit="466:1"/.test(html()), '包含果实立方人 #466');
ok(/果实立方人/.test(html()), '卡片显示中文名');
ok(/tbadge/.test(html()), '系别徽章已渲染');
// imgTag 会先输出 class 再输出 src，所以按 <img ...> 整段取 src
const imgSrcs = [...html().matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]).filter(Boolean);
ok(imgSrcs.length > 0 && imgSrcs.every((s) => s.startsWith('assets/')), `卡片图片走本地路径（${imgSrcs.length} 张）`);

// 切换视图（「推荐队伍」已按需求从页面移除，数据仍保留在 web/data/teams.json）
for (const [h, label] of [['#/skills', '技能库'], ['#/types', '系别克制'], ['#/glossary', '术语']]) {
  location.hash = h;
  const body = html();
  ok(body.includes(label), `切到 ${h} 渲染「${label}」`);
  if (h === '#/skills') {
    const rows = (body.match(/data-skill="/g) || []).length;
    ok(rows === 579, `技能表 ${rows} 行（应为 579）`);
  }
  if (h === '#/types') {
    // 只数矩阵里的 <td class="mx...">，图例用的是 <b class="mx...">
    const cells = (body.match(/<td class="mx/g) || []).length;
    ok(cells === 324, `克制矩阵 ${cells} 格（应为 324 = 18×18）`);
  }
  if (h === '#/glossary') {
    ok((body.match(/class="gitem"/g) || []).length === 54, '术语条目 54 条');
  }
}

// 队伍页已移除：旧书签访问 #/teams 应回退到默认视图，不能白屏
location.hash = '#/teams';
const fallback = html();
ok(!/推荐队伍/.test(fallback), '页面里已无「推荐队伍」');
ok(/精灵图鉴/.test(fallback), '访问 #/teams 回退到精灵图鉴（不是白屏）');

// 回到精灵页并测试筛选逻辑（通过重新渲染 + 直接调用点击处理器较麻烦，这里验证数据层）
location.hash = '#/spirits';
ok(/精灵图鉴/.test(html()), '切回精灵图鉴');

/* ------------------------------------------------- 图片路径全部存在 */
console.log('\n· 图片路径校验');
const missing = [];
const blank = [];
const check = (rel, what) => {
  if (!rel) { blank.push(what); return; }          // 空值也要抓出来，不能跳过
  if (!fs.existsSync(path.join(WEB, rel))) missing.push(rel);
};
for (const s of D.spirits) { check(s.head, `spirit#${s.id}:${s.formId} head`); check(s.img, `spirit#${s.id} img`); check(s.portrait, `spirit#${s.id} portrait`); }
for (const s of D.skills) check(s.img, `skill#${s.id} img`);
for (const t of D.meta.types) check(t.icon, `type#${t.id} icon`);
ok(blank.length === 0, `图片字段没有空值（空 ${blank.length} 个${blank.length ? '：' + blank.slice(0, 3).join(', ') : ''}）`);
ok(missing.length === 0, `引用的本地图片都存在（缺失 ${missing.length} 个${missing.length ? '：' + missing.slice(0, 3).join(', ') : ''}）`);
ok((D.spirits.find((s) => s.id === 1 && s.formId === 1)?.head || '').startsWith('assets/'), '样例精灵的 head 指向本地 assets/');

// data/ 下的 JSON 也应完整（托管时用）
// 页面按需加载的分片（teams 已不在页面里，故不列入；文件仍在 web/data/ 下）
const need = ['meta', 'spirits', 'skills', 'matchups', 'glossary', 'spirit-skills', 'skill-learners', 'spirit-bloodlines'];
const missJson = need.filter((n) => !fs.existsSync(path.join(WEB, 'data', n + '.json')));
ok(missJson.length === 0, `web/data/*.json 齐备（缺 ${missJson.length} 个）`);

/* ------------------------------------------------------ 汇总 */
console.log('');
if (problems.length) {
  console.log(`✗ ${problems.length} 项不通过:`);
  problems.forEach((p) => console.log('   - ' + p));
  process.exit(1);
}
console.log('✓ 全部通过');
