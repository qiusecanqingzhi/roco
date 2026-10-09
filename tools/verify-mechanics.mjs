/** 验收新机制：攻防等级官方口径 / 减伤 / 闪击-鸣沙陷阱查表 */
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

const a = A2.bySpirit.get('20:1');
const b = A2.bySpirit.get('43:1');
const sk = A2.bySkill.get(7150060);   // 扇风，物理
const base = (extra = {}) => api.calcDamage(a, b, sk, { level: 60, flatAdd: 20, skillPct: 0.5, ...extra });

console.log('① 官方示例仍然对：岚鸟扇风打奇丽花 = 332');
{
  // 官方的 332 用「物攻个体 10（= 我们的 60）」那一组参数
  const ivAll = (v) => ({ atkIV: v, defIV: v });
  const r = api.calcDamage(a, b, sk, {
    level: 60, flatAdd: 20, skillPct: 0.5, atkIV: 60, defIV: 60,
    atkNature: 'neutral', defNature: 'neutral',
  });
  ck(r.atkStat === 234, `物攻面板 = 234（实际 ${r.atkStat}）`);
  ck(r.defStat === 226, `物防面板 = 226（实际 ${r.defStat}）`);
  ck(r.shown === 356, `显示威力 = 356（实际 ${r.shown}）`);
  ck(r.dmg === 332, `预计伤害 = 332（实际 ${r.dmg}）`);
}

console.log('\n② 攻防等级：攻击提升在分子、防御下降也在分子（官方口径）');
{
  const r0 = base();
  // 物攻 +100% -> 分子 +1 => 攻防等级 ×2
  const up = base({ mods: { patkPct: 100, satkPct: 0, powerPct: 0, powerAdd: 0, finalPct: 100, dmgCutPct: 0 } });
  ck(up.lvZone === 2, `物攻+100% ⇒ 攻防等级 ×2（实际 ×${up.lvZone}）`);
  // 显示威力那一层会 round，所以伤害不会正好整倍，用相对误差判
  ck(Math.abs(up.dmg / r0.dmg - 2) < 0.01, `伤害约 ×2（${r0.dmg} → ${up.dmg}）`);
  // 对方物防 −40% -> 分子 +0.4 => ×1.4（**不是** 防御×0.6 的 ×1.667）
  const down = base({ defMods: { pdefPct: -40, sdefPct: 0, dmgCutPct: 0 } });
  ck(Math.abs(down.lvZone - 1.4) < 1e-9, `对方物防−40% ⇒ 攻防等级 ×1.4（实际 ×${down.lvZone}）`);
  ck(down.defStat === r0.defStat, `防御面板**没变**（还是 ${down.defStat}）—— 不再乘到面板上`);
  // 官方那条示例的组合：攻击+100% 且 对方防御−40% => (1+1+0.4)/1 = 2.4
  const combo = base({
    mods: { patkPct: 100, satkPct: 0, powerPct: 0, powerAdd: 0, finalPct: 100, dmgCutPct: 0 },
    defMods: { pdefPct: -40, sdefPct: 0, dmgCutPct: 0 },
  });
  ck(Math.abs(combo.lvZone - 2.4) < 1e-9, `物攻+100% + 对方物防−40% ⇒ ×2.4（实际 ×${combo.lvZone}）`);
  // 反向：攻击下降 / 对方防御提升 进分母
  const atkDown = base({ mods: { patkPct: -50, satkPct: 0, powerPct: 0, powerAdd: 0, finalPct: 100, dmgCutPct: 0 } });
  ck(Math.abs(atkDown.lvZone - 1 / 1.5) < 1e-9, `物攻−50% ⇒ ×1/1.5（实际 ×${atkDown.lvZone.toFixed(4)}）`);
  const defUp = base({ defMods: { pdefPct: 70, sdefPct: 0, dmgCutPct: 0 } });
  ck(Math.abs(defUp.lvZone - 1 / 1.7) < 1e-9, `对方物防+70% ⇒ ×1/1.7（实际 ×${defUp.lvZone.toFixed(4)}）`);
  // 魔攻% 不该影响物理技能
  const wrong = base({ mods: { patkPct: 0, satkPct: 100, powerPct: 0, powerAdd: 0, finalPct: 100, dmgCutPct: 0 } });
  ck(wrong.dmg === r0.dmg, '魔攻% 不影响物理技能');
}

