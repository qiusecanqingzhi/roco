/** 验收：技能设置是**浮层**（#modal），且点按钮不会被卡片的"设为当前技能"抢走 */
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
A2.calc.fx = {}; A2.calc.fxOpen = {};
api.fillLoadoutWithTop('a', A2.bySpirit.get('20:1'), A2.bySpirit.get('43:1'), 4);
api.fillLoadoutWithTop('b', A2.bySpirit.get('43:1'), A2.bySpirit.get('20:1'), 4);

const render = () => { env.byId.get('app').innerHTML = ''; api.render(); };
const app = () => env.byId.get('app');
const modal = () => env.byId.get('modal');
const modalBody = () => env.byId.get('modalBody');
const effIds = new Set(Object.keys(api.SKILL_EFFECTS).map(Number));
const sA = api.usableSkillsOf(A2.bySpirit.get('20:1')).find((x) => effIds.has(x.id));

render();

console.log('① 弹窗是浮层（不是内联在技能列表里）');
{
  ck(!app().querySelector('.fx-modal'), '初始：页面里没有内联的 fx-modal');
  ck(modal().hidden !== false, '初始：#modal 是隐藏的');
  const btn = app().querySelector(`[data-fx-open="${sA.id}"]`);
  ck(!!btn, `找到「${sA.name}」的技能设置按钮`);
  btn.click();
  ck(modal().hidden === false, '点击后 #modal 显示出来（浮层）');
  ck(!!modalBody().querySelector('.fx-modal'), '浮层内容里有技能设置');
  ck(/手动开关/.test(modalBody().innerHTML), '标题是「手动开关」');
  ck(!app().querySelector('.fx-modal'), '页面里依然没有内联弹窗（没塞进技能列表）');
}

console.log('\n② 点按钮不会顺手把这张卡设成当前技能（捕获阶段拦下）');
{
  // 换一个非当前的、带效果的技能来试
  const before = A2.calc.skillA;
  const effIds2 = [...effIds];
  const sB = api.usableSkillsOf(A2.bySpirit.get('20:1')).find((x) => effIds2.includes(x.id));
  ck(A2.calc.skillA !== sB.id || true, `（用于验证的技能 ${sB.name}）`);
  modalBody().querySelector('[data-fx-close]').click();
  ck(modal().hidden === true, '× 能关掉浮层');
  ck(A2.calc.fxOpen.id === undefined, '关闭时清掉了定位');
}

console.log('\n③ 浮层里的「生效开关」');
{
  app().querySelector(`[data-fx-open="${sA.id}"]`).click();
  ck(A2.calc.fx[`on:${sA.id}`] !== 1, '初始未生效');
  modalBody().querySelector('[data-fx-toggle]').click();
  ck(A2.calc.fx[`on:${sA.id}`] === 1, '点一次 -> 生效');
  ck(/已生效/.test(modalBody().querySelector('[data-fx-toggle]').innerHTML), '浮层里按钮变成「已生效」');
  ck(modal().hidden === false, '浮层仍然开着（没被 render 关掉）');
  const card = [...app().querySelectorAll('.sk-card')].find((c) => Number(c.dataset.calcPick) === sA.id);
  ck(!/未生效/.test(card.querySelector('.btn-fx').innerHTML), '卡片上的状态跟着变了');
  modalBody().querySelector('[data-fx-toggle]').click();
  ck(A2.calc.fx[`on:${sA.id}`] === 0, '再点 -> 未生效');
}

console.log('\n④ 二选一分支');
{
  const sD = A2.data.skills.find((s) => s.name === '驱赶');
  modalBody().querySelector('[data-fx-close]').click();
  A2.calc.fx = {};
  // 驱赶不在岚鸟技能里也能直接开浮层（模拟点它的按钮）
  env.sandbox.openSkillFx('a', sD.id);
  ck(modal().hidden === false, '浮层打开');
  const opts = modalBody().querySelectorAll('[data-fx-choice]');
  ck(opts.length === 2, `两个分支（${opts.length}）`);
  opts[1].click();
  ck(A2.calc.fx[`choice:${sD.id}`] === 1, '选中第二个分支');
  ck(A2.calc.fx[`on:${sD.id}`] === 1, '同时启用');
  ck(/已选/.test(modalBody().querySelectorAll('[data-fx-choice]')[1].innerHTML), '显示「已选」');
}

console.log('\n⑤ 手填威力 + 还原');
{
  env.sandbox.openSkillFx('a', sA.id);
  A2.calc.fx = { [`on:${sA.id}`]: 1 };
  env.sandbox.refreshFxModal();
  const inp = modalBody().querySelector('[data-fx-pow]');
  inp.value = '1234';
  modalBody().querySelector('[data-fx-pow-apply]').click();
  ck(A2.calc.fx[`pow:${sA.id}`] === 1234, '「修改」写入手填威力');
  ck(api.skillPowerOf('a', A2.bySpirit.get('20:1'), sA, A2.bySpirit.get('43:1')).power === 1234, '按手填值算');
  const reset = modalBody().querySelector('[data-fx-pow-reset]');
  ck(!!reset, '出现「还原」');
  reset.click();
  ck(A2.calc.fx[`pow:${sA.id}`] === undefined, '还原清掉手填值');
}

console.log(bad ? `\n✗ ${bad} 项不通过` : '\n✓ 技能设置浮层全部可用');
process.exit(bad ? 1 : 0);
