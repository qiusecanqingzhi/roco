/** 验证：六个攻击因子 + 物防/魔防真的进计算 + 拖动血量不重渲染 */
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
const plain = (el) => el.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

api.STATE.view = 'calc';
env.byId.get('app').innerHTML = '';
api.render();
let app = env.byId.get('app');

console.log('=== 攻击因子（图里那 8 个）===');
const mods = [...app.querySelectorAll('.st-side[data-st-side="a"] .st-mod')].map(plain);
console.log('  数量:', mods.length, '(两侧共', app.querySelectorAll('[data-st-mod]').length + ')');
mods.forEach((m, i) => console.log(`   ${i + 1}. ${m}`));

console.log('\n=== 物防/魔防是否真的进计算 ===');
const a = api.STATE.bySpirit.get('20:1');
const b = api.STATE.bySpirit.get('43:1');
const sk = api.STATE.bySkill.get(7150060);   // 扇风：物理
const base = api.calcDamage(a, b, sk, { level: 60, flatAdd: 20, skillPct: 0.5 });
const defUp = api.calcDamage(a, b, sk, {
  level: 60, flatAdd: 20, skillPct: 0.5,
  defMods: { pdefPct: 100, sdefPct: 0 },
});
const defWrong = api.calcDamage(a, b, sk, {
  level: 60, flatAdd: 20, skillPct: 0.5,
  defMods: { pdefPct: 0, sdefPct: 100 },
});
console.log(`  基准 defStat=${base.defStat} dmg=${base.dmg}`);
console.log(`  物防+100% -> defStat=${defUp.defStat} dmg=${defUp.dmg}  ${defUp.dmg < base.dmg ? '✓ 伤害下降' : '✗'}`);
console.log(`  魔防+100% -> defStat=${defWrong.defStat} dmg=${defWrong.dmg}  ${defWrong.dmg === base.dmg ? '✓ 物理技能不受魔防影响' : '✗'}`);
console.log(`  不传 defMods 时基准不变: ${api.calcDamage(a, b, sk, { level: 60, flatAdd: 20, skillPct: 0.5 }).dmg === base.dmg ? '✓' : '✗'}`);

console.log('\n=== 拖动血量：不重渲染，就地更新 ===');
app = env.byId.get('app');
const el = app.querySelector('[data-st-hp="a"]');
const box = el.closest('.st-hp');
const marker = box.querySelector('.st-hp-pct');
marker.dataset.probe = 'original';       // 打个标记：若被重渲染，标记会消失
el.value = '42';
el.dispatch('input');
const box2 = env.byId.get('app').querySelector('[data-st-hp="a"]').closest('.st-hp');
console.log(`  hpPctA = ${api.STATE.calc.hpPctA}`);
console.log(`  百分比文字 = ${plain(box2.querySelector('.st-hp-pct'))}`);
console.log(`  当前/总量 = ${plain(box2.querySelector('.st-hp-max'))}`);
console.log(`  进度条宽度 = ${env.byId.get('app').querySelector('[data-st-hp="a"]').closest('.st-hp').querySelector('.st-hp-bar i').style.width}`);
console.log(`  拖动中原节点未被替换（标记还在）：${env.byId.get('app').querySelector('[data-probe="original"]') ? '✓' : '✗ 被重渲染了，会卡手'}`);
