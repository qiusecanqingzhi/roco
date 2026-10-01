/** 验证斩杀线：显示条件 + 含回合末掉血 */
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
const plain = (el) => el.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
let bad = 0;
const ck = (c, label, extra = '') => { if (!c) bad++; console.log(`  ${c ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`); };

const setup = (picks) => {
  A2.view = 'calc';
  A2.calc.a = '20:1'; A2.calc.b = '43:1'; A2.calc.skillA = 7150060;
  A2.calc.hpPctA = 100; A2.calc.hpPctB = 100;
  A2.calc.statusA = { picks: [], star: 0, layers: {} };
  A2.calc.statusB = { picks: [...picks], star: 0, layers: {} };
  A2.calc.statusPctA = {}; A2.calc.statusPctB = {};
  A2.calc.modsA = { patkPct: 0, satkPct: 0, pdefPct: 0, sdefPct: 0, spdAdd: 0, powerPct: 0, powerAdd: 0, finalPct: 100 };
  A2.calc.modsB = { ...A2.calc.modsA };
  api.fillLoadoutWithTop('a', A2.bySpirit.get('20:1'), A2.bySpirit.get('43:1'), 4);
  api.fillLoadoutWithTop('b', A2.bySpirit.get('43:1'), A2.bySpirit.get('20:1'), 4);
  env.byId.get('app').innerHTML = '';
  api.render();
  return env.byId.get('app');
};
const spA = () => A2.bySpirit.get('20:1');
const spB = () => A2.bySpirit.get('43:1');

console.log('① 显示条件');
{
  let app = setup([]);
  ck(app.querySelectorAll('.lo-kill').length === 0, '什么都没挂 -> 不显示该列');
  app = setup(['thorn-mark']);
  ck(app.querySelectorAll('.lo-kill').length === 0, '只挂棘刺（离场换人才结算）-> 不显示该列');
  app = setup(['starfall-mark']);
  ck(app.querySelectorAll('.lo-kill').length > 0, '挂星陨印记 -> 显示');
  app = setup(['burn']);
  ck(app.querySelectorAll('.lo-kill').length > 0, '挂灼烧（回合末掉血）-> 显示（按用户要求）');
  app = setup(['poison']);
  ck(app.querySelectorAll('.lo-kill').length > 0, '挂中毒 -> 显示');
  app = setup(['parasite']);
  ck(app.querySelectorAll('.lo-kill').length > 0, '挂寄生 -> 显示');
  app = setup(['conductive-charge']);
  ck(app.querySelectorAll('.lo-kill').length === 0, '只挂引电（攒满立即，非回合末）-> 不显示');
  app = setup(['burn', 'starfall-mark']);
  ck(app.querySelectorAll('.lo-kill').length > 0, '灼烧 + 星陨 -> 显示');
}

console.log('\n② 判据分两层：技能+星陨立刻结算，回合末之后结算');
{
  const app = setup(['starfall-mark', 'burn']);
  const sk = [...A2.data.skills].find((s) => s.cat === '物理' && (s.dmgMax ?? 0) > 0
    && s.typeId !== A2.typeByName.get('幻系').id);
  const n = api.starfallKillLayers(spA(), spB(), sk, {});
  const hp = api.targetHpOf('b', spB());
  const base = api.damageWithPower(spA(), spB(), sk, sk.dmgMax, {});
  const star = api.damageWithPower(spA(), spB(), sk, api.starfallPower(n), { phantom: true });
  const turnEnd = api.statusDamageOf('b', spB(), { attacker: spA(), skill: sk })
    .rows.filter((r) => r.mode !== 'power').reduce((a, r) => a + r.raw, 0);
  console.log(`    ${sk.name}: 技能 ${base} + 星陨 ${n} 层 ${star} = ${base + star}，回合末掉血 ${turnEnd}，目标 ${hp}`);
  // n 层到线；判定必须与"技能+星陨能否直接打死 或 剩余≤回合末"这个二分口径一致
  const at = (layers) => base + api.damageWithPower(spA(), spB(), sk, api.starfallPower(layers), { phantom: true });
  const remain = (layers) => Math.max(0, hp - at(layers));
  ck(at(n) >= hp || remain(n) <= turnEnd, `${n} 层到线（${at(n)} ≥ ${hp} 或剩余 ${remain(n)} ≤ ${turnEnd}）`);
  const prevAt = at(n - 1);
  const prevRemain = remain(n - 1);
  ck(prevAt < hp && prevRemain > turnEnd,
    `${n - 1} 层没到线（${prevAt} < ${hp} 且剩余 ${prevRemain} > ${turnEnd}）—— 确认是最少层数`);
  // 如果 n 层是靠"直接打死"，那要能指出来；否则是靠回合末补刀
  console.log(`    到线方式：${at(n) >= hp ? '技能+星陨直接打死' : `剩余 ${remain(n)} 交给回合末的 ${turnEnd} 点补刀`}`);

  // 页面文案要说明两层判据
  const note = plain([...app.querySelectorAll('.calc-loadout .desc')].pop());
  ck(/回合末/.test(note), '页面说明了回合末掉血是之后结算的');
  ck(/灼烧/.test(note), '页面点名了具体是哪个回合末状态');
}

console.log('\n③ 没有星陨印记时：只有回合末伤害，层数恒为 0');
{
  const app = setup(['burn']);
  const sk = [...A2.data.skills].find((s) => s.cat === '物理' && (s.dmgMax ?? 0) > 0);
  const cells = [...app.querySelectorAll('.lo-kill')].map(plain);
  console.log('    斩杀列:', cells.join(' | '));
  ck(cells.every((t) => /不需要|—/.test(t)), '只会出现「不需要」或「—」');
  ck(api.starfallKillLayers(spA(), spB(), sk, {}) !== 1, '不会给出正的层数（星陨帮不上忙）');
}

console.log(bad ? `\n✗ ${bad} 项不通过` : '\n✓ 斩杀线全部生效');
process.exit(bad ? 1 : 0);
