/** 目标验收：卡片区结构 + 双栏并排 + 窄屏堆叠 */
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

api.STATE.calc.a = '20:1'; api.STATE.calc.b = '43:1';
api.STATE.calc.skillA = 7150060; api.STATE.calc.skillB = null;
api.STATE.view = 'calc';
env.byId.get('app').innerHTML = '';
api.render();
const app = env.byId.get('app');
const css = fs.readFileSync('web/style.css', 'utf8');

console.log('=== ① 六维卡片区 ===');
const cardsA = app.querySelectorAll('.stat-cards[data-calc-side="a"] .s-card');
const cardsB = app.querySelectorAll('.stat-cards[data-calc-side="b"] .s-card');
console.log(`  A 侧卡片 ${cardsA.length} 张 / B 侧 ${cardsB.length} 张  ${cardsA.length === 6 && cardsB.length === 6 ? '✓ 3×2' : '✗'}`);
const grid = /\.stat-cards\s*\{[^}]*grid-template-columns:\s*repeat\(3/.test(css);
console.log(`  网格是 3 列：${grid ? '✓' : '✗'}`);
const narrow = /@media \(max-width: 560px\)[\s\S]*?\.stat-cards\s*\{[^}]*repeat\(2/.test(css);
console.log(`  窄屏退成 2 列：${narrow ? '✓' : '✗'}`);
let withPanel = 0, withBase = 0, withIv = 0, withNat = 0, withIcon = 0;
for (const c of cardsA) {
  if (/class="s-panel"/.test(c.innerHTML)) withPanel++;
  if (/class="s-base"/.test(c.innerHTML)) withBase++;
  if (/data-nat-ivbtn/.test(c.innerHTML)) withIv++;
  if (c.querySelectorAll('[data-nat-btn]').length === 2) withNat++;
  if (c.querySelectorAll('.natal-ic').length === 1) withIcon++;
}
console.log(`  大字面板值 ${withPanel}/6 ${withPanel === 6 ? '✓' : '✗'}`);
console.log(`  小字种族值 ${withBase}/6 ${withBase === 6 ? '✓' : '✗'}`);
console.log(`  「个体」按钮 ${withIv}/6 ${withIv === 6 ? '✓' : '✗'}`);
console.log(`  性格 +/- 开关 ${withNat}/6 ${withNat === 6 ? '✓' : '✗'}`);
console.log(`  属性图标 ${withIcon}/6 ${withIcon === 6 ? '✓' : '✗'}`);

console.log('\n  高亮（出招 / 挨打）：');
for (const side of ['a', 'b']) {
  const cs = [...app.querySelectorAll(`.stat-cards[data-calc-side="${side}"] .s-card`)];
  const atk = cs.filter((c) => c.classList.contains('role-atk')).map((c) => c.dataset.stat);
  const def = cs.filter((c) => c.classList.contains('role-def')).map((c) => c.dataset.stat);
  console.log(`    ${side} 侧  出招=[${atk.join(',') || '-'}]  挨打=[${def.join(',') || '-'}]`);
}

console.log('\n=== ② 双栏并排 ===');
const two = /\.calc-two\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(330px/.test(css);
console.log(`  .calc-two 宽屏并排 / 窄屏堆叠：${two ? '✓' : '✗'}`);
console.log(`  页面里侧栏容器数：${app.querySelectorAll('.calc-two .calc-col').length}（应为 2）`);
const cols = app.querySelectorAll('.calc-two .calc-col');
console.log(`  左栏是攻击方：${/攻击方 A/.test(cols[0].innerHTML) ? '✓' : '✗'}`);
console.log(`  右栏是防御方：${/防御方 B/.test(cols[1].innerHTML) ? '✓' : '✗'}`);

console.log('\n=== 交互规则（与详情页一致）===');
const cfgA = api.withCalcSide('a', () => api.spiritCalcOf(api.STATE.bySpirit.get('20:1')));
console.log(`  初始六项都不投：${['hp','patk','satk','pdef','sdef','spd'].every((k) => cfgA.stats[k].iv === 0) ? '✓' : '✗'}`);
const before = api.withCalcSide('a', () => api.calcStatsOf(api.STATE.bySpirit.get('20:1'), cfgA).spd);
app.querySelector('.stat-cards[data-calc-side="a"] [data-nat-ivbtn="spd"]').click();
console.log(`  点「个体」-> 投满：${cfgA.stats.spd.iv === 60 ? '✓' : '✗'}`);
env.byId.get('app').querySelector('.stat-cards[data-calc-side="a"] [data-nat-btn="spd"][data-nat-kind="up"]').click();
const after = api.withCalcSide('a', () => api.calcStatsOf(api.STATE.bySpirit.get('20:1'), cfgA).spd);
console.log(`  spd 面板 ${before} -> ${after}：${after > before ? '✓' : '✗'}`);
console.log(`  性格 up 已生效：${cfgA.stats.spd.nature === 'up' ? '✓' : '✗'}`);
const hpUp = env.byId.get('app').querySelector('.stat-cards[data-calc-side="a"] [data-nat-btn="hp"][data-nat-kind="up"]');
console.log(`  「+」整列唯一（生命 + 被禁用）：${hpUp.disabled ? '✓' : '✗'}`);
