/** 用参考页的算例验证我实现的公式（岚鸟 扇风 打 奇丽花） */
const num = (v) => v;

// ① 面板：物攻 = round((round(1.1 * (种族 + 3*个体)) + 10) * 性格) + 50
const panelStat = (base, iv, nature = 1) => Math.round((Math.round(1.1 * (base + 3 * iv)) + 10) * nature) + 50;

const atk = panelStat(128, 10, 1);
const def = panelStat(121, 10, 1);
console.log('=========== ① 面板换算 ===========');
console.log(`岚鸟物攻: 种族128 个体10 -> ${atk}   期望 234  ${atk === 234 ? '✓' : '✗'}`);
console.log(`奇丽花物防: 种族121 个体10 -> ${def}   期望 226  ${def === 226 ? '✓' : '✗'}`);

// ② 有效威力
const base = 75, flatAdd = 20, pct = 0.5;
const effective = (base + flatAdd) * (1 + pct);
console.log('\n=========== ② 有效威力 ===========');
console.log(`(${base} + ${flatAdd}) x (1 + ${pct * 100}%) = ${effective}   期望 142.5  ${effective === 142.5 ? '✓' : '✗'}`);

// ③ 显示威力
const stab = 1.25, typeEff = 2, levelZone = 1, misc = 1;
const shown = Math.round(effective * stab * typeEff * levelZone * misc);
console.log('\n=========== ③ 显示威力 ===========');
console.log(`round(${effective} x ${stab} x ${typeEff} x ${levelZone}) = ${shown}   期望 356  ${shown === 356 ? '✓' : '✗'}`);

// ④ 预计伤害
const level = 60;
const levelCoef = (level * 45 / 100 + 10) / 41;
console.log('\n=========== ④ 等级系数 ===========');
console.log(`(${level} * 45/100 + 10) / 41 = ${levelCoef}   (37/41 = ${37 / 41})  满级60 -> 期望 37/41  ${Math.abs(levelCoef - 37 / 41) < 1e-9 ? '✓' : '✗'}`);

const inner = Math.round(atk * shown * levelCoef);
const dmg = Math.floor((inner / def) * misc);
console.log('\n=========== ④ 预计伤害 ===========');
console.log(`round(${atk} x ${shown} x ${levelCoef.toFixed(6)}) = ${inner}`);
console.log(`floor(${inner} / ${def} x ${misc}) = ${dmg}   期望 332  ${dmg === 332 ? '✓' : '✗'}`);

// 顺带验证页面提到的「伤害百分比」
console.log(`\n伤害百分比: ${dmg} / 411 = ${(dmg / 411 * 100).toFixed(0)}%   期望 81%`);
