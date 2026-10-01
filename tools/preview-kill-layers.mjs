/** 打印星陨斩杀列的实际内容（人工核对用） */
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
const A2 = api.STATE;

A2.view = 'calc';
A2.calc.a = '20:1'; A2.calc.b = '43:1'; A2.calc.skillA = 7150060;
A2.calc.statusB = { picks: ['starfall-mark'], star: 0, layers: {} };
A2.calc.hpPctA = 100; A2.calc.hpPctB = 100;
api.fillLoadoutWithTop('a', A2.bySpirit.get('20:1'), A2.bySpirit.get('43:1'), 4);
api.fillLoadoutWithTop('b', A2.bySpirit.get('43:1'), A2.bySpirit.get('20:1'), 4);
env.byId.get('app').innerHTML = '';
api.render();
const app = env.byId.get('app');
const t = (el) => (el ? el.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '');

console.log(`目标：${A2.bySpirit.get('43:1').name}，当前血量 ${api.targetHpOf('b', A2.bySpirit.get('43:1'))}`);
console.log('对面已挂：星陨印记\n');

console.log('[四技能槽 · 含全局加成（固定加威力 + 本次技能威力%）]');
for (const r of app.querySelectorAll('.lo-table tbody tr')) {
  const c = r.querySelectorAll('td');
  if (c.length < 10) continue;
  console.log('  ', [t(c[2]), t(c[8]), t(c[9])].join('   |   '));
}

console.log('\n[伤害最高的技能 · 裸威力口径]');
for (const r of app.querySelectorAll('.section tbody tr')) {
  const c = r.querySelectorAll('td');
  if (c.length < 8) continue;
  console.log('  ', [t(c[1]), t(c[5]), t(c[7])].join('   |   '));
}
