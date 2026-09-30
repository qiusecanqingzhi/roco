/** 验证：卡片区的生命面板值 与 血量条的"总量"必须一致 */
import fs from 'node:fs';
import vm from 'node:vm';
import { makeEnv } from '../web/tools/dom-stub.mjs';

const bs = fs.readFileSync('web/data-bundle.js', 'utf8');
const bundle = JSON.parse(bs.replace(/^window\.ROCO_DATA\s*=\s*/, '').replace(/;\s*$/, ''));
const env = makeEnv({ withBundle: true, bundle });
vm.createContext(env.sandbox);
vm.runInContext(bs, env.sandbox);
vm.runInContext(fs.readFileSync('web/app.js', 'utf8'), env.sandbox);
await new Promise((r) => setTimeout(r, 80));
const api = env.window.__roco;

const plain = (el) => (el ? el.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '(无)');
const cardHp = (app, side) => {
  const card = [...app.querySelectorAll(`.stat-cards[data-calc-side="${side}"] .s-card`)]
    .find((c) => c.dataset.stat === 'hp');
  const m = /s-panel">(\d+)</.exec(card ? card.innerHTML : '');
  return m ? Number(m[1]) : null;
};
const barHp = (app, side) => {
  const box = [...app.querySelectorAll('.st-hp')][side === 'a' ? 0 : 1];
  const t = plain(box);
  const m = /(\d+)%\s*(\d+)\/(\d+)/.exec(t);
  return m ? { pct: Number(m[1]), cur: Number(m[2]), max: Number(m[3]) } : null;
};

api.STATE.view = 'calc';
api.STATE.calc.hpPctA = 100; api.STATE.calc.hpPctB = 100;
env.byId.get('app').innerHTML = '';
api.render();
let app = env.byId.get('app');

console.log('=== 初始（100%）===');
for (const side of ['a', 'b']) {
  const c = cardHp(app, side); const b = barHp(app, side);
  console.log(`  ${side}: 卡片 ${c} | 血量条 ${b.pct}% ${b.cur}/${b.max}  ${c === b.max ? '✓ 一致' : '✗ 不一致'}`);
}

console.log('\n=== 拖到 60% ===');
api.STATE.calc.hpPctA = 60;
env.byId.get('app').innerHTML = '';
api.render();
app = env.byId.get('app');
for (const side of ['a', 'b']) {
  const c = cardHp(app, side); const b = barHp(app, side);
  console.log(`  ${side}: 卡片 ${c} | 血量条 ${b.pct}% ${b.cur}/${b.max}  ${c === b.max ? '✓ 上限一致' : '✗'}  当前=${b.cur}`);
}

console.log('\n=== 换精灵后不残留上一只的血量 ===');
api.STATE.calc.hpPctA = 50;
api.STATE.calc.a = '152:1';     // 换成长血量的翼王
env.byId.get('app').innerHTML = '';
api.render();
app = env.byId.get('app');
{
  const c = cardHp(app, 'a'); const b = barHp(app, 'a');
  console.log(`  a: 卡片 ${c} | 血量条 ${b.pct}% ${b.cur}/${b.max}  ${c === b.max ? '✓ 上限一致' : '✗'}`);
  console.log(`     当前 ${b.cur} 应 = round(${c} × 50%) = ${Math.round(c * 0.5)}  ${b.cur === Math.round(c * 0.5) ? '✓' : '✗'}`);
  console.log(`     不再出现"当前 > 总量"：${b.cur <= b.max ? '✓' : '✗'}`);
}
