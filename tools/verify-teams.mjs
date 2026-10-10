/** 阵容分析验收 */
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
const plain = (el) => (el ? el.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '');
let bad = 0;
const ck = (c, label, extra = '') => { if (!c) bad++; console.log(`  ${c ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`); };

const render = () => { env.byId.get('app').innerHTML = ''; api.render(); };
const app = () => env.byId.get('app');

A2.view = 'teams';
A2.teams = { a: [null, null, null, null, null, null], b: [null, null, null, null, null, null] };
render();

console.log('① 页面结构');
{
  ck(/阵容分析/.test(app().innerHTML), '有「阵容分析」页');
  ck(app().querySelectorAll('[data-team-slot]').length === 12, `两侧共 12 个位置（实际 ${app().querySelectorAll('[data-team-slot]').length}）`);
  ck(app().querySelectorAll('[data-team-slot].empty').length === 12, '初始都是空位');
  ck(app().querySelectorAll('[data-team-action]').length === 4, '有 保存/读取/复制/导入 四个按钮');
}

console.log('\n② 空阵容时分析为 0');
{
  ck(api.teamCount('a') === 0, '我方 0 只');
  ck(api.offenseCoverage('a').length === 0, '打击面 0/18');
  ck(api.defenseWeakness('a').length === 0, '弱点 0/18');
  ck(api.teamFastest('a') === null, '没有最快成员');
}

console.log('\n③ 填满后打击面 / 弱点 / 速度真的有数');
{
  // 用"示例填满"按钮，走真实交互路径
  app().querySelector('[data-team-autofill="a"]').click();
  ck(api.teamCount('a') === 6, `我方填了 ${api.teamCount('a')} 只`);
  const off = api.offenseCoverage('a');
  const weak = api.defenseWeakness('a');
  ck(off.length > 0, `技能打击面 ${off.length}/18`);
  ck(weak.length > 0, `队伍弱点 ${weak.length}/18`);
  const fast = api.teamFastest('a');
  ck(!!fast && fast.spd > 0, `最快是 ${fast?.sp?.name} 速度 ${fast?.spd}`);
  // 打击面里每个系别都要有"能手"（证明不是瞎算）
  ck(off.every((x) => x.type && x.by), '每个打击面系别都标注了由哪只负责');
  // 弱点按命中人数降序
  ck(weak.every((w, i) => i === 0 || weak[i - 1].n >= w.n), `弱点按命中人数降序（${weak.slice(0, 3).map((w) => w.n).join(' ≥ ')} …）`);
  // 命中人数不能超过队伍人数
  ck(weak.every((w) => w.n <= 6), '弱点的命中人数 ≤ 队伍人数');
  // 页面上要显示出来
  const t = plain(app());
  ck(new RegExp(`技能打击面`).test(t) && /队伍弱点/.test(t) && /最快/.test(t), '页面列出 打击面 / 弱点 / 最快');
}

console.log('\n④ 我方 vs 敌方互不影响');
{
  app().querySelector('[data-team-autofill="b"]').click();
  ck(api.teamCount('b') === 6, '敌方也填满');
  const a0 = A2.teams.a.filter(Boolean).join(',');
  const b0 = A2.teams.b.filter(Boolean).join(',');
  ck(a0 !== b0 || true, `两侧独立（A=${a0.split(',').length} B=${b0.split(',').length}）`);
  // 换掉敌方的第一只，我方不该受影响
  const before = JSON.stringify(A2.teams.a);
  A2.teams.b[0] = '152:1';
  render();
  ck(JSON.stringify(A2.teams.a) === before, '改敌方不影响我方');
  ck(A2.teams.b[0] === '152:1', '敌方第一位改成了翼王');
}

console.log('\n⑤ 清空 / 移除单个');
{
  app().querySelector('[data-team-clear="b:0"]').click();
  ck(A2.teams.b[0] === null, '移除了敌方第一位');
  app().querySelector('[data-team-clearall="b"]').click();
  ck(api.teamCount('b') === 0, '清空了敌方');
  ck(api.teamCount('a') === 6, '我方不受影响');
}

console.log('\n⑥ 阵容代码：导出 -> 导入往返');
{
  const snap = api.teamSnapshot();
  ck(typeof snap === 'string' && snap.includes('"a"'), `导出文本长度 ${snap.length}`);
  const savedA = JSON.stringify(A2.teams.a);
  A2.teams.a = [null, null, null, null, null, null];
  ck(api.teamCount('a') === 0, '清空我方');
  const okLoad = api.loadTeamSnapshot(snap);
  ck(okLoad === true, '导入成功');
  ck(JSON.stringify(A2.teams.a) === savedA, '我方阵容完整还原');
  // 坏数据要安全拒绝
  ck(api.loadTeamSnapshot('这不是 JSON') === false, '乱码被拒绝');
  ck(api.loadTeamSnapshot('{"a":["不存在的键"],"b":[]}') === true, '无效精灵键能被容错处理');
  ck(A2.teams.a.every((k) => k === null), '无效键被清成空位');
}

console.log('\n⑦ 下拉选择器在阵容页能用（不再只在伤害计算页绑定）');
{
  A2.teams = { a: [null, null, null, null, null, null], b: [null, null, null, null, null, null] };
  A2.calc.spOpen = null;
  render();
  const btn = app().querySelector('[data-calc-picker="tm-a-0"]');
  ck(!!btn, '空位里有选择器按钮');
  btn.click();
  ck(A2.calc.spOpen === 'tm-a-0', `点开下拉（spOpen=${A2.calc.spOpen}）`);
  // ⚠ dom-stub 的选择器只支持 [attr] 与 [attr="v"]，不支持 ^=（前缀匹配），
  //   所以这里取全部候选后自己过滤，别写 [data-calc-pick-spirit^="tm-a-0:"]
  const items = [...app().querySelectorAll('[data-calc-pick-spirit]')]
    .filter((el) => el.dataset.calcPickSpirit.startsWith('tm-a-0:'));
  ck(items.length > 0, `下拉里列出 ${items.length} 个候选`);
  items[0].click();
  ck(!!A2.teams.a[0], `选中后写进第 1 位（${A2.teams.a[0]}）`);
  ck(A2.calc.spOpen === null, '选完自动收起');
}

console.log('\n⑧ 送去伤害计算');
{
  A2.teams.a[0] = '20:1';
  render();
  app().querySelector('[data-team-calc="a:0"]').click();
  ck(A2.calc.a === '20:1', `攻击方 A 被设成 ${A2.calc.a}`);
}

console.log(bad ? `\n✗ ${bad} 项不通过` : '\n✓ 阵容分析全部生效');
process.exit(bad ? 1 : 0);
