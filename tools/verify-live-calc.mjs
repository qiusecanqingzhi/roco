/** 线上验收：伤害计算板块 + 克制映射修正 */
const base = 'https://qiusecanqingzhi.github.io/roco';
const [html, js, meta, spirits, matchups] = await Promise.all([
  fetch(base + '/index.html').then((r) => r.text()),
  fetch(base + '/app.js').then((r) => r.text()),
  fetch(base + '/data/meta.json').then((r) => r.json()),
  fetch(base + '/data/spirits.json').then((r) => r.json()),
  fetch(base + '/data/matchups.json').then((r) => r.json()),
]);

const tabs = [...html.matchAll(/data-tab="\w+">([^<]+)</g)].map((m) => m[1]);
console.log('导航栏      :', tabs.join(' / '));
console.log('伤害计算页签:', tabs.includes('伤害计算') ? '✓' : '✗');
console.log('EFFECT_MULT :', /EFFECT_MULT/.test(js) ? '✓ 已按官方 effect_values' : '✗');
console.log('旧类名残留  :', /mx-n1|mx-2|mx0"/.test(js) ? '✗ 还有' : '✓ 已清');
console.log('calcDamage  :', /function calcDamage|calcDamage\s*=/.test(js) ? '✓' : '✗');
console.log('本系用 typeId:', /includes\(sk\?\.typeId\)/.test(js) ? '✓' : '✗');

// 用线上数据复算一遍参考算例
const tid = (n) => meta.types.find((t) => t.name === n).id;
const eff = (a, d) => matchups.find((m) => m[0] === tid(a) && m[1] === tid(d))[2];
const EFFECT_MULT = { 1: 2, 0: 1, '-1': 0.5 };
const lan = spirits.find((s) => s.name === '岚鸟');
const qi = spirits.find((s) => s.name === '奇丽花');
const panel = (b, iv = 10) => Math.round(Math.round(1.1 * (b + 3 * iv)) + 10) + 50;
const atk = panel(lan.stats.patk), def = panel(qi.stats.pdef);
const shown = Math.round((75 + 20) * 1.5 * 1.25 * EFFECT_MULT[String(eff('翼系', '草系'))]);
const dmg = Math.floor(Math.round(atk * shown * ((60 * 45 / 100 + 10) / 41)) / def);
console.log(`\n线上数据复算: 物攻${atk} 物防${def} 显示威力${shown} 伤害${dmg}`);
console.log(`参考页算例  : 物攻234 物防226 显示威力356 伤害332`);
console.log(dmg === 332 ? '✓ 完全吻合' : '✗ 不吻合');
