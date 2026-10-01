/** 验证星陨印记：显示威力 = x²-24x+24，走标准伤害公式、幻系、物理/魔法跟随触发技能 */
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

console.log('① 威力曲线：y = x² + 24x − 24（负值夹到 0）');
for (const x of [0, 1, 2, 5, 10, 20, 30, 40]) {
  const real = x * x + 24 * x - 24;
  const got = api.starfallPower(x);
  ck(got === Math.max(0, real), `${String(x).padStart(2)} 层 -> ${String(got).padStart(4)}`, `(公式值 ${real})`);
}
// 单调递增：层数越多威力越大（旧公式是抛物线，会先掉到 0 再回升）
{
  let mono = true;
  for (let i = 1; i <= 60; i++) if (api.starfallPower(i) < api.starfallPower(i - 1)) mono = false;
  ck(mono, '威力随层数单调递增');
  ck(api.starfallPower(0) === 0, '0 层 = 0');
  ck(api.starfallPower(1) === 1, '1 层 = 1');
  ck(api.starfallPower(2) === 28, '2 层 = 28');
  ck(api.starfallPower(10) === 316, '10 层 = 316');
  ck(api.starfallPower(20) === 856, '20 层 = 856');
  ck(api.starfallPower(30) === 1596, '30 层 = 1596');
}

console.log('\n② 物理技能触发 vs 魔法技能触发');
{
  A2.calc.a = '20:1'; A2.calc.b = '43:1';
  A2.calc.statusA = { picks: [], star: 0, layers: {} };
  A2.calc.statusB = { picks: ['starfall-mark'], star: 5, layers: { 'starfall-mark': 5 } };
  A2.calc.statusPctA = {}; A2.calc.statusPctB = {};
  A2.calc.hpPctA = 100; A2.calc.hpPctB = 100;

  const spA = A2.bySpirit.get('20:1');
  const spB = A2.bySpirit.get('43:1');
  const phys = [...A2.data.skills].find((s) => s.cat === '物理' && (s.dmgMax ?? 0) > 0 && s.id !== 7150060);
  const mag = [...A2.data.skills].find((s) => s.cat === '魔法' && (s.dmgMax ?? 0) > 0);

  const dPhys = api.statusDamageOf('b', spB, { attacker: spA, skill: phys });
  const dMag = api.statusDamageOf('b', spB, { attacker: spA, skill: mag });
  const rp = dPhys.rows[0]; const rm = dMag.rows[0];
  ck(rp.mode === 'power', '星陨走 power 模式');
  ck(rp.power === 121, `5 层显示威力 = 121（实际 ${rp.power}）`);
  ck(rp.raw > 0, `物理技能触发 -> 伤害 ${rp.raw}`);
  ck(rm.raw > 0, `魔法技能触发 -> 伤害 ${rm.raw}`);
  ck(rp.detail.isPhysical === true, '物理技能触发时用物攻/物防');
  ck(rm.detail.isPhysical === false, '魔法技能触发时用魔攻/魔防');
  ck(rp.raw !== rm.raw, `两种攻击类型结果不同（${rp.raw} vs ${rm.raw}）`);
  // 系别固定幻系：克制倍率按幻系算，与触发技能的系别无关
  const fx = A2.typeByName.get('幻系').id;
  ck(rp.detail.typeEff === api.typeEffect(fx, spB.types), `克制按幻系算（×${rp.detail.typeEff}）`);
  console.log(`    触发技能: ${phys.name}(${phys.cat}) / ${mag.name}(${mag.cat})`);
  console.log(`    物理: 物攻${rp.detail.atkStat} vs 物防${rp.detail.defStat} -> ${rp.raw}`);
  console.log(`    魔法: 魔攻${rm.detail.atkStat} vs 魔防${rm.detail.defStat} -> ${rm.raw}`);
}

console.log('\n③ 页面显示');
{
  A2.calc.skillA = 7150060;
  A2.view = 'calc';
  env.byId.get('app').innerHTML = '';
  api.render();
  const box = [...env.byId.get('app').querySelectorAll('.st-dmg')][1];
  const t = plain(box);
  console.log('   ', t);
  ck(/显示威力/.test(t), '标出「显示威力」');
  ck(/121/.test(t), '页面出现威力 121');
  ck(/5 层/.test(t), '标出层数');
  ck(/物理|魔法/.test(t), '标出物理/魔法归属');
}

console.log('\n④ 换层数会变（单调）');
{
  const spB = A2.bySpirit.get('43:1');
  const spA = A2.bySpirit.get('20:1');
  const sk = A2.bySkill.get(7150060);
  const pw = (n) => {
    // 层数的真值是 st.star（与面板上「星陨层数」共用）
    A2.calc.statusB.star = n;
    A2.calc.statusB.layers['starfall-mark'] = n;
    return api.statusDamageOf('b', spB, { attacker: spA, skill: sk }).rows[0].power;
  };
  ck(pw(1) === 1, '1 层威力 1');
  ck(pw(5) === 121, '5 层威力 121');
  ck(pw(20) === 856, '20 层威力 856');
  ck(pw(30) === 1596, '30 层威力 1596');
  ck(pw(20) > pw(5) && pw(5) > pw(1), '层数越多威力越大');
}

console.log(bad ? `\n✗ ${bad} 项不通过` : '\n✓ 星陨印记全部生效');
process.exit(bad ? 1 : 0);
