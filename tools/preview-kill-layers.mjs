/** 星陨斩杀线：三种场景的人工核对 */
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
const t = (el) => (el ? el.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '');

const run = (label, picks) => {
  A2.view = 'calc';
  A2.calc.a = '20:1'; A2.calc.b = '43:1'; A2.calc.skillA = 7150060;
  A2.calc.hpPctA = 100; A2.calc.hpPctB = 100;
  A2.calc.statusA = { picks: [], star: 0, layers: {} };
  A2.calc.statusB = { picks, star: 0, layers: {} };
  A2.calc.statusPctA = {}; A2.calc.statusPctB = {};
  api.fillLoadoutWithTop('a', A2.bySpirit.get('20:1'), A2.bySpirit.get('43:1'), 4);
  api.fillLoadoutWithTop('b', A2.bySpirit.get('43:1'), A2.bySpirit.get('20:1'), 4);
  env.byId.get('app').innerHTML = '';
  api.render();
  const app = env.byId.get('app');
  const loHeads = [...app.querySelectorAll('.lo-table thead th')].map((x) => t(x));
  const rankHeads = [...app.querySelectorAll('.section thead th')].map((x) => t(x));
  console.log(`\n${label}`);
  console.log(`  目标：${A2.bySpirit.get('43:1').name}，当前血量 ${api.targetHpOf('b', A2.bySpirit.get('43:1'))}`);
  console.log(`  四技能槽表头：${loHeads.join(' | ')}`);
  console.log(`  排序表表头：  ${rankHeads.join(' | ')}`);
  const lo = [...app.querySelectorAll('.lo-table .lo-kill')];
  if (lo.length) {
    console.log('  四技能槽斩杀列：');
    for (const r of app.querySelectorAll('.lo-table tbody tr')) {
      const c = r.querySelectorAll('td');
      if (c.length < 10) continue;
      console.log('   ', [t(c[2]), t(c[8]), t(c[9])].join('   |   '));
    }
  } else {
    console.log('  四技能槽：没有斩杀列 ✓');
  }
  const rank = [...app.querySelectorAll('.section .lo-kill')];
  if (rank.length) {
    console.log('  排序表斩杀列（前 6）：');
    let n = 0;
    for (const r of app.querySelectorAll('.section tbody tr')) {
      const c = r.querySelectorAll('td');
      if (c.length < 8) continue;
      console.log('   ', [t(c[1]), t(c[5]), t(c[7])].join('   |   '));
      if (++n >= 6) break;
    }
  } else {
    console.log('  排序表：没有斩杀列 ✓');
  }
};

run('① 什么都没挂 —— 不该显示斩杀列', []);
run('② 只挂星陨印记', ['starfall-mark']);
run('③ 只挂灼烧（回合末掉血，没星陨）', ['burn']);
run('④ 星陨印记 + 灼烧', ['starfall-mark', 'burn']);
run('⑤ 挂了离场类（棘刺印记）—— 不是回合末，不该显示', ['thorn-mark']);
