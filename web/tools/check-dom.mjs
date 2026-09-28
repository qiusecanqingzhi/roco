/** 检查无头浏览器 dump 出来的 DOM，确认页面真的渲染了（而不是停在 loading 或报错） */
import fs from 'node:fs';
const file = process.argv[2];
const t = fs.readFileSync(file, 'utf8');
const count = (re) => (t.match(re) || []).length;

const checks = [
  ['精灵卡片 .card', count(/class="card"/g), (n) => n > 0],
  ['带编号的精灵链接', count(/data-spirit="/g), (n) => n > 0],
  ['技能图标 img', count(/skill-icon/g), (n) => n >= 0],
  ['系别 chip', count(/class="chip/g), (n) => n > 0],
  ['img 总数', count(/<img /g), (n) => n > 0],
  ['克制矩阵单元格', count(/class="mx/g), (n) => n >= 0],
  ['页脚数据版本', /数据版本/.test(t) ? 1 : 0, (n) => n === 1],
];

console.log(`检查 ${file}（${(t.length / 1024).toFixed(0)} KB）\n`);
let bad = 0;
for (const [label, val, ok] of checks) {
  const pass = ok(val);
  if (!pass) bad++;
  console.log(`  ${pass ? '✓' : '✗'} ${label.padEnd(16)} ${val}`);
}
const stuck = /正在加载数据/.test(t);
const failed = /数据加载失败/.test(t);
console.log(`  ${stuck ? '✗' : '✓'} 不在 loading 状态`);
if (stuck) bad++;
console.log(`  ${failed ? '✗' : '✓'} 没有加载失败提示`);
if (failed) bad++;

const ver = (t.match(/数据版本[^<]*/) || ['(未找到)'])[0];
console.log('\n页脚: ' + ver.replace(/\s+/g, ' ').trim().slice(0, 120));
const errText = (t.match(/数据加载失败[^<]*/) || [])[0];
if (errText) console.log('错误: ' + errText);

console.log(bad ? `\n✗ ${bad} 项不通过` : '\n✓ 全部通过');
process.exit(bad ? 1 : 0);
