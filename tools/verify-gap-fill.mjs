/** 补齐后的覆盖率 + 新机制验收 */
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

const sp = A2.bySpirit.get('20:1');
const o = A2.bySpirit.get('43:1');
const byName = (n) => A2.data.skills.find((s) => s.name === n);
const setFx = (obj, ...onIds) => {
  const next = { ...obj };
  for (const id of onIds) next[`on:${id}`] = 1;
  A2.calc.fx = next;
};
const pw = (name) => api.skillPowerOf('a', sp, byName(name), o);

console.log('① 变威力技能覆盖率');
{
  const varSkills = A2.data.skills.filter((s) => s.powerIsVariable);
  const miss = varSkills.filter((s) => !api.SKILL_EFFECTS[s.id]);
  ck(varSkills.length === 43, `上游共 ${varSkills.length} 个变威力技能`);
  ck(miss.length <= 1, `已覆盖 ${varSkills.length - miss.length}/${varSkills.length}（剩 ${miss.length}）`);
  for (const s of miss) console.log(`      未覆盖：${s.name} —— ${s.descPlain}`);
}

console.log('\n② 新补的几个（数值对得上描述）');
{
  // 落雷：每次入场永久 +40
  const s = byName('落雷');
  setFx({ [s.id]: 3 }, s.id);
  ck(pw('落雷').power === s.dmgMax + 120, `落雷 3 次入场 = ${s.dmgMax} + 120 = ${pw('落雷').power}`);

  // 血契：每失去 10% 生命 +15，上限 1000
  const h = byName('血契');
  setFx({ [h.id]: 30 }, h.id);
  ck(pw('血契').power === h.dmgMax + 45, `血契 失去 30% = ${h.dmgMax} + 45 = ${pw('血契').power}`);
  setFx({ [h.id]: 9000 }, h.id);
  ck(pw('血契').power === 1000, `血契 超量被上限 1000 卡住（${pw('血契').power}）`);

  // 绵里藏针：上回合未用攻击技能永久 +20
  const m = byName('绵里藏针');
  setFx({ [m.id]: 2 }, m.id);
  ck(pw('绵里藏针').power === m.dmgMax + 40, `绵里藏针 2 层 = ${m.dmgMax} + 40 = ${pw('绵里藏针').power}`);

  // 天体吸积：敌方每 1 层印记 +20
  const t = byName('天体吸积');
  setFx({ [`energy:${t.id}`]: 3 }, t.id);
  ck(pw('天体吸积').power === t.dmgMax + 60, `天体吸积 3 层印记 = ${t.dmgMax} + 60 = ${pw('天体吸积').power}`);

  // 坟场搏击：敌方每 1 能量 威力 −10%（按比例）
  const g = byName('坟场搏击');
  setFx({ [`energy:${g.id}`]: 0 }, g.id);
  ck(pw('坟场搏击').power === g.dmgMax, `坟场搏击 0 能量 = ${g.dmgMax}`);
  setFx({ [`energy:${g.id}`]: 5 }, g.id);
  ck(pw('坟场搏击').power === Math.round(g.dmgMax * 0.5), `5 能量 ⇒ 威力减半 = ${pw('坟场搏击').power}`);
  setFx({ [`energy:${g.id}`]: 10 }, g.id);
  ck(pw('坟场搏击').power === 0, `10 能量 ⇒ 威力 0（${pw('坟场搏击').power}）`);

  // 鸩毒：二选一
  const z = byName('鸩毒');
  const fx = api.skillEffectOf(z);
  ck(api.effectIsChoice(fx), '鸩毒识别为二选一');
  ck(api.effectChoices(fx).length === 2, `两个分支：${api.effectChoices(fx).map((x) => x.label).join(' / ')}`);
  setFx({ [z.id]: 3, [`choice:${z.id}`]: 0 }, z.id);
  ck(pw('鸩毒').power === z.dmgMax + 30, `选「每层中毒 +10」× 3 层 = +30（${pw('鸩毒').power}）`);
  setFx({ [`choice:${z.id}`]: 1 }, z.id);
  ck(pw('鸩毒').power === z.dmgMax + 40, `选「应对状态 +40」（${pw('鸩毒').power}）`);
}

console.log('\n③ 开关语义仍然一致（默认不生效）');
{
  const s = byName('落雷');
  setFx({});
  ck(pw('落雷').power === s.dmgMax && pw('落雷').on === false, '默认按初始面板威力');
}

A2.calc.fx = {};
console.log(bad ? `\n✗ ${bad} 项不通过` : '\n✓ 补齐的机制全部生效');
process.exit(bad ? 1 : 0);