console.log('\n③ 减伤（防守方开防御类技能）');
{
  const r0 = base();
  const cut = base({ defMods: { pdefPct: 0, sdefPct: 0, dmgCutPct: 70, } });
  ck(cut.dmgCutPct === 70, '减伤 70% 被读到');
  ck(cut.dmg === Math.floor(r0.dmg * 0.3), `伤害 ×0.3（${r0.dmg} → ${cut.dmg}）`);
  ck(cut.shown === r0.shown, '减伤**不改变**显示威力（只是最终伤害层）');
  const full = base({ defMods: { pdefPct: 0, sdefPct: 0, dmgCutPct: 100 } });
  ck(full.dmg === 0, '减伤 100% ⇒ 0 伤害');
  const over = base({ defMods: { pdefPct: 0, sdefPct: 0, dmgCutPct: 150 } });
  ck(over.dmgCutPct === 100, '减伤被夹到 100%');
}

console.log('\n④ 闪击 / 鸣沙陷阱：填比值自动取档');
{
  const sp = a, o = b;
  const flash = A2.bySkill.get(7150250);   // 闪击
  const sand = A2.bySkill.get(7080320);    // 鸣沙陷阱
  ck(!!flash && !!sand, '找到闪击与鸣沙陷阱');
  const fxF = api.skillEffectOf(flash);
  ck(fxF.kind === 'ratio-table' && fxF.divisor === 6, `闪击：比值表，除数 6`);
  const fxS = api.skillEffectOf(sand);
  ck(fxS.kind === 'ratio-table' && fxS.divisor === 4, `鸣沙陷阱：比值表，除数 4`);
  // 未填 -> 基础威力
  A2.calc.fx = {};
  ck(api.skillPowerOf('a', sp, flash, o).power === flash.dmgMax, `未填 = 基础威力 ${flash.dmgMax}`);
  // 打开开关 + 填比值 12 -> 12/6 = 2 -> 第 3 档 = 60
  A2.calc.fx = { [`on:${flash.id}`]: 1, [`ratio:${flash.id}`]: 12 };
  const r1 = api.skillPowerOf('a', sp, flash, o);
  ck(r1.power === 60, `比值 12 ÷ 6 = 第 3 档 ⇒ 威力 60（实际 ${r1.power}）`);
  // 比值 36 -> 36/6 = 6 -> 第 7 档 = 110
  A2.calc.fx[`ratio:${flash.id}`] = 36;
  ck(api.skillPowerOf('a', sp, flash, o).power === 110, `比值 36 ÷ 6 = 第 7 档 ⇒ 110（实际 ${api.skillPowerOf('a', sp, flash, o).power}）`);
  // 档位下标越界要夹到末档（表 10 项，下标 0..9）
  A2.calc.fx[`ratio:${flash.id}`] = 54;
  ck(api.skillPowerOf('a', sp, flash, o).power === 140, `比值 54 ÷ 6 = 下标 9（末档）⇒ 140（实际 ${api.skillPowerOf('a', sp, flash, o).power}）`);
  // 超大比值被夹到最高档 140
  A2.calc.fx[`ratio:${flash.id}`] = 9999;
  ck(api.skillPowerOf('a', sp, flash, o).power === 140, `超大比值夹到最高档 140（实际 ${api.skillPowerOf('a', sp, flash, o).power}）`);
  // 鸣沙陷阱除数 4：比值 8 -> 第 3 档 -> 60
  A2.calc.fx = { [`on:${sand.id}`]: 1, [`ratio:${sand.id}`]: 8 };
  ck(api.skillPowerOf('a', sp, sand, o).power === 60, `鸣沙陷阱 比值 8 ÷ 4 = 第 3 档 ⇒ 60（实际 ${api.skillPowerOf('a', sp, sand, o).power}）`);
  A2.calc.fx = {};
}

console.log(bad ? `\n✗ ${bad} 项不通过` : '\n✓ 新机制全部生效');
process.exit(bad ? 1 : 0);
