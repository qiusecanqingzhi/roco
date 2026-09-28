/**
 * 测试用的极简 DOM 桩。
 *
 * 为什么需要它：app.js 是给浏览器写的，测试里得有个够用的 DOM。
 * 之前的桩把 querySelectorAll() 写成"永远返回空数组"，于是
 * **所有事件绑定相关的代码其实从没被测到**（只测了渲染出的 HTML 字符串）。
 * 详情页加点面板就吃过这个亏：渲染正确，但 openModal 里忘了绑事件，点了没反应。
 *
 * 这里的做法：
 *   1. 用 parseHtml() 把 innerHTML 解析成一棵真节点树（够用的子集）
 *   2. querySelector/querySelectorAll 走选择器匹配 + 事件可以真的派发
 * 支持的选择器：#id、.class、[attr]、[attr="v"]、tag、以及它们的简单组合。
 */

/* ---------------------------------------------------------- HTML 解析 */

const VOID_TAGS = new Set(['br', 'img', 'input', 'link', 'meta', 'hr', 'source', 'area', 'base', 'col', 'embed', 'track', 'wbr']);

/** 解析一段 HTML，返回节点数组。够用的子集：标签、属性、文本、注释 */
export function parseHtml(html) {
  const root = [];
  // 哨兵栈底：闭合标签循环从下标 1 开始，所以底下的 tag 用空串（不能省，否则 k 会到 0）
  // ⚠ 判断用 tagName（小写存一份），不要用 .tag —— makeNode 里没有 tag 属性，
  //   读 .tag 会永远 undefined，于是闭合标签匹配不到、栈从不弹出，
  //   后续兄弟节点会被塞进前一个节点里（踩过：img 跑进了 span）。
  const stack = [{ children: root, tagName: '' }];
  let i = 0;
  const s = String(html ?? '');

  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { pushText(stack, s.slice(i)); break; }
    if (lt > i) pushText(stack, s.slice(i, lt));

    // 注释
    if (s.startsWith('<!--', lt)) {
      const end = s.indexOf('-->', lt);
      i = end < 0 ? s.length : end + 3;
      continue;
    }
    // 自闭合 / 空元素
    const gt = s.indexOf('>', lt);
    if (gt < 0) { pushText(stack, s.slice(lt)); break; }
    const raw = s.slice(lt + 1, gt);
    const selfClose = raw.endsWith('/');
    const body = selfClose ? raw.slice(0, -1) : raw;

    if (body.startsWith('/')) {                       // 结束标签
      const name = body.slice(1).trim().toLowerCase();
      for (let k = stack.length - 1; k >= 1; k--) {
        if (stack[k].tagName === name.toUpperCase()) {
          stack.length = k;                           // 弹掉该节点，父节点成为当前
          break;
        }
      }
      i = gt + 1;
      continue;
    }

    const m = /^([a-zA-Z][\w-]*)([\s\S]*)$/.exec(body.trim());
    if (!m) { i = gt + 1; continue; }
    const node = makeNode(m[1].toLowerCase(), parseAttrs(m[2]));
    stack[stack.length - 1].children.push(node);
    i = gt + 1;
    if (VOID_TAGS.has(m[1].toLowerCase()) || selfClose) continue;
    stack.push(node);
  }
  return root;
}

function pushText(stack, text) {
  if (!text) return;
  const t = text.trim();
  if (!t) return;
  const node = makeNode('#text', {});
  node.text = t;
  stack[stack.length - 1].children.push(node);
}

/**
 * 递归给整棵子树设 parentNode。
 * ⚠ 必须递归：只设顶层的话，孙节点的 parentNode 是 null，
 *   而 query() 的后代组合选择器（"#box .btn"）要靠它回溯祖先 —— 会查不到（踩过）。
 */
function wireParents(nodes, parent) {
  for (const n of nodes) {
    n.parentNode = parent;
    if (n.children?.length) wireParents(n.children, n);
  }
}

