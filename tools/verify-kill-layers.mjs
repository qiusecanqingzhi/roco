/** 验证「星陨斩杀」列：这一招 + N 层星陨刚好一轮打死对面 */
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

const spA = () => A2.bySpirit.get(A2.calc.a);
const spB = () => A2.bySpirit.get(A2.calc.b);
const targetHp = () => api.targetHpOf('b', spB());

const setup = (marked) => {
  A2.view = 'calc';
  A2.calc.a = '20:1'; A2.calc.b = '43:1'; A2.calc.skillA = 7150060;
  A2.calc.hpPctA = 100; A2.calc.hpPctB = 100;
  A2.calc.statusA = { picks: [], star: 0, layers: {} };
  A2.calc.statusB = { picks: marked ? ['starfall-mark'] : [], star: marked ? 0 : 0, layers: {} };
  A2.calc.statusPctA = {}; A2.calc.statusPctB = {};
  A2.calc.modsA = { patkPct: 0, satkPct: 0, pdefPct: 0, sdefPct: 0, spdAdd: 0, powerPct: 0, powerAdd: 0, finalPct: 100 };
  A2.calc.modsB = { ...A2.calc.modsA };
  env.byId.get('app').innerHTML = '';
  api.render();
};

console.log('① 对面没挂星陨印记 -> 不适用');
{
  setup(false);
  const app = env.byId.get('app');
  const cells = [...app.querySelectorAll('.lo-kill')];
  ck(cells.length > 0, `两张表都有「星陨斩杀」列（共 ${cells.length} 个格子）`);
  ck(cells.every((c) => /—/.test(c.innerHTML)), '全部显示「—」');
  ck(/勾上.*星陨印记/.test(app.innerHTML) || /星陨印记/.test(app.innerHTML), '给了「要勾星陨印记」的提示');
}

console.log('\n② 勾上星陨印记 -> 出层数，且确实刚好够斩杀');
{
  setup(true);
  const app = env.byId.get('app');
  const sk = [...A2.data.skills].find((s) => s.cat === '物理' && (s.dmgMax ?? 0) > 0 && s.typeId !== A2.typeByName.get('幻系').id);
  const n = api.starfallKillLayers(spA(), spB(), sk, { sendGlobal: false });
  ck(n !== null && n > 0, `物理技能「${sk.name}」需要 ${n} 层`);
  const hp = targetHp();
  // 验证 n 层真的够，且 n-1 层不够
  const dmgAt = (layers) => api.damageWithPower(spA(), spB(), sk, sk.dmgMax ?? 0, {})
    + api.damageWithPower(spA(), spB(), sk, api.starfallPower(layers), { phantom: true });
  ck(dmgAt(n) >= hp, `${n} 层总伤害 ${dmgAt(n)} ≥ 目标血量 ${hp}`);
  console.log(`     参考：0 层 ${dmgAt(0)} / ${n - 1} 层 ${dmgAt(n - 1)} / ${n} 层 ${dmgAt(n)}`);
  if (n > 1) {
    // 只有当 n 确实是"最少"时，n−1 才应该不够
    // （这里按定义必然成立，断言用来钉住二分/邻域搜索没有跳过头）
    ck(dmgAt(n - 1) < hp, `${n - 1} 层总伤害 ${dmgAt(n - 1)} 不足以斩杀（< ${hp}）`);
  }
  ck(dmgAt(0) < hp, '本身打不死（所以确实需要星陨补伤害）');

  // 星陨那段要按幻系算（换目标会变）
  const phantom = A2.data.spirits.find((s) => s.formId === 1 && api.typeEffect(A2.typeByName.get('幻系').id, s.types) !== 1);
  if (phantom) {
    A2.calc.b = `${phantom.id}:${phantom.formId}`;
    env.byId.get('app').innerHTML = '';
    api.render();
    const n2 = api.starfallKillLayers(spA(), spB(), sk, {});
    ck(n2 !== n, `换目标后所需层数变化（${n} -> ${n2}）`);
  }
}

console.log('\n③ 幻系技能不触发星陨');
{
  setup(true);
  const phantomId = A2.typeByName.get('幻系').id;
  const ph = [...A2.data.skills].find((s) => s.typeId === phantomId && (s.dmgMax ?? 0) > 0);
  if (ph) {
    ck(api.starfallKillLayers(spA(), spB(), ph, {}) === null, `幻系技能「${ph.name}」不触发星陨（返回 null）`);
  } else {
    console.log('    （数据里没有带威力的幻系技能，跳过）');
  }
}

console.log('\n④ 本身就能打死 -> 「不需要」');
{
  setup(true);
  A2.calc.hpPctB = 5;   // 把对面血量压得很低
  env.byId.get('app').innerHTML = '';
  api.render();
  const sk = [...A2.data.skills].find((s) => s.cat === '物理' && (s.dmgMax ?? 0) > 0);
  const n = api.starfallKillLayers(spA(), spB(), sk, {});
  ck(n === 0, `对面只剩 5% 血时返回 0（实际 ${n}）`);
  const app = env.byId.get('app');
  ck(/不需要/.test(app.innerHTML), '页面显示「不需要」');
}

console.log('\n⑤ 两处口径不同（四技能槽含全局加成 / 排序表是裸威力）');
{
  setup(true);
  const sk = [...A2.data.skills].find((s) => s.cat === '物理' && (s.dmgMax ?? 0) > 0 && s.typeId !== A2.typeByName.get('幻系').id);
  const bare = api.starfallKillLayers(spA(), spB(), sk, { sendGlobal: false });
  const glob = api.starfallKillLayers(spA(), spB(), sk, { sendGlobal: true });
  console.log(`    裸威力口径 ${bare} 层 / 含全局加成 ${glob} 层`);
  ck(glob <= bare, `含加成时所需层数不会更多（${glob} ≤ ${bare}）`);
}

console.log('\n⑥ 页面上真的渲染出数字');
{
  setup(true);
  const app = env.byId.get('app');
  const loCells = [...app.querySelectorAll('.lo-table .lo-kill')].map(plain);
  const rankCells = [...app.querySelectorAll('.section .lo-kill')].map(plain);
  console.log('    四技能槽列:', loCells.join(' | '));
  console.log('    排序表列:  ', rankCells.slice(0, 6).join(' | '), rankCells.length > 6 ? '…' : '');
  ck(loCells.length === 8, `两侧四技能槽各有 4 行斩杀列（共 ${loCells.length}）`);
  ck(loCells.every((t) => /\d+ 层|—|不需要/.test(t)), '四技能槽的格子都有内容');
  ck(rankCells.length > 0 && rankCells.some((t) => /\d+ 层|—|不需要/.test(t)), '排序表有斩杀列');
}

console.log(bad ? `\n✗ ${bad} 项不通过` : '\n✓ 星陨斩杀列全部生效');
process.exit(bad ? 1 : 0);
