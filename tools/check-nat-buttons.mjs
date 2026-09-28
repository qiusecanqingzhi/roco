/** 核实线上「性格−」开关是否真的存在 */
const base = 'https://qiusecanqingzhi.github.io/roco';
const html = await (await fetch(base + '/index.html')).text();
const m = /app\.js(\?v=[^"]*)?/.exec(html);
const ver = m?.[1] ?? '';
const js = await (await fetch(base + '/app.js' + ver)).text();

console.log('data-nat-kind 出现:', (js.match(/data-nat-kind/g) || []).length, '次');
const i = js.indexOf('const btn =');
console.log('\nbtn 定义源码:');
console.log(js.slice(i, i + 300));
console.log('\nnatalRow 里调用的三个按钮:');
const j = js.indexOf("btn('up'");
console.log(js.slice(j, j + 200));
