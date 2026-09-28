/** 检查移除「推荐队伍」后是否有残留引用 */
import fs from 'node:fs';

const checks = [
  ['web/app.js', [/viewTeams/, /teamCard/, /#\/teams/, /推荐队伍/, /skills\.blood/, /\.teams\b/]],
  ['web/index.html', [/data-tab="teams"/, /推荐队伍/, /#\/teams/]],
  ['web/style.css', [/^\.teams\b/m, /^\.team\b/m, /\.team \./]],
  ['tools/check-live.mjs', [/teams/]],
];

let bad = 0;
for (const [file, pats] of checks) {
  if (!fs.existsSync(file)) continue;
  const t = fs.readFileSync(file, 'utf8');
  const hits = [];
  for (const p of pats) if (p.test(t)) hits.push(String(p));
  if (hits.length) { bad++; console.log(`✗ ${file} 仍有: ${hits.join('  ')}`); }
  else console.log(`✓ ${file} 无队伍残留`);
}

// 数据文件应该保留（用户选择只删页面）
console.log('\n数据文件是否保留（按选择应保留）:');
for (const f of ['web/data/teams.json', 'web/data/team_members.json']) {
  console.log(`  ${fs.existsSync(f) ? '✓ 保留' : '✗ 已删'} ${f}`);
}
const bundle = fs.readFileSync('web/data-bundle.js', 'utf8');
console.log(`  bundle 里 teams 字段: ${/"teams":/.test(bundle) ? '✓ 还在（数据未动）' : '✗ 没了'}`);

// 导航栏实际内容
const html = fs.readFileSync('web/index.html', 'utf8');
const tabs = [...html.matchAll(/data-tab="(\w+)">([^<]+)</g)].map((m) => m[2]);
console.log('\n导航栏现在有:', tabs.join(' / '));

process.exit(bad ? 1 : 0);
