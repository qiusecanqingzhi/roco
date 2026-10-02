/** 用描述规则匹配技能，输出「技能ID -> 效果」表（真实 ID，附数值校验） */
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
const A2 = env.window.__roco.STATE;

const byName = new Map(A2.data.skills.map((s) => [s.name, s]));

// 每个技能名 -> 效果定义（kind + 参数）。参数从描述里抠出的数字来。
const DEFS = [
  // stack：description 里 "威力永久+N" / "回合结束时…永久+N"
  ['迫近攻击', { kind: 'stack', per: 45 }],
  ['吹火', { kind: 'stack', per: 20 }],
  ['能量刃', { kind: 'stack', per: 90 }],
  ['流星火雨', { kind: 'stack', per: 85 }],
  ['光能聚集', { kind: 'stack', per: 60 }],
  ['过曝', { kind: 'stack', per: 30 }],
  ['水波术', { kind: 'stack', per: 20 }],
  ['齿轮扭矩', { kind: 'stack', per: 15 }],
  ['微型斥候', { kind: 'stack', per: 20 }],
  ['山火', { kind: 'stack-x2' }],
  // cond
  ['见招拆招', { kind: 'cond', add: 55, when: '上回合使用状态技能' }],
  ['触底强击', { kind: 'cond', add: 120, when: '能量耗尽' }],
  ['气势一击', { kind: 'cond', add: 180, when: '上回合应对成功' }],
  ['急中生智', { kind: 'cond', add: 40, when: '自己有减益' }],
  ['破罐破摔', { kind: 'cond', add: 60, when: '自己有减益' }],
  ['星痕', { kind: 'cond', add: 40, when: '敌方有印记' }],
  ['筛管奔流', { kind: 'cond', add: 75, when: '自己生命 > 80%' }],
  ['当头棒喝', { kind: 'cond', add: 100, when: '敌方本回合更换精灵' }],
  ['极寒领域', { kind: 'cond', add: 60, when: '敌方有冻结' }],
  ['雪原狩猎', { kind: 'cond', add: 50, when: '天气为暴风雪' }],
  // hp-loss
  ['垂死反击', { kind: 'hp-loss', per: 5, step: 5, cap: 500, who: 'self' }],
  ['彗星', { kind: 'hp-loss', per: -10, step: 5, cap: 500, who: 'self' }],
  ['燃尽', { kind: 'hp-loss', per: -5, step: 5, who: 'def' }],
  // energy
  ['甜蜜陷阱', { kind: 'energy-per', per: 10 }],
  ['碎冰冰', { kind: 'energy-per', per: 20, of: '冻结层数' }],
  ['魔能爆', { kind: 'energy-all', table: [450000, 700000, 900000, 1100000, 1350000, 1550000, 1650000, 1800000, 1900000, 2000000, 2100000] }],
  // cost
  ['逆袭', { kind: 'cost-per', per: 50, dir: '+' }],
  ['涌泉', { kind: 'cost-per', per: 10, dir: '-' }],
  ['叠浪', { kind: 'cost-per', per: 10, dir: '-' }],
  // mult
  ['穿膛', { kind: 'mult', n: 5, when: '敌方能量 ≤ 2' }],
  ['背袭', { kind: 'mult', n: 20, when: '敌方能量 = 0' }],
  // cost-total
  ['冰锋横扫', { kind: 'cost-total', per: 10 }],
  // weight
  ['吨位压制', { kind: 'weight', table: [160, 140, 120, 100, 90, 80] }],
  ['以重制重', { kind: 'weight', table: [80, 90, 100, 120, 140, 160] }],
  ['砂糖弹球', { kind: 'weight', table: [20, 40, 60, 80, 100, 120] }],
  // adjacent
  ['钢钻', { kind: 'adjacent', div: 3 }],
  ['六自由度', { kind: 'adjacent-diff', div: 4 }],
];

const out = [];
console.log('技能名'.padEnd(12), 'ID'.padEnd(10), 'kind'.padEnd(14), '数值', ' 校验');
for (const [name, def] of DEFS) {
  const s = byName.get(name);
  if (!s) { console.log(`  ⚠ 找不到技能「${name}」`); continue; }
  // 校验：效果数值是否在该技能的 damage 数组里
  const arr = s.damage ?? [];
  const nums = def.kind === 'weight' ? def.table
    : def.kind === 'energy-all' ? def.table
      : [def.per, def.add, def.n, def.div].filter((x) => x !== undefined && x !== null && x !== 0).map(Math.abs);
  const bad = nums.filter((n) => !arr.includes(n));
  out.push({ id: s.id, name, def, arr });
  console.log(`  ${name.padEnd(12)} ${String(s.id).padEnd(10)} ${def.kind.padEnd(14)} ${JSON.stringify(nums)} ${bad.length ? '⚠ 缺 ' + JSON.stringify(bad) : '✓'}`);
}
console.log(`\n共 ${out.length} 条；带 ⚠ 的 ${out.filter((o) => {
  const nums = o.def.kind === 'weight' || o.def.kind === 'energy-all' ? o.def.table
    : [o.def.per, o.def.add, o.def.n, o.def.div].filter((x) => x !== undefined && x !== null && x !== 0).map(Math.abs);
  return nums.some((n) => !o.arr.includes(n));
}).length} 条（这些的数值不在数组里，属于"描述里有、数组没存"的情况）`);

// 输出可直接粘进 app.js 的表格
console.log('\n--- 生成代码 ---');
console.log('const SKILL_EFFECTS = {');
for (const { id, name, def } of out) {
  console.log(`  ${id}: ${JSON.stringify(def)},   // ${name}`);
}
console.log('};');