/** 解析属性串，支持 attr、attr="v"、attr='v'、data-x="y" */
function parseAttrs(str) {
  const attrs = {};
  const re = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(str))) {
    const val = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[m[1]] = val;
  }
  return attrs;
}

/* ---------------------------------------------------------- 节点 */

const listeners = new WeakMap();

export function makeNode(tag, attrs = {}) {
  const node = {
    tagName: tag === '#text' ? '#text' : tag.toUpperCase(),
    id: attrs.id ?? '', _attrs: attrs, _classes: new Set((attrs.class ?? '').split(/\s+/).filter(Boolean)),
    children: [], text: '', value: attrs.value ?? '', type: attrs.type ?? '', hidden: 'hidden' in attrs,
    checked: 'checked' in attrs, disabled: 'disabled' in attrs, scrollTop: 0,
    style: {}, dataset: {}, _html: '', parentNode: null,
  };
  node.classList = {
    add: (...c) => c.forEach((x) => node._classes.add(x)),
    remove: (...c) => c.forEach((x) => node._classes.delete(x)),
    contains: (c) => node._classes.has(c),
    toggle: (c, on) => { const v = on ?? !node._classes.has(c); v ? node._classes.add(c) : node._classes.delete(c); return v; },
  };
  // innerHTML 走"按需序列化"而不是缓存字符串：
  // 因为 outerHTML 替换子节点后，父节点缓存的字符串会变陈旧（踩过）。
  // set 时必须给每个子节点设 parentNode —— query() 的后代组合选择器靠它回溯祖先，
  // 漏了就会出现 "#box .btn" 匹配不到（踩过）。
  Object.defineProperty(node, 'innerHTML', {
    get: () => serializeChildren(node),
    set: (v) => {
      node._html = String(v);
      node.children = parseHtml(v);
      wireParents(node.children, node);
    },
  });
  // 改 outerHTML 相当于让父节点用新内容替换自己（app.js 用它重画 #natalBlock）
  Object.defineProperty(node, 'outerHTML', {
    get: () => serialize(node),
    set: (v) => {
      const parsed = parseHtml(v)[0] ?? makeNode('div', {});
      node.tagName = parsed.tagName; node.id = parsed.id; node._attrs = parsed._attrs;
      node._classes = parsed._classes; node.classList = parsed.classList;
      node.dataset = parsed.dataset; node._html = parsed._html;
      node.children = parsed.children;
      wireParents(node.children, node);
    },
  });
  // dataset：把 data-* 属性映射成驼峰
  node.dataset = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('data-')) {
      const key = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      node.dataset[key] = v;
    }
  }
  node.getAttribute = (k) => (k in node._attrs ? node._attrs[k] : (k === 'class' ? [...node._classes].join(' ') : null));
  node.setAttribute = (k, v) => { node._attrs[k] = String(v); if (k === 'id') node.id = String(v); if (k === 'class') node._classes = new Set(String(v).split(/\s+/).filter(Boolean)); };
  node.removeAttribute = (k) => { delete node._attrs[k]; };
  node.appendChild = (c) => { c.parentNode = node; node.children.push(c); return c; };
  // 把一棵子树挂到自己名下（递归设 parentNode，后代组合选择器要用）
  node.adopt = (child) => {
    if (!child) return;
    child.parentNode = node;
    node.children.push(child);
  };
  node.addEventListener = (ev, fn) => { const map = listeners.get(node) ?? {}; (map[ev] ??= []).push(fn); listeners.set(node, map); };
  node.removeEventListener = () => {};
  node.dispatch = (ev, extra = {}) => {
    const map = listeners.get(node) ?? {};
    for (const fn of map[ev] ?? []) fn({ target: node, currentTarget: node, preventDefault() {}, stopPropagation() {}, key: extra.key, ...extra });
  };
  node.click = () => node.dispatch('click');
  node.focus = () => { docRef?.setActive?.(node); };
  node.blur = () => {};
  node.setSelectionRange = () => {};
  node.contains = (o) => o === node || node.children.some((c) => c.contains?.(o));
  node.closest = (sel) => { let p = node; while (p) { if (matches(p, sel)) return p; p = p.parentNode; } return null; };
  node.querySelector = (sel) => query(node, sel)[0] ?? null;
  node.querySelectorAll = (sel) => query(node, sel);
  return node;
}

