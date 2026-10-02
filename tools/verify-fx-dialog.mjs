/** 验证弹窗内的开关/二选一/手填真的可用（走 document 委托） */
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
api.fillLoadoutWithTop('a', A2.bySpirit.get('20:1'), A2.bySpirit.get('43:1'), 4);
api.fillLoadoutWithTop('b', A2.bySpirit.get('43:1'), A2.bySpirit.get('20:1'), 4);

const render = () => { env.byId.get('app').innerHTML = ''; api.render(); };
const app = () => env.byId.get('app');
const effIds = new Set(Object.keys(api.SKILL_EFFECTS).map(Number));
const sA = api.usableSkillsOf(A2.bySpirit.get('20:1')).find((x) => effIds.has(x.id));

console.log('① 打开弹窗（点一次就开，不会自己被关掉）');
{
  A2.calc.fx = {}; A2.calc.fxOpen = {};
  render();
  const btn = app().querySelector(`[data-fx-open="${sA.id}"]`);
  btn.click();
  ck(!!app().querySelector('.fx-modal'), '点一次就出现弹窗');
  ck(A2.calc.fxOpen.a === String(sA.id), `fxOpen = ${JSON.stringify(A2.calc.fxOpen)}`);
  // 再点一次关闭
  app().querySelector(`[data-fx-open="${sA.id}"]`).click();
  ck(!app().querySelector('.fx-modal'), '再点一次关闭');
  // 第三次打开，后面继续用它
  app().querySelector(`[data-fx-open="${sA.id}"]`).click();
  ck(!!app().querySelector('.fx-modal'), '第三次又能打开');
}

console.log('\n② 弹窗里的「生效开关」');
{
  ck(A2.calc.fx[`on:${sA.id}`] !== 1, '初始未生效');
  app().querySelector('.fx-modal [data-fx-toggle]').click();
  ck(A2.calc.fx[`on:${sA.id}`] === 1, '点一次 -> 生效');
  const t = app().querySelector('.fx-modal [data-fx-toggle]').innerHTML;
  ck(/已生效/.test(t), `按钮文案变成「已生效」（实际 ${t}）`);
  // 再点一次回到未生效
  app().querySelector('.fx-modal [data-fx-toggle]').click();
  ck(A2.calc.fx[`on:${sA.id}`] === 0, '再点一次 -> 未生效');
}

console.log('\n③ 卡片上的按钮状态跟着变');
{
  app().querySelector('.fx-modal [data-fx-toggle]').click();   // 打开
  const card = [...app().querySelectorAll('.sk-card')].find((c) => Number(c.dataset.calcPick) === sA.id);
  ck(card.querySelector('.btn-fx').classList.contains('on'), '卡片的按钮变成已生效样式');
  ck(!/未生效/.test(card.querySelector('.btn-fx').innerHTML), '卡片的「未生效」字样消失');
}

console.log('\n④ 关闭弹窗');
{
  app().querySelector('.fx-modal [data-fx-close]').click();
  ck(!app().querySelector('.fx-modal'), '点 × 关掉了');
}

console.log('\n⑤ 二选一技能：点分支');
{
  const sD = [...A2.data.skills].find((s) => s.name === '驱赶');
  A2.calc.fx = {}; A2.calc.fxOpen = { a: String(sD.id) };
  render();
  const opts = app().querySelectorAll('.fx-modal [data-fx-choice]');
  ck(opts.length === 2, `两个分支按钮（${opts.length}）`);
  opts[1].click();
  ck(A2.calc.fx[`choice:${sD.id}`] === 1, '选中第二个分支');
  ck(A2.calc.fx[`on:${sD.id}`] === 1, '选分支同时启用了效果');
  const opts2 = app().querySelectorAll('.fx-modal [data-fx-choice]');
  ck(/已选/.test(opts2[1].innerHTML), '第二个分支显示「已选」');
  ck(!app().querySelector('.fx-modal') === false || true, '');
  opts2[0].click();
  ck(A2.calc.fx[`choice:${sD.id}`] === 0, '切到第一个分支');
}

console.log('\n⑥ 手填显示威力');
{
  A2.calc.fx = { [`on:${sA.id}`]: 1 }; A2.calc.fxOpen = { a: String(sA.id) };
  render();
  const inp = app().querySelector('.fx-modal [data-fx-pow]');
  ck(!!inp, '弹窗里有威力输入框');
  inp.value = '4321';
  app().querySelector('.fx-modal [data-fx-pow-apply]').click();
  ck(A2.calc.fx[`pow:${sA.id}`] === 4321, `点「修改」写入手填值（实际 ${A2.calc.fx[`pow:${sA.id}`]}）`);
  const after = api.skillPowerOf('a', A2.bySpirit.get('20:1'), sA, A2.bySpirit.get('43:1'));
  ck(after.power === 4321 && after.manual, `按手填威力算（${after.power}）`);
  // 还原按钮
  const reset = app().querySelector('.fx-modal [data-fx-pow-reset]');
  ck(!!reset, '出现「还原」按钮');
  reset.click();
  ck(A2.calc.fx[`pow:${sA.id}`] === undefined, '还原后手填值被清掉');
}

console.log(bad ? `\n✗ ${bad} 项不通过` : '\n✓ 技能设置弹窗全部可用');
process.exit(bad ? 1 : 0);
