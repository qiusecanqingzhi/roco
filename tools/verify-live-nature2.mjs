/** 线上验收：性格/天分计算器（自由加点） */
const base = 'https://qiusecanqingzhi.github.io/roco';
const html = await (await fetch(base + '/index.html')).text();
const ver = [...html.matchAll(/app\.js(\?v=[^"]*)?"/g)][0]?.[1] ?? '';
const js = await (await fetch(base + '/app.js' + ver)).text();

console.log('资源版本号:', ver || '(无)');
const checks = [
  ['NATURE_MULT（加成1.2/削弱0.9）', /NATURE_MULT = \{ up: 1\.2, down: 0\.9/],
  ['生命独立公式（1.7/0.85/+70）', /base: 1\.7, iv: 0\.85, flat: 70, plus: 100/],
  ['每项性格开关 data-nat-btn', /data-nat-btn/],
  ['性格- 开关', /data-nat-kind="down"/],
  ['个体输入 0~60', /data-nat-iv/],
  ['星级选择', /nat-star/],
  ['一键套用性格', /data-nat-apply/],
  ['旧公式已移除', null],
];
for (const [label, re] of checks) {
  if (!re) continue;
  console.log(`  ${re.test(js) ? '✓' : '✗'} ${label}`);
}
console.log('  ' + (/1\.1 \* \(base \+ 3 \* iv\)/.test(js) ? '✗ 旧公式还在' : '✓ 旧公式已移除'));

// 用线上数据复算实测点
const spirits = await (await fetch(base + '/data/spirits.json')).json();
const wing = spirits.find((s) => s.name === '圣羽翼王');
const NC = { base: 1.1, iv: 0.55, flat: 10, plus: 50 };
const NM = { up: 1.2, down: 0.9, neutral: 1 };
const panel = (baseStat, iv, nat) => Math.round(Math.round(baseStat * NC.base + iv * NC.iv + NC.flat) * NM[nat] + NC.plus);
console.log(`\n线上数据复算 翼王速度(种族${wing.stats.spd}) 个体60 加成: ${panel(wing.stats.spd, 60, 'up')}  期望 267`);
