/**
 * 一致性验证：同一技能，排序表（单技能栏）与四技能槽算出的伤害必须相同，
 * 且四技能槽的"威力覆盖"必须真的改变伤害。
 */
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

// —— 干净起点：A=噼啪鸟，B=奇丽花，两侧加点都清空，技能选扇风 ——
api.STATE.calc.a = '272:1';
api.STATE.calc.b = '43:1';
api.STATE.calc.skillA = 7150060;
api.STATE.calc.loadA = [null, null, null, null];
api.STATE.calc.powA = [null, null, null, null];
api.STATE.calc.hitA = [1, 1, 1, 1];
for (const side of ['a', 'b']) {
  const sp = api.STATE.bySpirit.get(api.STATE.calc[side]);
  const c = api.withCalcSide(side, () => api.spiritCalcOf(sp));
  // ⚠ iv 和 nature 都要清：spiritCalcOf 返回的是活引用，
  //   之前测试留下的 nature（比如 satk = 'up'）会让这里悄悄带上 1.2 倍性格。
  for (const k of ['hp', 'patk', 'satk', 'pdef', 'sdef', 'spd']) c.stats[k] = { iv: 0, nature: 'neutral' };
}
api.STATE.view = 'calc';
env.byId.get('app').innerHTML = '';
api.render();

const app = env.byId.get('app');
const plain = (el) => el.innerHTML.replace(/<[^>]+>/g, '\u0001').split('\u0001').map((s) => s.trim()).filter(Boolean);

// 排序表第一行（伤害最高的技能）
const rankRow = app.querySelector('[data-calc-pick]');
const rankId = Number(rankRow.dataset.calcPick);
const rankCells = plain(rankRow.closest('tr') || rankRow);
console.log('排序表第一行:', rankCells.join(' | '));

// 把它放进 A 侧槽 1，重渲染，比较两个数
api.STATE.loadA0 = rankId;
api.STATE.calc.loadA[0] = rankId;
env.byId.get('app').innerHTML = '';
api.render();
const loRow = env.byId.get('app').querySelector('[data-loadout="a"] .lo-table tbody tr');
const loCells = plain(loRow);
console.log('技能槽第 1 行:', loCells.join(' | '));

const rankDmg = Number(rankCells[rankCells.length - 2] ?? rankCells[rankCells.length - 1]);
console.log('\n排序表伤害（裸威力）=', rankDmg);
const loDmg = Number((loRow.querySelector('.lo-dmg').innerHTML.match(/<b>(\d+)<\/b>/) || [])[1]);
console.log('技能槽伤害（含全局参数）=', loDmg);

// 打印两侧配置，看看排序表与技能槽各自读到了什么
for (const side of ['a', 'b']) {
  const sp = api.STATE.bySpirit.get(api.STATE.calc[side]);
  const c = api.withCalcSide(side, () => api.spiritCalcOf(sp));
  console.log(`  ${side} 侧配置:`, JSON.stringify(Object.fromEntries(['hp', 'patk', 'satk', 'pdef', 'sdef', 'spd'].map((k) => [k, `${c.stats[k].iv}/${c.stats[k].nature}`]))));
}
console.log('  level/flatAdd/skillPct:', api.STATE.calc.level, api.STATE.calc.flatAdd, api.STATE.calc.skillPct);
{
  const a = api.STATE.bySpirit.get(api.STATE.calc.a);
  const b = api.STATE.bySpirit.get(api.STATE.calc.b);
  const sk = api.STATE.bySkill.get(rankId);
  const cfgA = api.withCalcSide('a', () => api.spiritCalcOf(a));
  const r = api.calcDamage(a, b, sk, {
    level: api.STATE.calc.level,
    atkIV: cfgA.stats.satk.iv, atkNature: cfgA.stats.satk.nature,
    power: sk.dmgMax,
    flatAdd: api.STATE.calc.flatAdd, skillPct: api.STATE.calc.skillPct,
  });
  console.log('  手算（含 flatAdd/skillPct）:', 'effective =', r.effective, 'shown =', r.shown, 'dmg =', r.dmg);
  const r2 = api.calcDamage(a, b, sk, { level: api.STATE.calc.level, atkIV: cfgA.stats.satk.iv, atkNature: cfgA.stats.satk.nature, power: sk.dmgMax });
  console.log('  手算（不含 flatAdd/skillPct）:', 'effective =', r2.effective, 'shown =', r2.shown, 'dmg =', r2.dmg);
}

// 两者本来就不同参数：
//   排序表 = 裸威力（不含全局 flatAdd / skillPct），与官方说明页算例对照用
//   四技能槽 = 实际会打的伤害（含全局 flatAdd / skillPct）
// 所以这里验证的是"技能槽 == 带全局参数的手算"。
{
  const a = api.STATE.bySpirit.get(api.STATE.calc.a);
  const b = api.STATE.bySpirit.get(api.STATE.calc.b);
  const sk = api.STATE.bySkill.get(rankId);
  const cfgA = api.withCalcSide('a', () => api.spiritCalcOf(a));
  const withGlobals = api.calcDamage(a, b, sk, {
    level: api.STATE.calc.level,
    atkIV: cfgA.stats.satk.iv, atkNature: cfgA.stats.satk.nature,
    power: sk.dmgMax,
    flatAdd: api.STATE.calc.flatAdd, skillPct: api.STATE.calc.skillPct,
  }).dmg;
  const noGlobals = api.calcDamage(a, b, sk, {
    level: api.STATE.calc.level,
    atkIV: cfgA.stats.satk.iv, atkNature: cfgA.stats.satk.nature,
    power: sk.dmgMax,
  }).dmg;
  console.log(`\n技能槽伤害 ${loDmg} vs 带全局参数手算 ${withGlobals} ${loDmg === withGlobals ? '✓ 一致' : '✗'}`);
  console.log(`排序表伤害 ${rankDmg} vs 裸威力手算 ${noGlobals} ${rankDmg === noGlobals ? '✓ 一致（排序表刻意不含全局加成）' : '✗'}`);
  if (loDmg !== withGlobals) process.exitCode = 1;
  if (rankDmg !== noGlobals) process.exitCode = 1;
}

// 威力覆盖真的生效吗：改成一半威力，伤害应约减半
console.log('\n=== 威力覆盖 ===');
const baseLo = loDmg;
env.byId.get('app').querySelector('[data-lo-pow="a:0"]').value = '50';
env.byId.get('app').querySelector('[data-lo-pow="a:0"]').dispatch('change');
const after = Number((env.byId.get('app').querySelector('[data-loadout="a"] .lo-dmg').innerHTML.match(/<b>(\d+)<\/b>/) || [])[1]);
console.log(`威力 100 -> 50：伤害 ${baseLo} -> ${after} ${after < baseLo ? '✓ 生效' : '✗ 没生效'}`);
// 连击
env.byId.get('app').querySelector('[data-lo-hit="a:0"]').value = '2';
env.byId.get('app').querySelector('[data-lo-hit="a:0"]').dispatch('change');
const cell = env.byId.get('app').querySelector('[data-loadout="a"] .lo-dmg');
const withHit = Number((cell.innerHTML.match(/<b>(\d+)<\/b>/) || [])[1]);
console.log(`连击 1 -> 2：总伤害 ${after} -> ${withHit} ${withHit === after * 2 ? '✓ 翻倍' : '✗'}`);
console.log('  该行文本:', plain(cell).join(' '));
