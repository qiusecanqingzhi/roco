import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

console.log('=== 1) 我抓的精灵详情 JSON 里有哪些字段 ===');
const f = fs.readdirSync('out/.cache').find((x) => /_spirit_1\.json$/.test(x));
const d = JSON.parse(fs.readFileSync('out/.cache/' + f, 'utf8'));
console.log(Object.keys(d).join(', '));

console.log('\n=== 2) 搜关键词：天分/资质/性格/个体/nature/talent/aptitude/individual ===');
const keys = Object.keys(d);
const hit = keys.filter((k) => /nature|talent|aptitude|individual|character|personality|gift|potential|innate/i.test(k));
console.log('  英文命中:', hit.length ? hit.join(', ') : '(无)');
const zh = keys.filter((k) => /天分|资质|性格|个体|天资/.test(k));
console.log('  中文命中:', zh.length ? zh.join(', ') : '(无)');

console.log('\n=== 3) 全库表名与列名里搜 ===');
const db = new DatabaseSync('out/roco.sqlite');
const tables = db.prepare("select name from sqlite_master where type='table'").all().map((r) => r.name);
console.log('  表:', tables.join(', '));
for (const t of tables) {
  const cols = db.prepare(`pragma table_info(${t})`).all().map((c) => c.name);
  const m = cols.filter((c) => /nature|talent|aptitude|individual|天分|资质|性格|个体/.test(c));
  if (m.length) console.log(`  ${t}: ${m.join(', ')}`);
}
console.log('  (以上没列出的表都没有相关列)');

console.log('\n=== 4) 站点的 manifest.json 里有没有别的数据入口 ===');
const mf = fs.readdirSync('out/.cache').find((x) => x.includes('manifest'));
const m = JSON.parse(fs.readFileSync('out/.cache/' + mf, 'utf8'));
console.log('  manifest 顶层键:', Object.keys(m).join(', '));
if (m.counts) console.log('  counts:', JSON.stringify(m.counts));

console.log('\n=== 5) 单个精灵详情里的完整结构（看有没有藏着性格表）===');
console.log(JSON.stringify(d, null, 1).slice(0, 1800));
db.close();
