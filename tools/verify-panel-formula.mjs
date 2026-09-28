/** 验证新公式：翼王 267、水灵 214/163/205 */
const STAT_COEF = { hp: { base: 1.7, iv: 0.85, flat: 70, plus: 100 } };
const NC = { base: 1.1, iv: 0.55, flat: 10, plus: 50 };
const NM = { up: 1.2, down: 0.9, neutral: 1 };
const panel = (stat, baseStat, iv = 0, nat = 'neutral') => {
  const c = STAT_COEF[stat] ?? NC;
  return Math.round(Math.round(baseStat * c.base + iv * c.iv + c.flat) * NM[nat] + c.plus);
};
const panelInt = (...a) => Math.round(panel(...a));

let bad = 0;
const check = (label, got, want) => {
  const ok = Math.round(got) === want;
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: 算得 ${Math.round(got)}  期望 ${want}`);
};

console.log('=== 你的题：圣羽翼王 速度 ===');
console.log('  速度种族 125、个体 60（天分10 × 5★）、性格加成 ×1.2');
check('翼王速度', panel('spd', 125, 60, 'up'), 267);

console.log('\n=== 图一 水灵（个体加在 生命/魔攻/速度，加速度减物攻）===');
check('水灵速度', panel('spd', 85, 60, 'up'), 214);
check('水灵物防', panel('pdef', 94, 0, 'neutral'), 163);
check('水灵魔防', panel('mdef' in {} ? 'sdef' : 'sdef', 132, 0, 'neutral'), 205);

console.log('\n=== 星级对个体的影响（天分10）===');
const STAR = { 1: 1.2, 2: 2.4, 3: 3.6, 4: 4.8, 5: 6 };
for (const s of [1, 2, 3, 4, 5]) {
  const iv = Math.round(10 * STAR[s]);
  console.log(`  ${s}★ 天分10 -> 个体 ${String(iv).padStart(2)} -> 翼王速度 ${panel('spd', 125, iv, 'up')}`);
}

console.log('\n=== 天分对速度的影响（5★）===');
for (const t of [0, 5, 8, 9, 10]) {
  const iv = Math.round(t * 6);
  console.log(`  天分 ${String(t).padStart(2)} -> 个体 ${String(iv).padStart(2)} -> 翼王速度 ${panel('spd', 125, iv, 'up')}`);
}

console.log('\n=== 三档性格对比（个体60）===');
for (const n of ['up', 'neutral', 'down']) {
  console.log(`  ${n.padEnd(7)} -> 翼王速度 ${panel('spd', 125, 60, n)}`);
}

console.log('\n=== 生命公式核对（水灵 种族125，图一实测 434）===');
for (const iv of [0, 30, 60]) {
  for (const n of ['up', 'neutral']) {
    console.log(`  个体${String(iv).padStart(2)} ${n.padEnd(7)} -> ${panel('hp', 125, iv, n)}`);
  }
}

console.log(bad === 0 ? '\n✓ 三个实测点全部吻合' : `\n✗ ${bad} 项不吻合`);
