/** 三处修正的专项验收：双克制 ×3 / 双抵抗 ×¼ / 寄生 6% / 冻结不受克制 */
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
const name = (id) => A2.typeById.get(id)?.name ?? id;
let bad = 0;
const ck = (cond, label, extra = '') => { if (!cond) bad++; console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`); };

console.log('① 双克制 = ×3、双抵抗 = ×¼');
{
  const dist = {};
  for (const sp of A2.data.spirits) for (const t of A2.data.meta.types) {
    const e = api.typeEffect(t.id, sp.types ?? []);
    dist[e] = (dist[e] ?? 0) + 1;
  }
  console.log('   倍率分布:', JSON.stringify(dist));
  ck(dist['3'] > 0, `双克制出现 ${dist['3']} 次，倍率是 ×3`);
  ck(!dist['4'], '没有 ×4');
  ck(dist['0.25'] > 0, `双抵抗出现 ${dist['0.25']} 次，倍率是 ×¼`);
  ck(!dist['0.125'], '没有 ×0.125');
}

console.log('\n② 系别克制页：矩阵是单系三档，双系结果另列');
{
  A2.view = 'types';
  env.byId.get('app').innerHTML = '';
  api.render();
  const app = env.byId.get('app');
  // 18×18 矩阵是**单系**的，只有克制/普通/抵抗三档，不该出现 ×3
  const matrix = app.querySelector('.matrix');
  ck(!!matrix && matrix.querySelectorAll('tbody tr').length === 18, '矩阵是 18×18 单系表');
  ck(!/×3/.test(matrix.innerHTML), '单系矩阵里没有 ×3（双克制只发生在双系精灵身上）');
  // 双系结果由新增的「双系组合速查」给出
  const dbl = [...app.querySelectorAll('.panel')].find((b) => /双系组合速查/.test(b.innerHTML));
  ck(!!dbl, '有「双系组合速查」区块');
  if (dbl) {
    const rows = dbl.querySelectorAll('tbody tr');
    ck(rows.length > 0, `列出 ${rows.length} 组存在 ×3 或 ×¼ 的组合`);
    const html = dbl.innerHTML;
    ck(/两个系都被克制/.test(html) && /×3/.test(html), '写明了双克制 = ×3');
    ck(/两个系都抵抗/.test(html) && /×¼/.test(html), '写明了双抵抗 = ×¼');
    // 注：区块说明里会写"不是 ×4"，所以不能拿正文里有没有 ×4 当断言 ——
    // "没有 ×4 倍率" 已由上面 ① 的全体倍率分布验证。
  }
}

console.log('\n③ 寄生 6%、不受克制；冻结不受克制');
{
  A2.view = 'calc';
  A2.calc.a = '20:1'; A2.calc.b = '43:1'; A2.calc.skillA = 7150060;
  A2.calc.statusA = { picks: [], star: 0, layers: {} };
  A2.calc.statusB = { picks: ['parasite', 'freeze'], star: 0, layers: { freeze: 2 } };
  A2.calc.statusPctA = {}; A2.calc.statusPctB = {};
  A2.calc.hpPctA = 100; A2.calc.hpPctB = 100;
  env.byId.get('app').innerHTML = '';
  api.render();

  const sp = A2.bySpirit.get('43:1');
  const maxHp = api.hpMaxOf('b', sp);
  const d = api.statusDamageOf('b', sp);
  const para = d.rows.find((r) => r.key === 'parasite');
  const froz = d.rows.find((r) => r.key === 'freeze');
  ck(para && para.pct === 6, `寄生默认 6%（实际 ${para?.pct}）`);
  ck(para && !para.effective, '寄生不吃克制');
  ck(para && para.raw === Math.floor((maxHp * 6) / 100), `寄生掉血 = floor(${maxHp} × 6%) = ${para?.raw}`);
  ck(froz && !froz.effective, '冻结不吃克制');
  ck(froz && froz.pctSum === 10, `冻结 2 层 × 5% = 10%（实际 ${froz?.pctSum}%）`);

  const box = [...env.byId.get('app').querySelectorAll('.st-dmg')][1];
  const t = box.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  console.log('   页面:', t);
  ck(/不受克制/.test(t), '页面标出「不受克制」');
  ck(/6% 生命/.test(t), '页面显示寄生的 6%');

  // 换成不同系别的目标，寄生/冻结的掉血应当**不变**（因为不吃克制）
  A2.calc.b = '152:1';
  env.byId.get('app').innerHTML = '';
  api.render();
  const sp2 = A2.bySpirit.get('152:1');
  const d2 = api.statusDamageOf('b', sp2);
  const para2 = d2.rows.find((r) => r.key === 'parasite');
  ck(para2.raw === Math.floor((api.hpMaxOf('b', sp2) * 6) / 100),
    `换目标后寄生仍是纯粹 6%（${para2.raw}）—— 不随系别变化`);

  // 对照：灼烧是火系，换目标必须变
  A2.calc.statusB = { picks: ['burn'], star: 0, layers: { burn: 3 } };
  A2.calc.b = '43:1';
  env.byId.get('app').innerHTML = '';
  api.render();
  const burnGrass = api.statusDamageOf('b', A2.bySpirit.get('43:1')).total;
  A2.calc.b = '152:1';
  env.byId.get('app').innerHTML = '';
  api.render();
  const burnWing = api.statusDamageOf('b', A2.bySpirit.get('152:1')).total;
  console.log(`   灼烧对草系 ${burnGrass} vs 对翼系 ${burnWing}（面板不同，比值应体现克制差异）`);
  ck(api.statusDamageOf('b', A2.bySpirit.get('152:1')).rows[0].eff === 1, '灼烧对翼系是 ×1');
}

console.log(bad ? `\n✗ ${bad} 项不通过` : '\n✓ 三处修正全部生效');
process.exit(bad ? 1 : 0);
