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

console.log(bad === 0 ? '\n✓ dom-stub 自检通过' : `\n✗ ${bad} 项不通过`);
process.exit(bad ? 1 : 0);
