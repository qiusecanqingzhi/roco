/** 核对新布局：结果区提到顶部、两侧各一张伤害技能表（含血脉） */
import fs from 'node:fs';
import vm from 'node:vm';
import { makeEnv } from '../web/tools/dom-stub.mjs';

const bs = fs.readFileSync('web/data-bundle.js', 'utf8');
const bundle = JSON.parse(bs.replace(/^window\.ROCO_DATA\s*=\s*/, '').replace(/;\s*$/, ''));
const env = makeEnv({ withBundle: true, bundle });
vm.createContext(env.sandbox);
vm.runInContext(bs, env.sandbox);
vm.runInContext(fs.readFileSync('web/app.js', 'utf8'), env.sandbox);
await new Promise((r) => setTimeout(r, 80));
const api = env.window.__roco;
const A2 = api.STATE;
const t = (el) => (el ? el.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '');

A2.view = 'calc';
A2.calc.a = '20:1'; A2.calc.b = '43:1'; A2.calc.skillA = 7150060;
A2.calc.skillB = null;
A2.calc.statusA = { picks: [], star: 0, layers: {} };
A2.calc.statusB = { picks: [], star: 0, layers: {} };
api.fillLoadoutWithTop('a', A2.bySpirit.get('20:1'), A2.bySpirit.get('43:1'), 4);
api.fillLoadoutWithTop('b', A2.bySpirit.get('43:1'), A2.bySpirit.get('20:1'), 4);
env.byId.get('app').innerHTML = '';
api.render();
const app = env.byId.get('app');

console.log('=== 页面结构顺序 ===');
const panel = app.querySelector('.calc-panel');
for (const child of panel.children) {
  const cls = [...child._classes].join('.');
  const kids = [...child._classes].length ? '' : '';
  console.log('  ' + child.tagName.toLowerCase() + '.' + cls + kids);
}

console.log('\n=== 卡片区里还有没有结果块（应该没有）===');
const sides = [...app.querySelectorAll('.calc-side')];
console.log('  .calc-side 个数:', sides.length);
for (const s of sides) {
  console.log('   含 .calc-result:', !!s.querySelector('.calc-result'), ' 含 .calc-skill-table:', !!s.querySelector('.calc-skill-table'));
}

console.log('\n=== 顶部结果区 ===');
const results = [...app.querySelectorAll('.calc-results .calc-col')];
console.log('  结果列数:', results.length);
for (const r of results) {
  console.log('   ', t(r.querySelector('.calc-who')), '->', t(r.querySelector('.calc-out')) || '(未选技能)');
}

console.log('\n=== 底部两侧技能表 ===');
const tables = [...app.querySelectorAll('.calc-skill-table')];
console.log('  表数:', tables.length);
for (const tb of tables) {
  const rows = tb.querySelectorAll('tbody tr');
  const blood = tb.innerHTML.match(/class="tag blood"/g)?.length ?? 0;
  const legend = tb.innerHTML.match(/class="tag legend"/g)?.length ?? 0;
  const machine = tb.innerHTML.match(/class="tag machine"/g)?.length ?? 0;
  console.log(`  ${t(tb.querySelector('h3'))}`);
  console.log(`    行数 ${rows.length}，血脉 ${blood}，传说 ${legend}，技能石 ${machine}`);
  for (const r of [...rows].slice(0, 5)) {
    const c = r.querySelectorAll('td');
    console.log('     ', [t(c[1]), t(c[2]), t(c[3]), t(c[4]), t(c[5])].join('  |  '));
  }
}

console.log('\n=== 点一行能否设为当前技能 ===');
{
  const first = app.querySelector('.calc-skill-table[data-skill-table="b"] tbody tr');
  const id = first.dataset.calcPick;
  first.click();
  console.log('  点击技能 id', id, '-> calc.skillB =', A2.calc.skillB);
}