let docRef = null;

/* ---------------------------------------------------------- 序列化 */

const escapeAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escapeText = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** 把节点序列化回 HTML 字符串（属性顺序按 _attrs 的插入顺序） */
export function serializeChildren(node) {
  return (node.children ?? []).map(serialize).join('');
}

export function serialize(node) {
  if (!node) return '';
  // 注意：文本节点的 tagName 存的是大写 '#TEXT'，这里要比小写（踩过：
  // 判断写成 '#text' 会让文本被当成标签，序列化成 <#text></#text>）
  if (node.tagName === '#TEXT' || node.tagName === '#text') return escapeText(node.text ?? '');
  const tag = node.tagName.toLowerCase();
  const attrs = { ...(node.id ? { id: node.id } : {}), ...(node._classes?.size ? { class: [...node._classes].join(' ') } : {}), ...node._attrs };
  delete attrs.id; delete attrs.class;
  const attrStr = Object.entries({ ...(node.id ? { id: node.id } : {}), ...(node._classes?.size ? { class: [...node._classes].join(' ') } : {}), ...node._attrs })
    .filter(([k]) => k !== 'id' && k !== 'class')
    .concat(node.id ? [['id', node.id]] : [])
    .concat(node._classes?.size ? [['class', [...node._classes].join(' ')]] : [])
    .map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${escapeAttr(v)}"`))
    .join('');
  if (VOID_TAGS.has(tag)) return `<${tag}${attrStr}>`;
  return `<${tag}${attrStr}>${serializeChildren(node)}</${tag}>`;
}

/* ---------------------------------------------------------- 选择器 */

function descendants(node, out = []) {
  for (const c of node.children ?? []) { out.push(c); descendants(c, out); }
  return out;
}

