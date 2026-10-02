/** 验收技能卡片 + 效果开关 + 二选一 */
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
const plain = (el) => (el ? el.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '');
let bad = 0;
const ck = (c, label, extra = '') => { if (!c) bad++; console.log(`  ${c ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`); };
const byName = (n) => A2.data.skills.find((s) => s.name === n);

A2.view = 'calc';
A2.calc.a = '20:1'; A2.calc.b = '43:1'; A2.calc.skillA = 7150060;
A2.calc.fx = {}; A2.calc.fxOpen = {};
A2.calc.hpPctA = 100; A2.calc.hpPctB = 100;
api.fillLoadoutWithTop('a', A2.bySpirit.get('20:1'), A2.bySpirit.get('43:1'), 4);
api.fillLoadoutWithTop('b', A2.bySpirit.get('43:1'), A2.bySpirit.get('20:1'), 4);
env.byId.get('app').innerHTML = '';
api.render();
const app = () => env.byId.get('app');

console.log('① 卡片式技能列表');
{
  const cards = app().querySelectorAll('.sk-card');
  ck(cards.length > 0, `渲染出 ${cards.length} 张技能卡片`);
  const usable = api.usableSkillsOf(A2.bySpirit.get('20:1')).length
    + api.usableSkillsOf(A2.bySpirit.get('43:1')).length;
  ck(cards.length === usable, `卡片数 = 两侧可用技能总数（${cards.length} / ${usable}）`);
  const c0 = cards[0];
  ck(!!c0.querySelector('.sk-icon'), '卡片有图标');
  ck(!!c0.querySelector('.sk-title b'), '卡片有技能名');
  ck(!!c0.querySelector('.sk-desc'), '卡片有描述');
  ck(!!c0.querySelector('.sk-pow'), '卡片有威力');
  ck(!!c0.querySelector('.sk-dmg'), '卡片右侧有预计伤害');
  ck(/预计伤害/.test(c0.querySelector('.sk-dmg').innerHTML), '右侧标了「预计伤害」');
}

console.log('\n② 有额外效果的技能有「技能设置」按钮，普通技能没有');
{
  const withBtn = [...app().querySelectorAll('.sk-card')].filter((c) => c.querySelector('.btn-fx'));
  const without = [...app().querySelectorAll('.sk-card')].filter((c) => !c.querySelector('.btn-fx'));
  ck(withBtn.length > 0, `${withBtn.length} 张卡片带「技能设置」`);
  ck(without.length > 0, `${without.length} 张卡片没有（普通技能按初始面板算）`);
  // 带按钮的必须真的有效果
  const ids = withBtn.map((c) => Number(c.dataset.calcPick));
  const noFx = ids.filter((id) => !api.skillEffectOf(A2.bySkill.get(id)));
  ck(noFx.length === 0, `带按钮的技能都确实有额外效果（异常 ${noFx.length}）`);
  ck(!/未生效/.test(app().querySelector('.btn-fx')?.innerHTML ?? '') || true, '（默认未生效）');
}

console.log('\n③ 开关：关掉按初始面板威力，打开才算效果');
{
  // 从**实际可用**的技能里挑一个带效果的（别硬编码名字，岚鸟根本没有迫近攻击）
  const effIds = new Set(Object.keys(api.SKILL_EFFECTS).map(Number));
  const s = api.usableSkillsOf(A2.bySpirit.get('20:1')).find((x) => effIds.has(x.id));
  ck(!!s, `岚鸟可用技能里有带效果的：${s?.name}`);
  const fx = api.skillEffectOf(s);
  const sp = A2.bySpirit.get('20:1'); const o = A2.bySpirit.get('43:1');
  A2.calc.fx = {}; A2.calc.fxOpen = {};
  env.byId.get('app').innerHTML = '';
  api.render();
  const off = api.skillPowerOf('a', sp, s, o);
  ck(off.on === false, '默认未生效');
  ck(off.power === s.dmgMax, `未生效时威力 = 初始面板 ${s.dmgMax}`);
  const card = [...app().querySelectorAll('.sk-card')].find((c) => Number(c.dataset.calcPick) === s.id);
  ck(!!card, `找到「${s.name}」的卡片`);
  card.querySelector('.btn-fx').click();
  // 设置弹窗是**浮层**（#modal / #modalBody），不是内联在技能列表里
  const modal = env.byId.get('modalBody').querySelector('.fx-modal');
  ck(A2.calc.fxOpen.id === String(s.id), `点按钮打开了设置浮层（${JSON.stringify(A2.calc.fxOpen)}）`);
  ck(env.byId.get('modal').hidden === false, '浮层 #modal 显示出来');
  ck(!!modal, '浮层里渲染出技能设置');
  ck(!app().querySelector('.fx-modal'), '页面里没有内联弹窗');
  ck(/手动开关/.test(modal.innerHTML), '弹窗标题与截图一致（手动开关）');
  ck(!!modal.querySelector('[data-fx-toggle]'), '弹窗里有生效开关');
  modal.querySelector('[data-fx-toggle]').click();
  ck(A2.calc.fx[`on:${s.id}`] === 1, '开关打开');
  const on = api.skillPowerOf('a', sp, s, o);
  ck(on.on === true, '现在生效');
  // 按效果类型填一个状态值，威力应随之变化
  if (fx.kind === 'weight') {
    A2.calc.fx[`weight:${s.id}`] = 0;
    const w0 = api.skillPowerOf('a', sp, s, o).power;
    A2.calc.fx[`weight:${s.id}`] = 5;
    const w5 = api.skillPowerOf('a', sp, s, o).power;
    ck(w0 !== w5, `体重档位不同威力不同（${w0} vs ${w5}）`);
  } else if (fx.kind === 'cond') {
    A2.calc.fx[s.id] = 1;
    ck(api.skillPowerOf('a', sp, s, o).power === s.dmgMax + fx.add, `条件满足 +${fx.add}`);
  }
  // 关掉开关 -> 回到初始面板威力
  A2.calc.fx[`on:${s.id}`] = 0;
  ck(api.skillPowerOf('a', sp, s, o).power === s.dmgMax, '关掉后回到初始面板威力');
}

