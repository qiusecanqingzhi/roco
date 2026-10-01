/** 验证星陨层数上限 99 与两处输入框同步 */
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
let bad = 0;
const ck = (c, label, extra = '') => { if (!c) bad++; console.log(`  ${c ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`); };

A2.view = 'calc';
A2.calc.a = '20:1'; A2.calc.b = '43:1'; A2.calc.skillA = 7150060;
A2.calc.statusB = { picks: ['starfall-mark'], star: 0, layers: { 'starfall-mark': 0 } };
env.byId.get('app').innerHTML = '';
api.render();

const app = () => env.byId.get('app');
const starBox = () => app().querySelector('[data-st-star="b"]');
const rowBox = () => app().querySelector('[data-st-layers="b:starfall-mark"]');
const pw = () => api.statusDamageOf('b', A2.bySpirit.get('43:1'),
  { attacker: A2.bySpirit.get('20:1'), skill: A2.bySkill.get(7150060) }).rows[0].power;

console.log('① 上限是 99（不是 9）');
ck(starBox().max === '99' || starBox().getAttribute('max') === '99', '「星陨层数」输入框 max = 99', `实际 ${starBox().max || starBox().getAttribute('max')}`);
ck(rowBox().max === '99' || rowBox().getAttribute('max') === '99', '状态伤害那行的层数 max = 99', `实际 ${rowBox().max || rowBox().getAttribute('max')}`);

console.log('\n② 两处输入框同步（同一份真值）');
{
  const a = starBox();
  a.value = '40'; a.dispatch('change');
  ck(A2.calc.statusB.star === 40, `在「星陨层数」填 40 -> star = ${A2.calc.statusB.star}`);
  ck(rowBox().value === '40' || Number(rowBox().value) === 40, `状态伤害那行跟着显示 ${rowBox().value}`);
  ck(pw() === 40 * 40 + 24 * 40 - 24, `40 层威力 = ${pw()}`);

  const b = rowBox();
  b.value = '99'; b.dispatch('change');
  ck(A2.calc.statusB.star === 99, `在状态伤害那行填 99 -> star = ${A2.calc.statusB.star}`);
  ck(Number(starBox().value) === 99, `「星陨层数」跟着显示 ${starBox().value}`);
  ck(pw() === 99 * 99 + 24 * 99 - 24, `99 层威力 = ${pw()}`);

  // 超上限被夹到 99
  const c = starBox();
  c.value = '500'; c.dispatch('change');
  ck(A2.calc.statusB.star === 99, `填 500 被夹到 ${A2.calc.statusB.star}`);
  // 负数被夹到 0
  const d = starBox();
  d.value = '-5'; d.dispatch('change');
  ck(A2.calc.statusB.star === 0, `填 -5 被夹到 ${A2.calc.statusB.star}`);
}

console.log('\n③ 大层数的威力');
{
  const p = (n) => { A2.calc.statusB.star = n; return api.starfallPower(n); };
  ck(p(40) === 2536, `40 层 = ${p(40)}`);
  ck(p(60) === 5016, `60 层 = ${p(60)}`);
  ck(p(99) === 12153, `99 层 = ${p(99)}`);
}

console.log('\n④ 连击数上限仍是 9（没被误改）');
{
  const hit = app().querySelector('[data-lo-hit]');
  ck(!!hit && (hit.max === '9' || hit.getAttribute('max') === '9'), '四技能槽的连击数 max = 9');
}

console.log(bad ? `\n✗ ${bad} 项不通过` : '\n✓ 层数上限与同步全部正确');
process.exit(bad ? 1 : 0);