function matches(node, sel) {
  sel = sel.trim();
  if (!sel) return false;
  // 只支持末段（前面的空格/组合在 query 里已处理）
  const tagM = /^([a-zA-Z][\w-]*)?/.exec(sel)[1];
  let rest = sel.slice(tagM ? tagM.length : 0);
  if (tagM && node.tagName !== tagM.toUpperCase()) return false;

  while (rest) {
    let m;
    if ((m = /^#([\w-]+)/.exec(rest))) { if (node.id !== m[1]) return false; rest = rest.slice(m[0].length); continue; }
    if ((m = /^\.([\w-]+)/.exec(rest))) { if (!node._classes?.has(m[1])) return false; rest = rest.slice(m[0].length); continue; }
    if ((m = /^\[([\w-]+)(?:="([^"]*)")?\]/.exec(rest))) {
      const key = m[1].replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const val = node.dataset?.[key] ?? node._attrs?.[m[1]];
      if (m[2] === undefined) { if (val === undefined || val === null) return false; }
      else if (String(val ?? '') !== m[2]) return false;
      rest = rest.slice(m[0].length); continue;
    }
    return false;
  }
  return true;
}

/** 在节点子树里按选择器查找（支持逗号分隔、后代组合用空格）
 *  注意：根节点自身也算候选（否则 query(node, '#node') 会返回空）。 */
export function query(root, sel) {
  const parts = String(sel).split(',').map((x) => x.trim()).filter(Boolean);
  const all = [root, ...descendants(root)];
  const out = [];
  for (const p of parts) {
    const steps = p.split(/\s+/).filter(Boolean);
    const last = steps[steps.length - 1];
    for (const n of all) {
      if (!matches(n, last)) continue;
      // 逐级校验祖先
      let ok = true;
      let cur = n.parentNode ?? null;
      for (let k = steps.length - 2; k >= 0 && ok; k--) {
        let found = false;
        while (cur) {
          if (matches(cur, steps[k])) { found = true; cur = cur.parentNode ?? null; break; }
          cur = cur.parentNode ?? null;
        }
        if (!found) ok = false;
      }
      if (ok) out.push(n);
    }
  }
  return out;
}

/* ---------------------------------------------------------- 环境 */

/**
 * 造一个全局环境（window/document），供 vm 里跑 app.js。
 * withBundle=true 时注入 window.ROCO_DATA（等价于 file:// 双击场景）。
 */
export function makeEnv({ withBundle = true, bundle, fetchImpl } = {}) {
  const byId = new Map();
  const make = (tag, id) => { const n = makeNode(tag, id ? { id } : {}); if (id) byId.set(id, n); return n; };
  for (const [tag, id] of [
    ['main', 'app'], ['div', 'modal'], ['div', 'modalBody'], ['nav', 'tabs'], ['input', 'globalSearch'],
    ['button', 'themeBtn'], ['div', 'toast'], ['span', 'statLine'], ['div', 'searchSuggest'], ['div', 'searchWrap'],
  ]) make(tag, id);
  // app.js 里 openModal 会取 .modal-panel 设 scrollTop，桩里得有这个节点
  const modalPanel = makeNode('div', { class: 'modal-panel' });
  byId.get('modal').children.push(modalPanel);
  modalPanel.parentNode = byId.get('modal');
  modalPanel.children.push(byId.get('modalBody'));
  byId.get('modalBody').parentNode = modalPanel;

  const document = {
    body: makeNode('body'), documentElement: makeNode('html'), activeElement: null,
    getElementById: (id) => byId.get(id) ?? null,
    querySelector: (sel) => (String(sel).startsWith('#') && !String(sel).includes(' ') && !String(sel).includes(',')
      ? byId.get(String(sel).slice(1)) ?? null
      : query(makeNode('html'), sel)[0] ?? null),
    querySelectorAll: (sel) => query(makeNode('html'), sel),
    createElement: (t) => makeNode(t),
    addEventListener: () => {}, removeEventListener: () => {},
  };
  document.setActive = (n) => { document.activeElement = n; };
  docRef = document;

  const win = {
    ROCO_DATA: null, location: { hash: '#/spirits', pathname: '/', search: '' },
    localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener: () => {}, removeEventListener: () => {},
    navigator: { clipboard: { writeText: async () => {} } },
    setTimeout, clearTimeout, requestAnimationFrame: (f) => setTimeout(f, 0),
  };
  if (withBundle && bundle) win.ROCO_DATA = bundle;

  // 让 document.querySelector(All) 能在整个 document 里找。
  // 关键：必须把顶层元素真的挂进 virtualRoot.children —— 只设 parentNode
  // 是不够的，因为 query() 是顺着 children 向下遍历的（踩过）。
  const virtualRoot = makeNode('html');
  for (const n of byId.values()) {
    if (n.parentNode) continue;
    n.parentNode = virtualRoot;
    virtualRoot.children.push(n);
  }
  document.querySelectorAll = (sel) => query(virtualRoot, sel);
  document.querySelector = (sel) => {
    if (String(sel).startsWith('#') && !String(sel).includes(' ')) return byId.get(String(sel).slice(1)) ?? null;
    return query(virtualRoot, sel)[0] ?? null;
  };

  const errors = [];
  const sandbox = {
    window: win, document, location: win.location, localStorage: win.localStorage,
    navigator: win.navigator, HTMLImageElement: class {},
    console: { log() {}, warn() {}, error: (...a) => errors.push(a.join(' ')) },
    setTimeout, clearTimeout, fetch: fetchImpl ?? (() => Promise.reject(new Error('no fetch'))),
    requestAnimationFrame: win.requestAnimationFrame,
    Error, JSON, Math, Date, Number, String, Object, Array, Set, Map, Promise, RegExp, isNaN, parseInt, parseFloat, Boolean, Symbol, WeakMap, URL,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  return { sandbox, window: win, document, byId, errors, root: virtualRoot };
}

/** 造一个 app.js 用的元素（给需要先造节点再塞进树里的场景）*/
export const makeEl = (tag = 'div', attrs = {}) => makeNode(tag, attrs);
