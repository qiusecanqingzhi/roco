/** 直接抓线上 app.js，逐步确认性格板块是否真的可渲染 */
const base = 'https://qiusecanqingzhi.github.io/roco';
const js = await (await fetch(base + '/app.js')).text();
console.log('线上 app.js 大小:', (js.length / 1024).toFixed(0), 'KB');

const checks = [
  ['VIEWS 含 nature', /VIEWS = \[[^\]]*'nature'[^\]]*\]/],
  ['fns 含 viewNature', /nature: viewNature/],
  ['viewNature 定义', /function viewNature\(/],
  ['NATURES 30 条', /const NATURES = \[/],
  ['stateIcon 定义', /function stateIcon\(/],
  ['panelStats6 定义', /function panelStats6\(/],
  ['bindView 绑定', /#nat-spirit/],
  ['CSS natal-panel', null],   // 单独查 style.css
];
for (const [label, re] of checks) {
  if (!re) continue;
  console.log(`  ${re.test(js) ? '✓' : '✗'} ${label}`);
}

const natCount = (js.slice(js.indexOf('const NATURES'), js.indexOf('const STAT_LABEL6')).match(/\['[^']+',\s*'/g) || []).length;
console.log(`  性格条数 ${natCount} ${natCount === 30 ? '✓' : '✗'}`);

const css = await (await fetch(base + '/style.css')).text();
for (const cls of ['.natal-panel', '.natal-sel', '.talent-box', '.natal-ic', '.nv-up', '.nv-down']) {
  console.log(`  ${css.includes(cls) ? '✓' : '✗'} style.css ${cls}`);
}

// 线上 index.html 的页签
const html = await (await fetch(base + '/index.html')).text();
const tabs = [...html.matchAll(/data-tab="(\w+)"/g)].map((m) => m[1]);
console.log('\n线上页签:', tabs.join(', '));
console.log('nature 页签:', tabs.includes('nature') ? '✓' : '✗');
console.log('index.html 有 statLine:', /id="statLine"/.test(html) ? '✓' : '✗');
