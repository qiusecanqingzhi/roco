/** 快速自检 dom-stub：解析、选择器、事件、outerHTML 替换 */
import { parseHtml, makeNode, query, makeEnv } from './dom-stub.mjs';

let bad = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) bad++; };

console.log('=== parseHtml ===');
const nodes = parseHtml('<div class="a" data-x="1"><span id="s">hi</span><img src="x.png"></div>');
ok(nodes.length === 1, `顶层 1 个节点（实际 ${nodes.length}）`);
ok(nodes[0].tagName === 'DIV', 'tagName 大写');
ok(nodes[0]._classes.has('a'), 'class 解析');
ok(nodes[0].dataset.x === '1', 'dataset 驼峰映射');
ok(nodes[0].children.length === 2, `两个子节点（实际 ${nodes[0].children.length}）`);
ok(nodes[0].children[1].tagName === 'IMG', 'void 标签不吞后续');

console.log('\n=== 选择器 ===');
const root = makeNode('div');
root.innerHTML = `
  <div id="box">
    <button class="nat-btn up on" data-nat-btn="spd" data-nat-kind="up">性格+</button>
    <button class="nat-btn down" data-nat-btn="spd" data-nat-kind="down">性格-</button>
    <input data-nat-iv="spd" value="60">
    <button id="reset">清空</button>
  </div>`;
ok(query(root, '[data-nat-btn]').length === 2, `[data-nat-btn] 命中 2（实际 ${query(root, '[data-nat-btn]').length}）`);
ok(query(root, '[data-nat-kind="down"]').length === 1, '[attr="v"] 精确匹配');
ok(query(root, '.nat-btn.up').length === 1, '复合 .a.b');
ok(query(root, '#reset').length === 1, '#id');
ok(query(root, 'button').length === 3, `tag 命中 3（实际 ${query(root, 'button').length}）`);
ok(query(root, '#box .nat-btn').length === 2, '后代组合');
ok(root.querySelector('[data-nat-iv]').dataset.natIv === 'spd', 'dataset 驼峰 natIv');

console.log('\n=== 事件派发 ===');
let hits = 0;
const btn = root.querySelector('[data-nat-kind="up"]');
btn.addEventListener('click', () => { hits++; });
btn.click();
ok(hits === 1, 'click 能触发监听器');

const inp = root.querySelector('[data-nat-iv]');
let committed = null;
inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') committed = inp.value; });
inp.dispatch('keydown', { key: 'Enter' });
ok(committed === '60', 'keydown 能带 key 触发');

console.log('\n=== outerHTML 替换（app.js 用它重画 #natalBlock）===');
const parent = makeNode('div');
parent.innerHTML = '<div id="natalBlock" data-spirit="1:1">old</div>';
const blk = parent.querySelector('#natalBlock');
blk.outerHTML = '<div id="natalBlock" data-spirit="1:1"><button id="newBtn">新</button></div>';
ok(parent.querySelector('#natalBlock') !== null, '替换后仍能找到 #natalBlock');
ok(parent.querySelector('#newBtn') !== null, '替换后的新内容可查到');
ok(parent.innerHTML.includes('新'), 'innerHTML 已更新');

console.log('\n=== makeEnv + 全局查询 ===');
const env = makeEnv({ withBundle: false });
env.byId.get('app').innerHTML = '<button class="x" data-t="1">A</button><button class="x" data-t="2">B</button>';
ok(env.document.querySelectorAll('.x').length === 2, `document.querySelectorAll 能看到 #app 里的元素（实际 ${env.document.querySelectorAll('.x').length}）`);
ok(env.document.getElementById('app') !== null, 'getElementById 可用');
ok(env.document.querySelector('#app') !== null, 'querySelector #app 可用');

// 事件要能沿 parentNode 冒泡到 document —— app.js 的全局事件委托（点击打开详情、
// 筛选 chip 等）全靠它。起先桩里 document.addEventListener 是空函数，
// 于是"点卡片区空白弹开详情弹窗"这种 bug 在测试里完全暴露不出来（踩过）。
console.log('\n=== 事件冒泡到 document ===');
{
  let got = 0;
  let seenTarget = null;
  env.document.addEventListener('click', (e) => { got++; seenTarget = e.target; });
  const btn = env.document.querySelectorAll('.x')[0];
  btn.click();
  ok(got >= 1, `点 #app 里的元素，document 上的 click 委托收到了（实际 ${got} 次）`);
  ok(seenTarget === btn, 'e.target 是真正被点的那个节点');

  // stopPropagation 要能拦住
  let inner = 0;
  let outer = 0;
  const stopBtn = env.document.querySelectorAll('.x')[1];
  stopBtn.addEventListener('click', (e) => { inner++; e.stopPropagation(); });
  env.document.addEventListener('click', () => { outer++; });
  const beforeInner = inner; const beforeOuter = outer;
  stopBtn.click();
  ok(inner === beforeInner + 1, '元素自己的监听先跑');
  ok(outer === beforeOuter, 'stopPropagation 之后 document 不再收到');

  // closest 要能沿祖先找（委托靠它）
  ok(btn.closest('#app') === env.byId.get('app'), 'closest 能沿祖先找到 #app');
}

console.log(bad === 0 ? '\n✓ dom-stub 自检通过' : `\n✗ ${bad} 项不通过`);
process.exit(bad ? 1 : 0);