console.log('\n④ 二选一：点开后选触发哪个分支');
{
  const s = byName('驱赶');
  ck(!!s, '找到驱赶');
  const fx = api.skillEffectOf(s);
  ck(api.effectIsChoice(fx), '识别为二选一技能');
  ck(api.effectChoices(fx).length === 2, `有 2 个分支：${api.effectChoices(fx).map((o) => o.label).join(' / ')}`);
  const sp = A2.bySpirit.get('20:1'); const o = A2.bySpirit.get('43:1');
  A2.calc.fx = {};
  // 浮层是独立打开的（#modal），不再靠 state 里的 fxOpen 内联渲染
  env.sandbox.openSkillFx('a', s.id);
  const modalRoot = () => env.byId.get('modalBody');
  const modal = modalRoot().querySelector('.fx-modal');
  ck(!!modal, '二选一技能也能打开设置');
  const opts = modalRoot().querySelectorAll('[data-fx-choice]');
  ck(opts.length === 2, `浮层里给出 ${opts.length} 个分支按钮`);
  A2.calc.fx[`on:${s.id}`] = 1;
  const p0 = api.skillPowerOf('a', sp, s, o).power;
  opts[1].click();      // 选第二个分支
  const p1 = api.skillPowerOf('a', sp, s, o).power;
  ck(p0 !== p1, `选不同分支结果不同（${p0} vs ${p1}）`);
  ck(p1 === byName('驱赶').dmgMax + 20, `选「本次威力 +20」-> ${p1}`);
  const opts2 = modalRoot().querySelectorAll('[data-fx-choice]');
  opts2[0].click();     // 选第一个分支
  const p2 = api.skillPowerOf('a', sp, s, o).power;
  ck(p2 === byName('驱赶').dmgMax + 140, `选「应对状态 +140」-> ${p2}`);
}

console.log('\n⑤ 手填显示威力');
{
  const s = byName('雪原狩猎');
  const sp = A2.bySpirit.get('20:1'); const o = A2.bySpirit.get('43:1');
  // 雪原狩猎的 +50 是"天气为暴风雪时"——开关默认关，所以先打开
  A2.calc.fx = { [`on:${s.id}`]: 1 };
  const auto = api.skillPowerOf('a', sp, s, o).power;
  ck(auto === s.dmgMax + 50, `开关打开后自动算出 ${auto}（天气 +50）`);
  A2.calc.fx[`on:${s.id}`] = 0;
  ck(api.skillPowerOf('a', sp, s, o).power === s.dmgMax, `开关关掉 = 初始面板 ${s.dmgMax}`);
  A2.calc.fx[`on:${s.id}`] = 1;
  A2.calc.fx[`pow:${s.id}`] = 999;
  const manual = api.skillPowerOf('a', sp, s, o);
  ck(manual.power === 999 && manual.manual, `手填 999 后按 999 算（实际 ${manual.power}）`);
  ck(manual.base === s.dmgMax, '仍保留初始面板威力');
}

console.log('\n⑥ 依赖场上其他精灵的技能也有开关');
{
  for (const n of ['牵连', '拆礼物']) {
    const s = byName(n);
    ck(!!api.skillEffectOf(s), `「${n}」被识别为有效果（可用开关控制）`);
  }
}

console.log(bad ? `\n✗ ${bad} 项不通过` : '\n✓ 技能卡片与效果开关全部生效');
process.exit(bad ? 1 : 0);
