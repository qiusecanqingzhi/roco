/** 预览伤害计算页的结构与两侧面板 */
import fs from 'node:fs';
import vm from 'node:vm';
import { makeEnv } from '../web/tools/dom-stub.mjs';

const bundleSrc = fs.readFileSync('web/data-bundle.js', 'utf8');
const bundle = JSON.parse(bundleSrc.replace(/^window\.ROCO_DATA\s*=\s*/, '').replace(/;\s*$/, ''));
const env = makeEnv({ withBundle: true, bundle });
vm.createContext(env.sandbox);
vm.runInContext(bundleSrc, env.sandbox);
vm.runInContext(fs.readFileSync('web/app.js', 'utf8'), env.sandbox);
await new Promise((r) => setTimeout(r, 80));
const api = env.window.__roco;

api.STATE.view = 'calc';
env.byId.get('app').innerHTML = '';
api.render();
const app = env.byId.get('app');
const txt = (el) => el.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

console.log('=== 两侧面板 ===');
for (const side of ['a', 'b']) {
  const box = app.querySelector(`.natal-block[data-calc-side="${side}"]`);
  console.log(`\n[${side} 侧] 工具栏: ${txt(box.querySelector('.natal-toolbar'))}`);
  const lines = box.querySelectorAll('.nat-line.combined');
  for (const l of lines) console.log('   ' + txt(l));
}

console.log('\n=== 结果区（A 打 B）===');
const res = app.querySelector('.calc-result');
if (res) {
  for (const cf of res.querySelectorAll('.cf')) console.log('  ' + txt(cf));
  for (const b of res.querySelectorAll('.calc-out .big')) console.log('  ' + txt(b));
} else {
  console.log('  (无结果)');
}

console.log('\n=== 交互测试：A 侧给速度投个体 + 加成 ===');
const spA = api.STATE.bySpirit.get(api.STATE.calc.a);
const cfgA = api.withCalcSide('a', () => api.spiritCalcOf(spA));
const before = api.withCalcSide('a', () => api.calcStatsOf(spA, cfgA).spd);
app.querySelector('.natal-block[data-calc-side="a"] [data-nat-ivbtn="spd"]').click();
api.bindNatalBlock();
env.byId.get('app').querySelector('.natal-block[data-calc-side="a"] [data-nat-btn="spd"][data-nat-kind="up"]').click();
const after = api.withCalcSide('a', () => api.calcStatsOf(spA, cfgA).spd);
console.log(`  A 侧速度面板: ${before} -> ${after}  ${after > before ? '✓ 生效' : '✗'}`);
console.log(`  伤害是否跟着变: ${txt(env.byId.get('app').querySelector('.calc-result')).slice(0, 120)}`);
