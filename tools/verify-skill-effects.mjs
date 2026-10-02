/** 技能特殊效果专项验收（含"效果开关"语义：默认不生效 = 按初始面板威力） */
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

const byName = (n) => A2.data.skills.find((s) => s.name === n);
const spA = () => A2.bySpirit.get('20:1');
const spB = () => A2.bySpirit.get('43:1');
/** 设效果状态；第 2 个参数起是"要打开开关的技能 id" */
const setFx = (obj, ...onIds) => {
  const next = { ...obj };
  for (const id of onIds) next[`on:${id}`] = 1;
  A2.calc.fx = next;
};
const pw = (name) => api.skillPowerOf('a', spA(), byName(name), spB());

A2.view = 'calc';
A2.calc.a = '20:1'; A2.calc.b = '43:1'; A2.calc.skillA = 7150060;
A2.calc.fx = {}; A2.calc.fxOpen = {};

console.log('① 效果表');
{
  const n = Object.keys(api.SKILL_EFFECTS ?? {}).length;
  ck(n >= 41, `效果表有 ${n} 条`);
  let miss = 0; let noLabel = 0;
  for (const id of Object.keys(api.SKILL_EFFECTS ?? {})) {
    const sk = A2.bySkill.get(Number(id));
    if (!sk) miss++;
    const fx = api.skillEffectOf(sk);
    if (!fx || !fx.label) noLabel++;
  }
  ck(miss === 0, `每条都能对应到技能（缺 ${miss}）`);
  ck(noLabel === 0, `每条都有说明文案（缺 ${noLabel}）`);
}

console.log('\n② 开关：默认不生效 = 按初始面板威力');
{
  const s = byName('迫近攻击');
  setFx({});
  const off = pw('迫近攻击');
  ck(off.on === false, '默认不生效');
  ck(off.power === s.dmgMax, `不生效时 = 初始面板 ${s.dmgMax}（实际 ${off.power}）`);
  setFx({ [s.id]: 3 }, s.id);
  const on = pw('迫近攻击');
  ck(on.on === true, '打开开关后生效');
  ck(on.power === s.dmgMax + 135, `3 层 = ${s.dmgMax} + 135 = ${on.power}`);
}

console.log('\n③ 条件式（开关 = 条件是否成立）');
{
  const s = byName('见招拆招');
  setFx({});
  ck(pw('见招拆招').power === s.dmgMax, '开关没开 = 基础威力');
  setFx({}, s.id);
  ck(pw('见招拆招').power === s.dmgMax + 55, `开关打开 = +55（实际 ${pw('见招拆招').power}）`);
}

console.log('\n④ 按生命分档 + 上限');
{
  const s = byName('垂死反击');
  setFx({ [s.id]: 20 }, s.id);
  ck(pw('垂死反击').power === s.dmgMax + 20, `失去 20% = +20（实际 ${pw('垂死反击').power}）`);
  setFx({ [s.id]: 9000 }, s.id);
  ck(pw('垂死反击').power === 500, `超量被上限 500 卡住（实际 ${pw('垂死反击').power}）`);
}

console.log('\n⑤ 按能耗（不需要开关，自动取技能自身能耗）');
{
  const s = byName('逆袭');
  setFx({});
  const r = pw('逆袭');
  ck(r.needSwitch === false, '按能耗的效果不需要开关');
  ck(r.power === s.dmgMax + s.energy * 50, `能耗 ${s.energy} → ${s.dmgMax} + ${s.energy * 50} = ${r.power}`);
}

console.log('\n⑥ 倍数伤害');
{
  const s = byName('穿膛');
  setFx({});
  ck(pw('穿膛').mult === 1, '开关没开倍率 = 1');
  setFx({}, s.id);
  ck(pw('穿膛').mult === 5, '开关打开倍率 = 5');
}

console.log('\n⑦ 体重查表（档位 0 是合法值）');
{
  const s = byName('吨位压制');
  setFx({ [`weight:${s.id}`]: 0 }, s.id);
  ck(pw('吨位压制').power === 160, `最低档 = 160（实际 ${pw('吨位压制').power}）`);
  setFx({ [`weight:${s.id}`]: 5 }, s.id);
  ck(pw('吨位压制').power === 80, '最高档 = 80');
}

console.log('\n⑧ 二选一：选哪个分支就用哪个');
{
  const s = byName('驱赶');
  const fx = api.skillEffectOf(s);
  ck(api.effectIsChoice(fx), '识别为二选一');
  const opts = api.effectChoices(fx);
  ck(opts.length === 2, `两个分支：${opts.map((o) => o.label).join(' / ')}`);
  setFx({ [`choice:${s.id}`]: 1 }, s.id);
  const p1 = pw('驱赶').power;
  setFx({ [`choice:${s.id}`]: 0 }, s.id);
  const p2 = pw('驱赶').power;
  ck(p1 === s.dmgMax + 20, `选「本次 +20」→ ${p1}`);
  ck(p2 === s.dmgMax + 140, `选「应对 +140」→ ${p2}`);
}

console.log('\n⑨ 依赖场上其他精灵的也有开关');
{
  for (const n of ['牵连', '拆礼物']) {
    const s = byName(n);
    ck(!!api.skillEffectOf(s), `「${n}」有效果且可用开关控制`);
  }
}

console.log('\n⑩ 手填显示威力优先');
{
  const s = byName('雪原狩猎');
  setFx({ [`pow:${s.id}`]: 999 }, s.id);
  const m = pw('雪原狩猎');
  ck(m.power === 999 && m.manual, `手填 999 后按 999 算（实际 ${m.power}）`);
  ck(m.base === s.dmgMax, '仍保留初始面板威力');
}

console.log(bad ? `\n✗ ${bad} 项不通过` : '\n✓ 技能特殊效果全部生效');
process.exit(bad ? 1 : 0);
