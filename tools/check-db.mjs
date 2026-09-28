import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2] ?? 'out/roco.sqlite');
const one = (s) => db.prepare(s).get();
const q = (s) => db.prepare(s).all().map((r) => Object.assign({}, r));

const tables = q("select name from sqlite_master where type='table' order by name").map((r) => r.name);
console.log('表数:', tables.length, '->', tables.join(', '));

if (tables.includes('spirit_bloodline')) {
  console.log('\nspirit_bloodline:');
  console.log('  行数:', one('select count(*) c from spirit_bloodline').c);
  console.log('  精灵数:', one('select count(distinct handbook_id) c from spirit_bloodline').c);
  console.log('  血脉种类:', one('select count(distinct bloodline_id) c from spirit_bloodline').c);
  console.log('  有血脉图标的:', one("select count(*) c from spirit_bloodline where bloodline_icon <> ''").c);
  console.log('  有秘药图标的:', one("select count(*) c from spirit_bloodline where grant_item_icon <> ''").c);
  console.log('  有技能图标的:', one("select count(*) c from spirit_bloodline where skill_icon <> ''").c);
  console.log('\n  果实立方人的前 4 条:');
  for (const r of q('select bloodline_name, skill_name, unlock_level, skill_icon from spirit_bloodline where handbook_id=466 order by bloodline_id limit 4')) {
    console.log(`    ${r.bloodline_name.padEnd(8)} ${r.skill_name.padEnd(6)} Lv${r.unlock_level ?? '-'}  ${String(r.skill_icon).split('/').pop()}`);
  }
}
if (tables.includes('passive_skill')) console.log('\npassive_skill:', one('select count(*) c from passive_skill').c, '行');
db.close();
