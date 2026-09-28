import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('out/roco.sqlite');
const one = (s) => db.prepare(s).get();
console.log('表行数:', ['spirit', 'skill', 'spirit_skill', 'skill_learner', 'type', 'type_matchup']
  .map((t) => `${t}=${one(`select count(*) c from ${t}`).c}`).join('  '));
const q = (s) => db.prepare(s).all().map((r) => Object.assign({}, r));
console.log('\n系别:', q('select id,name,short_name from type order by id').length, '条');
console.log(q('select id,name,short_name,status_immunities from type limit 4'));
console.log('\n克制表 水 -> 火:');
console.log(q(`select a.name atk, d.name def, m.effect from type_matchup m
  join type a on a.id=m.attacking_type_id and a.locale=m.locale
  join type d on d.id=m.defending_type_id and d.locale=m.locale
  where a.short_name='水' and d.short_name='火'`));
console.log('克制表 草 -> 火:');
console.log(q(`select a.short_name atk, d.short_name def, m.effect from type_matchup m
  join type a on a.id=m.attacking_type_id and a.locale=m.locale
  join type d on d.id=m.defending_type_id and d.locale=m.locale
  where a.short_name='草' and d.short_name='火'`));
console.log('\n果实立方人(#466) 技能来源分布:', q('select source_type, count(*) c from spirit_skill where handbook_id=466 group by source_type'));
console.log('果实立方人 前 6 个等级技能:', q("select skill_name, unlock_level, category from spirit_skill where handbook_id=466 and source_type='level' order by unlock_level limit 6"));
console.log('\n谁会【飞叶】:', q("select spirit_name, source_group, unlock_level from skill_learner where skill_name='飞叶'"));
console.log('\n种族值前 5:', q('select name, types, base_stat_total from spirit where form_id=1 order by base_stat_total desc limit 5'));
console.log('\n双系精灵:', one('select count(*) c from spirit where type_count=2').c, ' 单系:', one('select count(*) c from spirit where type_count=1').c);
console.log('含被动技能的精灵:', one('select count(*) c from spirit_skill where source_type=\'passive\'').c);
db.close();
