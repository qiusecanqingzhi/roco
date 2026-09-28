import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('out/roco.sqlite');
const q = (s) => db.prepare(s).all().map((r) => Object.assign({}, r));

console.log('=== spirit_skill 里 legendary 的 7 条 ===');
for (const r of q("select handbook_id, form_id, spirit_name, skill_id, skill_name, unlock_level, category from spirit_skill where source_type='legendary' order by handbook_id")) {
  console.log(`  #${String(r.handbook_id).padStart(3)} f${r.form_id} ${String(r.spirit_name).padEnd(8)} ${String(r.skill_id).padEnd(9)} ${String(r.skill_name).padEnd(6)} Lv${r.unlock_level ?? '-'} ${r.category}`);
}

console.log('\n=== 这些技能在技能库里吗？ ===');
for (const r of q("select distinct skill_id from spirit_skill where source_type='legendary'")) {
  const s = db.prepare('select id, name, category, energy_cost, damage_max, damage_type, description from skill where id=?').get(r.skill_id);
  console.log(`  ${s ? '✓' : '✗'} ${r.skill_id} ${s ? `${s.name} ${s.category} 能耗${s.energy_cost} 威力${s.damage_max} ${s.damage_type}` : ''}`);
}

console.log('\n=== 界面渲染时会被归到哪一类？ ===');
console.log('  spiritSkillsOf() 的桶: level / machine / passive（+ 兜底的动态桶）');
console.log('  legendary 会落进动态桶 out.legendary，但模板里只渲染 level/machine/passive');
console.log('  => 所以这 7 条从来不显示');

console.log('\n=== 这 7 条属于哪些精灵 ===');
console.log(q("select count(distinct handbook_id) n from spirit_skill where source_type='legendary'"));
db.close();
