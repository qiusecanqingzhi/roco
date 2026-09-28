/** 线上验收：资源版本号是否生效、性格页是否在 */
const base = 'https://qiusecanqingzhi.github.io/roco';
const html = await (await fetch(base + '/index.html')).text();

const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))(\?v=[^"]*)?"/g)]
  .map((m) => ({ file: m[1], ver: m[2] ?? '' }));
console.log('线上 index.html 的资源引用:');
for (const a of assets) console.log(`  ${a.file}${a.ver}${a.ver ? '  ✓ 带版本号' : '  ✗ 裸引用（会被缓存）'}`);
console.log('全部带版本号:', assets.every((a) => a.ver) ? '✓' : '✗');

const tabs = [...html.matchAll(/data-tab="\w+">([^<]+)</g)].map((m) => m[1]);
console.log('\n导航栏:', tabs.join(' / '));

// 用带版本号的 URL 抓 app.js，确认拿到的是新版
const ver = assets.find((a) => a.file === 'app.js')?.ver ?? '';
const js = await (await fetch(base + '/app.js' + ver)).text();
console.log('app.js 版本化抓取:', (js.length / 1024).toFixed(0), 'KB');
console.log('含性格板块:', /天分 · 资质 · 性格/.test(js) ? '✓' : '✗');
console.log('NATURES 条数:', (js.slice(js.indexOf('const NATURES'), js.indexOf('const STAT_LABEL6')).match(/\['[^']+',\s*'/g) || []).length);
