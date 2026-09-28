/** 用参考页算例逐步验证（数据换成我自己库里的岚鸟/奇丽花） */
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('out/roco.sqlite');
const one = (s, ...a) => db.prepare(s).get(...a);
const all = (s, ...a) => db.prepare(s).all(...a);

const lan = one("select handbook_id, form_id, name, stat_physical_attack, types from spirit where name='岚鸟' and form_id=1");
const qi = one("select handbook_id, form_id, name, stat_physical_defense, stat_hp, types from spirit where name='奇丽花' and form_id=1");
const sf = one("select id, name, damage_max, category, damage_type from skill where name='扇风'");
console.log('岚鸟:', JSON.stringify(lan));
console.log('奇丽花:', JSON.stringify(qi));
console.log('扇风:', JSON.stringify(sf));

// 翼 -> 草 倍率
const wing = one("select id from type where name=?", '翼系');
const grass = one("select id from type where name=?", '草系');
const eff = one('select effect from type_matchup where attacking_type_id=? and defending_type_id=?', wing.id, grass.id).effect;
const EFFECT_MULT = { 1: 2, 0: 1, '-1': 0.5 };
const typeMult = EFFECT_MULT[String(eff)];
console.log(`\n翼系 -> 草系: effect=${eff} => ×${typeMult}  ${typeMult === 2 ? '✓ 与参考页 ×2 一致' : '✗'}`);

// 面板
const panelStat = (base, iv = 10, nature = 1) => Math.round((Math.round(1.1 * (base + 3 * iv)) + 10) * nature) + 50;
const atkStat = panelStat(lan.stat_physical_attack);
const defStat = panelStat(qi.stat_physical_defense);
console.log(`\n物攻 种族${lan.stat_physical_attack} -> ${atkStat}   参考页 234  ${atkStat === 234 ? '✓' : '（参考页个体/性格不同，正常）'}`);
console.log(`物防 种族${qi.stat_physical_defense} -> ${defStat}   参考页 226  ${defStat === 226 ? '✓' : '（同上）'}`);

// 用参考页的面板值跑一遍，验证公式本身
const run = (atk, def, tag) => {
  const effective = (sf.damage_max + 20) * (1 + 0.5);
  const stab = 1.25;
  const shown = Math.round(effective * stab * typeMult * 1 * 1);
  const lvCoef = (60 * 45 / 100 + 10) / 41;
  const dmg = Math.floor(Math.round(atk * shown * lvCoef) / def);
  console.log(`  ${tag}: 有效威力=${effective} 显示威力=${shown} 等级系数=${lvCoef.toFixed(6)} 伤害=${dmg}`);
  return { effective, shown, dmg };
};

console.log('\n=== 公式验证 ===');
const ref = run(234, 226, '用参考页面板 234/226');
console.log(`  期望 有效142.5 / 显示356 / 伤害332  => ${ref.effective === 142.5 && ref.shown === 356 && ref.dmg === 332 ? '✓ 完全吻合' : '✗ 不吻合'}`);
const mine = run(atkStat, defStat, `用我的面板 ${atkStat}/${defStat}`);
console.log(`  （我的数据算出来是 ${mine.dmg}，因为面板值不同）`);

console.log('\n=== 关键：如果映射搞反了会怎样 ===');
const wrong = Math.round(142.5 * 1.25 * 0.5 * 1);
console.log(`  旧映射(把克制当抵抗) 显示威力 = ${wrong} -> 伤害 ${Math.floor(Math.round(234 * wrong * ((60 * 45 / 100 + 10) / 41)) / 226)}`);
console.log('  => 差了 4 倍，这就是之前那个 bug 的影响量级');
db.close();
