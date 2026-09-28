/** 线上验收：性格 · 天分 板块 */
const base = 'https://qiusecanqingzhi.github.io/roco';
const [html, js] = await Promise.all([
  fetch(base + '/index.html').then((r) => r.text()),
  fetch(base + '/app.js').then((r) => r.text()),
]);

const tabs = [...html.matchAll(/data-tab="\w+">([^<]+)</g)].map((m) => m[1]);
console.log('导航栏:', tabs.join(' / '));
console.log('性格页签:', tabs.some((t) => t.includes('性格')) ? '✓' : '✗');

// 数一数性格表条数
const natBlock = js.slice(js.indexOf('const NATURES'), js.indexOf('const STAT_LABEL6'));
const natCount = (natBlock.match(/\['[^']+',\s*'(hp|patk|satk|pdef|sdef|spd)'/g) || []).length;
console.log('NATURES 条数:', natCount, natCount === 30 ? '✓' : '✗');
console.log('天分档位:', /了不起的天分/.test(js) ? '✓' : '✗');
console.log('校验自检:', /性格数据校验失败/.test(js) ? '✓ 有启动自检' : '✗');
console.log('六维含生命修正:', /nat\.up === k \? 1\.1 : nat\.down === k \? 0\.9/.test(js) ? '✓' : '✗');
console.log('各属性最优性格:', /各属性最优性格/.test(js) ? '✓' : '✗');
