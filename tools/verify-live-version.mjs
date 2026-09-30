/** 线上前端是否已是最新（含四技能槽等本轮改动） */
const base = 'https://qiusecanqingzhi.github.io/roco';
const html = await (await fetch(`${base}/index.html`)).text();
const ver = (/app\.js(\?v=[^"]*)?/.exec(html) ?? [])[1] ?? '';
console.log('  线上 app.js 版本号:', ver || '(无)');

const js = await (await fetch(`${base}/app.js${ver}`)).text();
const cssVer = (/style\.css(\?v=[^"]*)?/.exec(html) ?? [])[1] ?? '';
const css = await (await fetch(`${base}/style.css${cssVer}`)).text();

const checks = [
  ['四技能槽 calc-loadout', js, 'calc-loadout', true],
  ['防守方自动填 fillLoadoutWithTop', js, 'fillLoadoutWithTop', true],
  ['威力覆盖 opts.power', js, 'opts.power', true],
  ['六维卡片 stat-cards', js, 'stat-cards', true],
  ['性格整列唯一（禁用逻辑）', js, 'upUsedByOther', true],
  ['四技能槽样式 lo-table', css, 'lo-table', true],
  ['已去掉攻/防描边高亮', js, 'role-atk', false],
  ['已去掉独立性格·天分页', js, 'viewNature', false],
  ['已去掉候选配置预设', js, 'NATAL_PRESETS', false],
];

let bad = 0;
for (const [label, text, key, want] of checks) {
  const has = text.includes(key);
  if (has !== want) bad++;
  console.log(`  ${has === want ? '✓' : '✗'} ${label}${has === want ? '' : has ? '（应无）' : '（应有）'}`);
}
console.log(bad ? `\n✗ 线上还差 ${bad} 项` : '\n✓ 线上已包含本轮全部前端改动');
