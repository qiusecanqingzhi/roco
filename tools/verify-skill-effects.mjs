/** 技能特殊效果验收：有修正的技能真的进计算，且数值对得上描述 */
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
const setFx = (obj) => { A2.calc.fx = { ...obj }; };
const powerOf = (name, side = 'a') => {
  const sp = A2.bySpirit.get(side === 'a' ? '20:1' : '43:1');
  const o = A2.bySpirit.get(side === 'a' ? '43:1' : '20:1');
  return api.skillPowerOf(side, sp, byName(name), o);
};

A2.view = 'calc';
A2.calc.a = '20:1'; A2.calc.b = '43:1'; A2.calc.skillA = 7150060;

console.log('① 效果表覆盖');
{
  const n = Object.keys(api.SKILL_EFFECTS ?? {}).length;
  ck(n >= 35, `效果表有 ${n} 条`);
  // 每条都要能查到对应技能
  let missing = 0;
  for (const id of Object.keys(api.SKILL_EFFECTS ?? {})) if (!A2.bySkill.get(Number(id))) missing++;
  ck(missing === 0, `每条效果都能对应到技能（缺失 ${missing}）`);
  // 有效果的技能都带 label（表里没写的由 skillEffectOf 按 kind 自动生成）
  let noLabel = 0;
  for (const id of Object.keys(api.SKILL_EFFECTS ?? {})) {
    const fx = api.skillEffectOf(A2.bySkill.get(Number(id)));
    if (!fx || !fx.label) { noLabel++; console.log(`      缺 label: ${id}`); }
  }
  ck(noLabel === 0, `每条都能拿到说明文案（缺 ${noLabel}）`);
}

console.log('\n② 永久叠加（迫近攻击：每次使用后永久 +45）');
{
  setFx({});
  const s = byName('迫近攻击');
  const base = s.dmgMax;
  ck(powerOf('迫近攻击').power === base, `0 层时就是基础威力 ${base}`);
  setFx({ [s.id]: 3 });
  ck(powerOf('迫近攻击').power === base + 45 * 3, `3 层 = ${base} + 135 = ${base + 135}（实际 ${powerOf('迫近攻击').power}）`);
}

console.log('\n③ 条件式（见招拆招：上回合使用状态技能 +55）');
{
  const s = byName('见招拆招');
  setFx({});
  ck(powerOf('见招拆招').power === s.dmgMax, '条件未满足时 = 基础威力');
  setFx({ [s.id]: 1 });
  ck(powerOf('见招拆招').power === s.dmgMax + 55, `满足时 = ${s.dmgMax} + 55 = ${s.dmgMax + 55}`);
}

console.log('\n④ 按生命损失（垂死反击：每失去 5% 生命 +5，上限 500）');
{
  const s = byName('垂死反击');
  setFx({ [s.id]: 0 });    ck(powerOf('垂死反击').power === s.dmgMax, '满血时 = 基础威力');
  setFx({ [s.id]: 20 });   ck(powerOf('垂死反击').power === s.dmgMax + 20, `失去 20% = ${s.dmgMax} + 20`);
  setFx({ [s.id]: 50 });   ck(powerOf('垂死反击').power === s.dmgMax + 50, '失去 50% = +50');
  // 上限 500 是"最终威力"的上限；这条技能 100% 生命也只到 180，
  // 所以上限本身用"造一个超大的失去量"来验（公式上不会到，但夹取逻辑必须在）
  setFx({ [s.id]: 9000 });
  ck(powerOf('垂死反击').power === 500, `失去 9000% 时被上限 500 卡住（实际 ${powerOf('垂死反击').power}）`);
}

console.log('\n⑤ 按能耗（逆袭：能耗每 +1 威力 +50）');
{
  const s = byName('逆袭');
  setFx({});
  const expect = s.dmgMax + s.energy * 50;
  ck(powerOf('逆袭').power === expect, `能耗 ${s.energy} → ${s.dmgMax} + ${s.energy * 50} = ${expect}（实际 ${powerOf('逆袭').power}）`);
}

console.log('\n⑥ 倍数伤害（穿膛：敌方能量 ≤ 2 时伤害 ×5）');
{
  const s = byName('穿膛');
  setFx({});
  ck(powerOf('穿膛').mult === 1, '未满足时倍率 = 1');
  setFx({ [s.id]: 1 });
  ck(powerOf('穿膛').mult === 5, '满足时倍率 = 5');
}

console.log('\n⑦ 体重查表（吨位压制）');
{
  const s = byName('吨位压制');
  setFx({ [`weight:${s.id}`]: 0 });
  ck(powerOf('吨位压制').power === 160, `最低档 = 160（实际 ${powerOf('吨位压制').power}）`);
  setFx({ [`weight:${s.id}`]: 5 });
  ck(powerOf('吨位压制').power === 80, '最高档 = 80');
}

console.log('\n⑧ 界面：效果行与输入框');
{
  const s = byName('迫近攻击');
  A2.calc.skillA = s.id;
  setFx({});
  env.byId.get('app').innerHTML = '';
  api.render();
  const app = env.byId.get('app');
  const res = app.querySelector('.calc-results');
  ck(!!res, '有结果区');
  ck(/技能效果/.test(res.innerHTML), '结果区出现「技能效果」行');
  ck(res.querySelectorAll('[data-fx]').length > 0, '给出了对局状态输入框');
  ck(/效果/.test(res.innerHTML), '显示了效果说明');

  // 填 3 层后要算进结果
  const inp = res.querySelector('[data-fx]');
  inp.value = '3';
  inp.dispatch('change');
  const app2 = env.byId.get('app');
  const t = plain(app2.querySelector('.calc-results'));
  ck(new RegExp(String(s.dmgMax + 135)).test(t) || /\+135/.test(t), `填 3 层后出现 +135 修正（${t.slice(0, 120)}…）`);
  ck(A2.calc.fx[String(s.id)] === 3, '状态被记住');
  A2.calc.fx = {};
  A2.calc.skillA = 7150060;
}

console.log('\n⑨ 技能表里标出有特殊效果的技能');
{
  env.byId.get('app').innerHTML = '';
  api.render();
  const app = env.byId.get('app');
  const marked = app.querySelectorAll('.calc-skill-table .tag.fx');
  ck(marked.length > 0, `技能表里标出 ${marked.length} 个带特殊效果的技能`);
}

console.log(bad ? `\n✗ ${bad} 项不通过` : '\n✓ 技能特殊效果全部生效');
process.exit(bad ? 1 : 0);
