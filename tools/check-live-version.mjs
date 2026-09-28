/** 线上到底是哪一版 */
const base = 'https://qiusecanqingzhi.github.io/roco';
const html = await (await fetch(base + '/index.html')).text();
const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))(\?v=[^"]*)?"/g)].map((m) => m[1] + (m[2] ?? ''));
console.log('线上资源:', assets.join('  '));
const ver = /app\.js(\?v=[^"]*)?/.exec(html)?.[1] ?? '';
const js = await (await fetch(base + '/app.js' + ver)).text();

console.log('\n线上 app.js 里的能力:');
const checks = [
  ['详情页加点面板 natalBlock', 'natalBlock'],
  ['弹窗内绑定 bindNatalBlock', 'bindNatalBlock'],
  ['天分选择 dnat-talent', 'dnat-talent'],
  ['性格开关 data-nat-kind', 'data-nat-kind'],
  ['性格页 viewNature（上一版）', 'viewNature'],
  ['伤害计算 viewCalc', 'viewCalc'],
];
for (const [label, key] of checks) console.log(`  ${js.includes(key) ? '✓' : '✗'} ${label}`);

console.log('\n本地已提交但未推送的提交:');
