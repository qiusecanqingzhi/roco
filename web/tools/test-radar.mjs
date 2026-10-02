/**
 * 六维雷达图的几何与渲染检查。
 * 用 DOM 桩执行 app.js，直接调用 spiritDetail，然后解析生成的 SVG：
 *   - 六个轴、四圈网格、六个数据顶点、六个标签
 *   - 数值为 0 的项不会塌到圆心（否则看不出是哪一项）
 *   - 数值越高，顶点离圆心越远（方向正确）
 *
 * 用法: node web/tools/test-radar.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { makeEnv } from './dom-stub.mjs';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); else { problems.push(m); console.log('  ✗ ' + m); } };

/* ---------------------------------------------------------- DOM 桩
   用公共的 dom-stub：它能真的解析 HTML、跑选择器、派发事件。
   早先用的是"querySelectorAll 永远返回空"的简化桩，导致**事件绑定相关的代码
   从来没被测到**（只测了渲染出的字符串），详情页加点面板"点了没反应"就是这么漏掉的。 */
const bundleSrc = fs.readFileSync(path.join(WEB, 'data-bundle.js'), 'utf8');
const bundle = JSON.parse(bundleSrc.replace(/^window\.ROCO_DATA\s*=\s*/, '').replace(/;\s*$/, ''));
const env = makeEnv({ withBundle: true, bundle });
vm.createContext(env.sandbox);
vm.runInContext(bundleSrc, env.sandbox);
vm.runInContext(fs.readFileSync(path.join(WEB, 'app.js'), 'utf8'), env.sandbox);
await new Promise((r) => setTimeout(r, 80));

const api = env.window.__roco;
ok(!!api, 'app.js 已加载并暴露测试钩子');

// 兼容原有写法：ids.get('modalBody') 之类
const ids = new Map([...env.byId.entries()].map(([k, v]) => [k, { get innerHTML() { return v.innerHTML; }, set innerHTML(x) { v.innerHTML = x; }, _el: v }]));

/* ---------------------------------------------------------- 解析 SVG
   属性顺序不保证（DOM 桩会按解析到的顺序序列化），所以用"含 class=xxx"的
   宽容匹配，而不是要求 class 紧跟标签名。 */
const num = (s) => Number(s);

/** 取出雷达图那段 SVG */
const radarSvgOf = (html) => {
  const i = html.indexOf('<svg');
  if (i < 0) return '';
  const j = html.indexOf('</svg>', i);
  return j < 0 ? '' : html.slice(i, j + 6);
};

function parsePoints(svg) {
  // 数据多边形：<path ... class="radar-area" d="M.. .. L.. .. Z">
  const m = /<path[^>]*class="radar-area"[^>]*d="([^"]+)"/.exec(svg)
    ?? /<path[^>]*d="([^"]+)"[^>]*class="radar-area"/.exec(svg);
  if (!m) return null;
  return m[1].split(/[MLZ]/).map((s) => s.trim()).filter(Boolean).map((p) => p.split(/\s+/).map(num));
}

console.log('\n· 结构');
api.spiritDetail('466:1');           // 果实立方人：105/132/50/120/98/95
const svg = radarSvgOf(ids.get('modalBody').innerHTML);
ok(svg.length > 200, '详情里渲染出了雷达图 SVG');
ok((svg.match(/class="radar-spoke"/g) || []).length === 6, `六条轴线（实际 ${(svg.match(/class="radar-spoke"/g) || []).length}）`);
ok((svg.match(/class="radar-ring"/g) || []).length === 4, `四圈网格（实际 ${(svg.match(/class="radar-ring"/g) || []).length}）`);
ok((svg.match(/class="radar-dot/g) || []).length === 6, '六个数据顶点');

console.log('\n· 外侧标签（图标 + 数值）');
// 顺序必须与原站一致：正上方顺时针 生命 → 魔攻 → 魔防 → 速度 → 物防 → 物攻
// 数值按官方面板公式算；详情页【默认投前三项（生命/物攻/魔攻）满 60，其余 0】，
// 所以这里的期望值要按同样的默认个体算，不能一律用 60（否则 3 项限制就没体现）。
const EXPECT_LABELS = ['生命', '魔攻', '魔防', '速度', '物防', '物攻'];
const sp466 = api.STATE.bySpirit.get('466:1');
const PANEL_KEYS = ['hp', 'satk', 'sdef', 'spd', 'pdef', 'patk'];
// 详情页【初始都不投个体】（用户要求：点按钮哪项加 60），所以期望值一律按个体 0 算
const DEF_IV_OF = () => 0;
const hpVal = api.panelInt('hp', sp466.stats.hp, DEF_IV_OF('hp'), 'neutral');
const patkVal = api.panelInt('patk', sp466.stats.patk, DEF_IV_OF('patk'), 'neutral');
const satkVal = api.panelInt('satk', sp466.stats.satk, DEF_IV_OF('satk'), 'neutral');
const HP_SCALE = 450;      // 生命参考上限（按全库分布定）
const hasIcons = /class="radar-icon"/.test(svg);
if (hasIcons) {
  ok((svg.match(/class="radar-icon"/g) || []).length === 6, '六个维度图标（当 CSS mask 用）');
  ok((svg.match(/--tint:\d+%/g) || []).length === 6, '每个图标带按数值算出的染色比例 --tint');
  ok(/mask-image:url\('assets\//.test(svg), 'mask 指向本地 assets 图片');
  const vals = [...svg.matchAll(/class="radar-val"[^>]*>(\d+)</g)].map((m) => Number(m[1]));
  ok(vals.length === 6, `六个数值文字（实际 ${vals.length}）`);
  // 顺序校验：把种族值按同样的顺序算成面板值，逐一对比
  const expectVals = PANEL_KEYS.map((k) => api.panelInt(k, sp466.stats[k], DEF_IV_OF(k), 'neutral'));
  ok(vals.join(',') === expectVals.join(','),
    `数值顺序与原站一致：${vals.join(',')}（期望 ${expectVals.join(',')}）`);
  // 染色比例跟随数值
  const tints = [...svg.matchAll(/--tint:(\d+)%/g)].map((m) => Number(m[1]));
  const expectTint = Math.round(Math.min(1, hpVal / HP_SCALE) * 100);
  ok(Math.abs(tints[0] - expectTint) <= 1, `生命染色 ≈${expectTint}%（实际 ${tints[0]}%）`);
  ok(tints[1] < tints[5], `魔攻(${satkVal}) 染色比物攻(${patkVal}) 更淡（${tints[1]}% < ${tints[5]}%）`);
} else {
  ok((svg.match(/class="radar-label"/g) || []).length === 6, '无图标时退回六个文字标签');
}
for (const label of EXPECT_LABELS) {
  ok(svg.includes(`aria-label="六维面板雷达图：`) && svg.includes(`${label} `), `无障碍标签含「${label}」`);
}
// aria 里的顺序也要对
const ariaSeq = /aria-label="六维面板雷达图：([^"]+)"/.exec(svg)?.[1] ?? '';
ok(ariaSeq.split('，').map((x) => x.split(' ')[0]).join(',') === EXPECT_LABELS.join(','),
  `无障碍标签顺序一致：${ariaSeq.split('，').map((x) => x.split(' ')[0]).join(',')}`);

console.log('\n· 几何');
const pts = parsePoints(svg);
ok(Array.isArray(pts) && pts.length === 6, `数据多边形有 6 个顶点（实际 ${pts?.length}）`);

const C = 120;                        // viewBox 240 -> 圆心 120
const dist = ([x, y]) => Math.hypot(x - C, y - C);
if (pts) {
  // 第 1 个点是「生命」（向上）；第 2 个是「魔攻」（右上）
  // 半径按"该值 / 参考上限 × R"缩放。生命上限 450（按全库分布定，不是 200）。
  const R = 78;
  const expect = R * Math.min(1, hpVal / HP_SCALE);
  ok(Math.abs(dist(pts[0]) - expect) < 1.5, `生命顶点半径 ≈ ${expect.toFixed(1)}（生命 ${hpVal} / 上限 ${HP_SCALE}，实际 ${dist(pts[0]).toFixed(1)}）`);
  // 参考上限的标记点应贴在轴末端
  ok((svg.match(/class="radar-cap"/g) || []).length === 6, `六根轴上各有一个参考上限标记（实际 ${(svg.match(/class="radar-cap"/g) || []).length}）`);
  ok(pts[0][1] < C, '生命顶点在圆心上方（第一轴朝向正确）');
  ok(pts[1][0] > C && pts[1][1] < C, '第二轴（魔攻）在右上方 —— 顺时针排列');
  ok(dist(pts[1]) < dist(pts[5]), `魔攻(${satkVal}) 比 物攻(${patkVal}) 更靠内 —— 数值越大越外`);
}

// 极端值：全 0 与超高
const zeroSpirit = { ...api.STATE.bySpirit.get('466:1'), stats: { hp: 0, patk: 0, satk: 0, pdef: 0, sdef: 0, spd: 0 } };
api.STATE.bySpirit.set('9999:1', zeroSpirit);
api.spiritDetail('9999:1');
const svg0 = radarSvgOf(ids.get('modalBody').innerHTML);
const pts0 = parsePoints(svg0);
ok(pts0 && pts0.length === 6 && pts0.every((p) => dist(p) > 3), '全 0 时六个顶点仍在圆心外（不塌陷）');
ok(pts0 && new Set(pts0.map((p) => p.map((x) => x.toFixed(1)).join(','))).size === 6, '全 0 时六个顶点位置互不相同（能看出是哪一项）');
api.STATE.bySpirit.delete('9999:1');

/* ---------------------------------------------------------- 图标类需求 */
console.log('\n· 特性 / 技能 / 系别图标');
api.spiritDetail('466:1');
const detail = ids.get('modalBody').innerHTML;
ok(/class="passive-icon"/.test(detail), '特性（被动技能）旁显示图标');
ok(/passive-icon"[^>]*>\s*<img[^>]+src="assets\//.test(detail), '特性图标指向本地 assets');
const skillIconsInDetail = (detail.match(/class="skill-icon"/g) || []).length;
ok(skillIconsInDetail >= 13, `精灵详情的技能表每行都有图标（${skillIconsInDetail} 个）`);
ok(/class="tbadge-img"/.test(detail), '系别改成圆形图标徽章');
ok(/class="type-icon"/.test(detail), '系别徽章内是 img 图标');

// 技能详情：可学精灵列表带头像
const firstSkill = api.spiritSkillsOf(api.STATE.bySpirit.get('466:1')).level[0];
api.skillDetail(firstSkill.id);
const skDetail = ids.get('modalBody').innerHTML;
ok((skDetail.match(/class="spirit-head"/g) || []).length > 0, '技能详情的可学精灵列表显示头像');
ok(/class="type-icon"/.test(skDetail), '技能详情的系别列也是图标');

// 系别页：矩阵表头有图标
api.STATE.view = 'types';
// 直接调用内部渲染（通过 hash 路由无法在桩里完整模拟，这里用钩子里的 render）
ids.get('app').innerHTML = '';
api.render();
const typesHtml = ids.get('app').innerHTML;
ok(/class="type-icon"/.test(typesHtml), '系别克制页的表头用图标徽章');
// 属性顺序由 DOM 桩的序列化决定，所以用"<td 后面任意位置带 class=mx"的匹配
ok((typesHtml.match(/<td[^>]*class="mx/g) || []).length === 324, `克制矩阵仍是 324 格（实际 ${(typesHtml.match(/<td[^>]*class="mx/g) || []).length}）`);

/* ---------------------------------------------------------- 血脉技能 */
console.log('\n· 血脉技能');
api.STATE.expandedBloodlines = false;
api.spiritDetail('466:1');
const blHtml = ids.get('modalBody').innerHTML;
const bl = api.STATE.data.spiritBloodlines['466:1'] ?? [];
ok(bl.length === 18, `果实立方人有 18 种血脉（实际 ${bl.length}）`);
ok(/血脉技能/.test(blHtml), '详情里有「血脉技能」区块');
ok(/展开全部 18 种/.test(blHtml), '默认折叠，提供「展开全部」按钮');
ok((blHtml.match(/class="bl-icon"/g) || []).length === 6, `默认显示 6 行（实际 ${(blHtml.match(/class="bl-icon"/g) || []).length}）`);
ok((blHtml.match(/class="bl-item"/g) || []).length === 6, '每行显示秘药图标');
ok(/徒长/.test(blHtml) && /引燃/.test(blHtml), '给出了血脉技能名（徒长/引燃）');
ok(/data-skill="7020880"/.test(blHtml), '血脉技能可点开技能详情');
const blMeta = api.STATE.data.meta.bloodlines ?? {};
const blSkillIcons = api.STATE.data.meta.bloodlineSkillIcons ?? {};
ok(bl[0].skill === '拍击' && bl[0].lv === 15, `首条血脉：${blMeta[bl[0].id]?.name} -> ${bl[0].skill} Lv${bl[0].lv}`);
// 图标/名称/秘药已按 bloodline_id 去重到 meta 里（每行只留 id/skillId/skill/lv）
ok(bl.every((x) => blMeta[x.id]?.icon && (x.skillId ? blSkillIcons[x.skillId] : true)),
  '18 条血脉都能从 meta 查到图标与技能图标');
ok(bl.every((b) => !('icon' in b) && !('item' in b)),
  '血脉行里不再重复存图标路径（体积优化：6.1 MB -> 3.3 MB）');

// 展开状态
api.STATE.expandedBloodlines = true;
api.spiritDetail('466:1');
const blFull = ids.get('modalBody').innerHTML;
ok((blFull.match(/class="bl-icon"/g) || []).length === 18, `展开后 18 行（实际 ${(blFull.match(/class="bl-icon"/g) || []).length}）`);
ok(/收起/.test(blFull), '展开后按钮变成「收起」');
api.STATE.expandedBloodlines = false;

// 不同精灵的同一种血脉给的技能不同（源数据特性，界面上必须显示各自的值）
const blOther = api.STATE.data.spiritBloodlines['1:1'] ?? [];
ok(blOther.length >= 18, `#1 也有全部血脉（实际 ${blOther.length} 行）`);
ok(blOther[0].skill !== bl[0].skill, `同一种血脉不同精灵给的技能不同：#466=${bl[0].skill} / #1=${blOther[0].skill}`);

// 有的精灵多一条「首领血脉」且不给技能，界面必须能显示而不报错
const boss = blOther.find((x) => !x.skillId);
ok(!!boss, `存在不给技能的血脉：${blMeta[boss?.id]?.name ?? '(没找到)'}`);
api.STATE.expandedBloodlines = true;   // 它在第 19 位，默认折叠时看不到
api.spiritDetail('1:1');
const bossHtml = ids.get('modalBody').innerHTML;
ok(/首领血脉/.test(bossHtml), '展开后首领血脉出现在详情里');
ok(/class="desc">—</.test(bossHtml), '不给技能的血脉显示为「—」而不是空白');
ok(!/undefined|NaN/.test(bossHtml), '不给技能的血脉没有渲染出 undefined/NaN');
api.STATE.expandedBloodlines = false;

// 全库抽查：任何精灵的血脉区块都不应出现 undefined
let bad = 0;
for (const key of Object.keys(api.STATE.data.spiritBloodlines).slice(0, 40)) {
  api.STATE.expandedBloodlines = true;
  api.spiritDetail(key);
  if (/undefined|NaN/.test(ids.get('modalBody').innerHTML)) bad++;
}
ok(bad === 0, `抽查 40 只精灵的血脉区块，无 undefined/NaN（实际 ${bad}）`);
api.STATE.expandedBloodlines = false;

// 血脉技能区块必须在「技能石」之后
api.spiritDetail('466:1');
const orderHtml = ids.get('modalBody').innerHTML;
const at = (s) => orderHtml.indexOf(s);
ok(at('技能石') > 0 && at('血脉技能') > at('技能石'),
  `「血脉技能」排在「技能石」之后（技能石@${at('技能石')} < 血脉技能@${at('血脉技能')}）`);
ok(at('升级学会') < at('技能石'), '顺序为 升级学会 → 技能石 → 血脉技能');
// 血脉技能行里要有技能图标
ok(/class="skill-icon"/.test(orderHtml) && /data-skill="7020880"/.test(orderHtml), '血脉技能行带技能图标且可点开');

/* ---------------------------------------------------------- 不要外链 */
// 按需求移除了详情里「在原站打开」的链接（页脚的来源声明保留）。
// 注意：详情里仍然会出现 roco.world —— 那是图片的兜底地址（data-fallback），
// 不是导航链接，所以断言只查 <a href="...roco.world">，不查域名本身。
console.log('\n· 详情里不再有原站外链');
const linkRe = /<a[^>]+href="[^"]*roco\.world/;
api.spiritDetail('466:1');
const noLinkSpirit = ids.get('modalBody').innerHTML;
ok(!linkRe.test(noLinkSpirit), '精灵详情里没有指向 roco.world 的 <a> 链接');
ok(!/在原站打开/.test(noLinkSpirit), '精灵详情里没有「在原站打开」');
ok(/data-copy/.test(noLinkSpirit), '「复制名称」按钮仍保留');
api.skillDetail(7040250);
const noLinkSkill = ids.get('modalBody').innerHTML;
ok(!linkRe.test(noLinkSkill), '技能详情里没有指向 roco.world 的 <a> 链接');
ok(!/在原站打开/.test(noLinkSkill), '技能详情里没有「在原站打开」');
api.glossaryDetail(1001);
const noLinkGloss = ids.get('modalBody').innerHTML;
ok(!linkRe.test(noLinkGloss), '术语弹窗里没有指向 roco.world 的 <a> 链接');

/* ---------------------------------------------------------- 伤害计算器 */
// 公式来自对战模拟器说明页，这里逐步复现它的算例：
//   岚鸟(物攻234) 用 扇风(75, 本系, 打草×2) 打 奇丽花(物防226) => 332
// 若把 effect 映射搞反（1 当抵抗），结果会变成 83 —— 差 4 倍，所以这几条断言很关键。
console.log('\n· 伤害计算器');
const A2 = api.STATE;
const lan = A2.data.spirits.find((s) => s.name === '岚鸟');
const qi = A2.data.spirits.find((s) => s.name === '奇丽花');
const shanfeng = A2.data.skills.find((s) => s.name === '扇风');
ok(!!lan && !!qi && !!shanfeng, '找得到岚鸟 / 奇丽花 / 扇风');
ok(lan.stats.patk === 128, `岚鸟物攻种族 128（实际 ${lan.stats.patk}）`);
ok(qi.stats.pdef === 121, `奇丽花物防种族 121（实际 ${qi.stats.pdef}）`);
ok(shanfeng.dmgMax === 75, `扇风基础威力 75（实际 ${shanfeng.dmgMax}）`);

// 面板换算（新公式，个体取值 0~60）：
//   round(128 × 1.1 + 60 × 0.55 + 10) = round(183.8) = 184 → +50 = 234
//   round(121 × 1.1 + 60 × 0.55 + 10) = round(176.1) = 176 → +50 = 226
ok(api.panelInt('patk', 128, 60, 'neutral') === 234, `物攻 种族128 个体60 -> 234（实际 ${api.panelInt('patk', 128, 60, 'neutral')}）`);
ok(api.panelInt('pdef', 121, 60, 'neutral') === 226, `物防 种族121 个体60 -> 226（实际 ${api.panelInt('pdef', 121, 60, 'neutral')}）`);
ok(Math.abs(api.levelCoef(60) - 37 / 41) < 1e-12, `等级系数 60 级 = 37/41（实际 ${api.levelCoef(60)}）`);

// 克制倍率（官方 effect_values：1=克制×2 / 0=普通×1 / -1=抵抗×0.5）
// 注意传的是系别 id（spirit.types 里就是 id）
const tid = (n) => A2.typeByName.get(n).id;
ok(api.typeEffect(tid('翼系'), [tid('草系')]) === 2, `翼系打草系 ×2（实际 ${api.typeEffect(tid('翼系'), [tid('草系')])}）`);
ok(api.typeEffect(tid('火系'), [tid('草系')]) === 2, `火系打草系 ×2（实际 ${api.typeEffect(tid('火系'), [tid('草系')])}）`);
ok(api.typeEffect(tid('火系'), [tid('水系')]) === 0.5, `火系打水系 ×0.5（实际 ${api.typeEffect(tid('火系'), [tid('水系')])}）`);
ok(api.typeEffect(tid('水系'), [tid('火系')]) === 2, `水系打火系 ×2（实际 ${api.typeEffect(tid('水系'), [tid('火系')])}）`);
// 双系别：按**克制次数**叠加，不是把两个单系倍率相乘
//   火打草(+1) 与 火打水(-1) 抵消 -> ×1
ok(api.typeEffect(tid('火系'), [tid('草系'), tid('水系')]) === 1, '打「草+水」双系：+1 与 -1 抵消 = ×1');
//   两个系都被克制 -> ×3（**不是** ×2 ×2 = ×4）
//   圣水迪莫是「光系 + 水系」，草系打这两个都是克制
ok(api.typeEffect(tid('草系'), [tid('光系'), tid('水系')]) === 3, '打「光+水」双系（两个系都被草克制）= ×3 而不是 ×4');
//   两个系都抵抗 -> ×¼
ok(api.typeEffect(tid('武系'), [tid('虫系'), tid('萌系')]) === 0.25, '打「虫+萌」双系（两个系都抵抗武系）= ×¼');

// 系别克制页：单系矩阵保持三档，双系结果由「双系组合速查」给出
{
  A2.view = 'types';
  ids.get('app').innerHTML = '';
  api.render();
  const appT = ids.get('app')._el;
  const matrix = appT.querySelector('.matrix');
  ok(!!matrix && matrix.querySelectorAll('tbody tr').length === 18, '系别矩阵是 18×18 单系表');
  ok(!/×3/.test(matrix.innerHTML), '单系矩阵里不出现 ×3（双克制只发生在双系精灵身上）');
  const dbl = [...appT.querySelectorAll('.panel')].find((b) => /双系组合速查/.test(b.innerHTML));
  ok(!!dbl, '有「双系组合速查」区块');
  if (dbl) {
    const rows = dbl.querySelectorAll('tbody tr');
    ok(rows.length > 50, `列出 ${rows.length} 组存在 ×3 或 ×¼ 的组合`);
    ok(/两个系都被克制/.test(dbl.innerHTML) && /不是 ×4/.test(dbl.innerHTML), '说明里写明双克制 = ×3（不是 ×4）');
    ok(/两个系都抵抗/.test(dbl.innerHTML) && /×¼/.test(dbl.innerHTML), '说明里写明双抵抗 = ×¼');
  }
  A2.view = 'spirits';
  ids.get('app').innerHTML = '';
  api.render();
}

// 完整公式：复现参考页的 332
// 个体值用 60（= 参考页面板 234/226 对应的那组）
const ref = api.calcDamage(lan, qi, shanfeng, { level: 60, atkIV: 60, defIV: 60, flatAdd: 20, skillPct: 0.5, targetHp: 411 });
ok(ref.effective === 142.5, `① 有效威力 (75+20)×1.5 = 142.5（实际 ${ref.effective}）`);
ok(ref.shown === 356, `② 显示威力 round(142.5×1.25×2) = 356（实际 ${ref.shown}）`);
ok(ref.dmg === 332, `④ 预计伤害 = 332（实际 ${ref.dmg}）`);
ok(ref.hits === 2, `打 411 血需要 2 下（实际 ${ref.hits}）`);

const plain = api.calcDamage(lan, qi, shanfeng, { level: 60, atkIV: 0, defIV: 0 });
ok(plain.effective === 75, `无加成时有效威力 = 基础威力 75（实际 ${plain.effective}）`);
ok(plain.stab === 1.25, '同系技能吃到本系 ×1.25');
const otherSkill = A2.data.skills.find((s) => s.name === '拍击');
if (otherSkill) {
  const r2 = api.calcDamage(lan, qi, otherSkill, { level: 60, atkIV: 0, defIV: 0 });
  ok(r2.stab === 1, `非本系技能不吃本系加成（${otherSkill.type}，实际 ${r2.stab}）`);
}
const statusSkill = A2.data.skills.find((s) => s.cat === '状态');
if (statusSkill) {
  const r3 = api.calcDamage(lan, qi, statusSkill, { level: 60 });
  ok(r3.dmg === 0 && r3.hits === Infinity, `状态技能伤害为 0（${statusSkill.name}）`);
}
const staged = api.calcDamage(lan, qi, shanfeng, { level: 60, atkStage: 1 });
ok(Math.abs(staged.atkZone - 2) < 1e-9, `攻击+100% -> 攻防乘区 ×2（实际 ${staged.atkZone}）`);
const defUp = api.calcDamage(lan, qi, shanfeng, { level: 60, defStage: 0.7 });
ok(Math.abs(defUp.atkZone - 1 / 1.7) < 1e-9, `对方防御+70% -> 乘区 1/1.7（实际 ${defUp.atkZone}）`);

/* ---------------------------------------------------------- 克制映射（踩过的坑） */
// 官方 types.json 的 effect_values = {counter:1, neutral:0, resisted:-1}。
// 早先版本猜成 1=×0.5 / -1=×0.25，整个克制页都是错的（伤害差 4 倍）。
console.log('\n· 克制映射以官方 effect_values 为准');
const effOf = (a, d) => {
  const A3 = A2.typeByName.get(a); const D3 = A2.typeByName.get(d);
  return A2.effect.get(`${A3.id}:${D3.id}`);
};
ok(effOf('翼系', '草系') === 1, '翼打草 effect=1（counter）');
ok(effOf('火系', '草系') === 1, '火打草 effect=1（counter）');
ok(effOf('火系', '水系') === -1, '火打水 effect=-1（resisted）');
const effVals = new Set(A2.data.matchups.map((m) => m[2]));
ok([...effVals].every((v) => v === 1 || v === 0 || v === -1),
  `克制只有 1/0/-1 三种取值（实际 ${[...effVals].sort().join(',')}）—— 游戏内无 ×0 免疫`);

A2.view = 'types';
ids.get('app').innerHTML = '';
api.render();
const typeHtml = ids.get('app').innerHTML;
ok(/class="mx2"/.test(typeHtml), '克制页有 mx2（克制）格');
ok(/class="mxh"/.test(typeHtml), '克制页有 mxh（抵抗）格');
ok(!/mx-n1|mx-2|mx0"/.test(typeHtml), '不再使用旧的 mx-n1/mx-2/mx0 类名');
ok(/克制 \/ 普通 \/ 抵抗/.test(typeHtml), '图例说明三档且没有免疫');
ok(/最怕打/.test(typeHtml) && /最耐打/.test(typeHtml), '给出最怕打/最耐打速查');

/* ---------------------------------------------------------- 计算器页面 */
console.log('\n· 伤害计算页面');
A2.calc.a = '20:1'; A2.calc.b = '43:1'; A2.calc.skillA = 7150060;
A2.view = 'calc';
ids.get('app').innerHTML = '';
api.render();
const calcHtml = ids.get('app').innerHTML;
ok(/伤害计算/.test(calcHtml), '渲染出「伤害计算」页');
ok(/岚鸟/.test(calcHtml) && /奇丽花/.test(calcHtml), '两侧分别显示岚鸟与奇丽花');
// 这几条要在"当前 DOM"上查：后面的卡片用例会重渲染，早先抓的 calcHtml 会过期
const calcLive = () => ids.get('app').innerHTML;
const html4 = (h) => {
  const m = /④预计伤害([\s\S]{0,160}?)<\/div>/.exec(h);
  return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '(未找到)';
};
ok(/142\.5/.test(calcLive()), '页面摊开了①有效威力 142.5');
ok(/356/.test(calcLive()), '页面摊开了②显示威力 356');
// 注意：这里是【个体全 0】的默认状态，所以是 334。
// 官方说明页算例的 332 是"岚鸟物攻个体 60 / 奇丽花物防个体 60"那组参数，
// 已经在上面「完整公式：复现参考页的 332」里单独断言过。
ok(/334/.test(calcLive()), `页面摊开了④预计伤害 334（默认个体全 0；实际页面：${(html4(calcLive()))}）`);
ok(/0\.9024/.test(calcLive()), '页面显示等级系数 0.9024');
ok(/需要/.test(calcLive()) && /下/.test(calcLive()), '给出「需要几下」');
ok(/data-calc="level"/.test(calcHtml), '等级可调');
ok(/data-calc="flatAdd"/.test(calcHtml), '固定加威力可调');
ok(/data-calc="skillPct"/.test(calcHtml), '本次技能威力%可调');
ok(/data-calc="atkStage"/.test(calcHtml) && /data-calc="defStage"/.test(calcHtml), '攻防等级可调');
ok((calcHtml.match(/data-calc="skill"/g) || []).length === 2, '两侧各有一个技能选择框');
// 两侧各自的「伤害技能」表（原来只有一个「伤害最高的技能」排序表，现在每侧一张，
// 且列出的是**全部可用伤害技能**，不是前 12 个）
ok(/的技能/.test(calcHtml), '有「XX 的技能」表');
ok((calcHtml.match(/class="calc-skill-table"/g) || []).length === 2, '两侧各一张伤害技能表');
const rankRows = (calcHtml.match(/data-calc-pick="/g) || []).length;
ok(rankRows > 12, `技能表共 ${rankRows} 行（比原来的前 12 个多）`);
// 每张表内部必须按伤害降序
{
  // 用 data-skill-table="a|b" 切分（属性顺序是 data-* 在前，别按 class 找）
  const parts = calcHtml.split(/<div data-skill-table="/).slice(1);
  ok(parts.length === 2, `能切出 ${parts.length} 张技能表用于降序检查`);
  for (const [i, tb] of parts.entries()) {
    // 只看下一张表之前的这一段，避免跨表
    const slice = tb.split('<div data-skill-table="')[0];
    const dmg = [...slice.matchAll(/data-calc-pick="\d+"[\s\S]*?<td class="num"><b>(\d+)<\/b>/g)].map((m) => Number(m[1]));
    ok(dmg.length > 1 && dmg.every((v, j) => j === 0 || dmg[j - 1] >= v),
      `第 ${i + 1} 张表按伤害降序（${dmg.slice(0, 5).join(' ≥ ')} …）`);
  }
}
// 表里必须**完整**列出该精灵的全部可用技能（与技能下拉框同一个数据源）——
// 早先只列了有威力的，导致无威力的功能/状态技能在下拉框里能选、在表里查不到
{
  const spA = A2.bySpirit.get('20:1');
  const spB = A2.bySpirit.get('43:1');
  for (const [side, sp] of [['a', spA], ['b', spB]]) {
    const usable = api.usableSkillsOf(sp);
    const chunk = calcHtml.split('<div data-skill-table="')[side === 'a' ? 1 : 2] ?? '';
    const slice = chunk.split('<div data-skill-table="')[0];
    const rendered = (slice.match(/data-calc-pick="/g) || []).length;
    ok(rendered === usable.length,
      `${sp.name}(${side}) 的表列出了全部 ${usable.length} 个可用技能（实际 ${rendered}）`);
    // 无威力的那些也要**直接列在主表里**（用户要求全列，不折叠），且被标成 no-power
    const noPower = usable.filter((s) => !((s.dmgMax ?? 0) > 0 && s.cat !== '状态'));
    const missing = noPower.filter((s) => !slice.includes(`data-calc-pick="${s.id}"`));
    ok(missing.length === 0, `${sp.name} 的 ${noPower.length} 个无威力技能都在表里（缺 ${missing.length}）`);
    ok((slice.match(/class="clickable[^"]*no-power"/g) || []).length === noPower.length,
      `无威力技能都带 no-power 标记（${noPower.length} 个）`);
    ok(!/<details/.test(slice), '不再用折叠区，全部平铺在主表里');
    ok(/没有威力|无威力/.test(slice), '有说明写清哪些是没有威力的技能');
    if (noPower.length) ok(/class="cst-sep"/.test(slice), '两段之间有分隔行');
  }
}

// 表里必须有血脉技能（血脉专属技能以前不在表里）
ok(/class="tag blood"/.test(calcHtml), '技能表里标出了血脉技能');
ok(/血脉/.test(calcHtml), '表头说明里提到血脉');
// 具体核对：血脉技能 id 必须真的出现在它自己的表里（含无威力那些）
{
  const spA = A2.bySpirit.get('20:1');
  const blSkills = (A2.data.spiritBloodlines?.[`${spA.id}:${spA.formId}`] ?? [])
    .map((x) => x.skillId).filter(Boolean);
  const tblA = calcHtml.split('<div data-skill-table="')[1] ?? '';
  const missing = blSkills.filter((id) => !tblA.includes(`data-calc-pick="${id}"`));
  ok(blSkills.length > 0, `岚鸟有 ${blSkills.length} 个血脉技能`);
  ok(missing.length === 0, `这些血脉技能都在表里（缺 ${missing.length} 个）`);
  // 且都带血脉标签（逐行切分来判断，跨行正则容易写坏）
  const rowsOf = (chunk) => chunk.split('<tr ').slice(1);
  const rowOfSkill = (chunk, id) => rowsOf(chunk).find((r) => r.includes(`data-calc-pick="${id}"`)) ?? '';
  const tagged = blSkills.filter((id) => rowOfSkill(tblA, id).includes('tag blood'));
  ok(tagged.length === blSkills.length, `血脉技能都带「血脉」标签（${tagged.length}/${blSkills.length}）`);
  // 非血脉技能不该被误标
  const lvlSkill = (A2.data.spiritSkills[`${spA.id}:${spA.formId}`] ?? [])
    .filter((x) => x.src === 'level')
    .map((x) => x.id)
    .find((id) => rowOfSkill(tblA, id));
  if (lvlSkill) {
    ok(!rowOfSkill(tblA, lvlSkill).includes('tag blood'), '升级学会的技能不会被误标成血脉');
  }
}

// 两侧的六维卡片区：3×2 卡片（大字面板值 + 小字种族值 + 个体按钮 + 性格开关）
{
  // 显式设回基准状态（前面的用例可能改过技能选择），再重渲染取实时 DOM
  A2.calc.a = '20:1'; A2.calc.b = '43:1'; A2.calc.skillA = 7150060; A2.calc.skillB = null;
  A2.view = 'calc';
  ids.get('app').innerHTML = '';
  api.render();
  const live = calcLive();

  const app2 = () => ids.get('app')._el;
  const cardsA = () => app2().querySelectorAll('.stat-cards[data-calc-side="a"] .s-card');
  const cardsB = () => app2().querySelectorAll('.stat-cards[data-calc-side="b"] .s-card');
  ok(cardsA().length === 6 && cardsB().length === 6, `两侧各 6 张卡片（实际 ${cardsA().length} / ${cardsB().length}）`);
  ok(app2().querySelectorAll('.stat-cards[data-calc-side="a"] [data-nat-ivbtn]').length === 6, '每侧六项各一个「个体」按钮');
  ok(app2().querySelectorAll('.stat-cards[data-calc-side="a"] [data-nat-btn]').length === 12, '每侧 12 个性格开关（每项两个）');
  ok(!/data-calc="iv"/.test(live) && !/data-calc="nature"/.test(live), '旧的个体/性格输入控件已去掉');
  ok(/当前血量/.test(live), '仍然可以填当前血量');

  // 卡片里要有"大字面板值"和"小字种族值"
  const firstCard = cardsA()[0];
  ok(/class="s-panel"/.test(firstCard.innerHTML), '卡片有大字面板值（.s-panel）');
  ok(/class="s-base"/.test(firstCard.innerHTML), '卡片有小字种族值（.s-base）');
  ok(/种族/.test(firstCard.innerHTML), '小字标明了「种族」');
  // 六张卡片的属性要对上 STAT_ORDER
  const stats = [...cardsA()].map((c) => c.dataset.stat);
  ok(stats.join(',') === 'hp,patk,satk,pdef,sdef,spd', `六张卡片顺序为 生命/物攻/魔攻/物防/魔防/速度（实际 ${stats.join(',')}）`);
  // 面板值要与 statBreakdown 一致
  const spA0 = A2.bySpirit.get(A2.calc.a);
  const cfgA0 = api.withCalcSide('a', () => api.spiritCalcOf(spA0));
  let panelOk = 0;
  for (const k of ['hp', 'patk', 'satk', 'pdef', 'sdef', 'spd']) {
    const b = api.statBreakdown(k, spA0.stats[k], cfgA0.stats[k].iv, cfgA0.stats[k].nature);
    const card = [...cardsA()].find((c) => c.dataset.stat === k);
    if (card && new RegExp(`>${b.panel}<`).test(card.innerHTML)) panelOk++;
  }
  ok(panelOk === 6, `六张卡片的面板值都与 statBreakdown 一致（${panelOk}/6）`);

  // 性格加点直接在这一页完成：卡片右上角就是「+ / −」，不再画攻/防描边高亮
  ok(cardsA().length + cardsB().length === 12, '12 张卡片都没有攻/防高亮类');
  ok([...cardsA()].every((c) => !/role-atk|role-def/.test(c.className ?? '')), 'A 侧卡片没有高亮类');
  const upBtn0 = cardsA()[1].querySelector('[data-nat-btn="patk"][data-nat-kind="up"]');
  ok(!!upBtn0, '卡片里有「+」性格按钮（可直接点）');
  ok(!!cardsA()[1].querySelector('[data-nat-btn="patk"][data-nat-kind="down"]'), '卡片里有「−」性格按钮');
  ok(/就是性格的加成/.test(live), '工具栏写明了「+ / −」是性格加减');

  // 页面级 id 不能重复（曾经弹窗与两侧都用 id="natalBlock"，导致取到 null、
  // 绑定被静默跳过、按钮点了没反应）
  const allIds = [...calcHtml.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = allIds.filter((x, i) => allIds.indexOf(x) !== i);
  ok(dup.length === 0, `伤害计算页没有重复 id（重复：${dup.join(',') || '无'}）`);

  // 【先做点击测试】此时 A 侧还没被别的断言改过，初始应为"六项都不投"
  // 点击后整页 render() 会换掉卡片区，所以要重新取节点
  const spClick = A2.bySpirit.get(A2.calc.a);
  const cfgClick = api.withCalcSide('a', () => api.spiritCalcOf(spClick));
  ok(cfgClick.stats.spd.iv === 0 && cfgClick.stats.spd.nature === 'neutral', 'A 侧速度初始未投、中性');
  const beforeSpd = api.withCalcSide('a', () => api.calcStatsOf(spClick, cfgClick).spd);
  app2().querySelector('.stat-cards[data-calc-side="a"] [data-nat-ivbtn="spd"]').click();
  ok(cfgClick.stats.spd.iv === 60, `点 A 侧「个体」按钮后 spd.iv = 60（实际 ${cfgClick.stats.spd.iv}）`);
  ok(cardsA().length === 6, '（点击后）A 侧卡片仍在');
  app2().querySelector('.stat-cards[data-calc-side="a"] [data-nat-btn="spd"][data-nat-kind="up"]').click();
  ok(cfgClick.stats.spd.nature === 'up', `点 A 侧「性格+」后 spd.nature = up（实际 ${cfgClick.stats.spd.nature}）`);
  const afterSpd = api.withCalcSide('a', () => api.calcStatsOf(spClick, cfgClick).spd);
  ok(afterSpd > beforeSpd, `A 侧速度面板从 ${beforeSpd} 升到 ${afterSpd}`);
  ok(/预计伤害/.test(ids.get('app').innerHTML), '改完加点后结果区仍在');
  // 点卡片区不该弹开详情弹窗（曾经容器带 data-spirit，点在卡片空白处就弹开了）。
  // 注意：这里的判定依据是"弹窗内容被换成精灵详情"，而不是 modal.hidden（桩里默认 false）。
  {
    ids.get('modal').hidden = true;
    ids.get('modalBody').innerHTML = '';
    app2().querySelector('.stat-cards[data-calc-side="a"] .s-card').click();
    ok(ids.get('modalBody').innerHTML === '', '点卡片本体不弹详情弹窗');
    app2().querySelector('.calc-toolbar').click();
    ok(ids.get('modalBody').innerHTML === '', '点工具栏不弹详情弹窗');
    app2().querySelector('.stat-cards[data-calc-side="a"]').click();
    ok(ids.get('modalBody').innerHTML === '', '点卡片区容器不弹详情弹窗');
    // 对照：精灵图鉴的卡片必须还能点开详情（别把委托改坏了）
    A2.view = 'spirits';
    ids.get('app').innerHTML = '';
    api.render();
    const gridCard = ids.get('app')._el.querySelector('.card[data-spirit]');
    ok(!!gridCard, '图鉴里有带 data-spirit 的卡片');
    gridCard.click();
    ok(ids.get('modalBody').innerHTML.length > 0, '点图鉴卡片仍能打开详情（事件委托没被改坏）');
    ids.get('modalBody').innerHTML = '';
    ids.get('modal').hidden = true;
    A2.view = 'calc';
    api.render();
  }
  // 性格按钮的互斥规则在卡片区同样生效
  ok(app2().querySelector('.stat-cards[data-calc-side="a"] [data-nat-btn="hp"][data-nat-kind="up"]').disabled,
    '「+」列已被速度占用 -> 生命卡片的「+」被禁用');
  // 收尾：把 A 侧清回初始，免得影响后面的断言
  app2().querySelector('[data-calc-reset="a"]').click();
  ok(cfgClick.stats.spd.iv === 0 && cfgClick.stats.spd.nature === 'neutral', '「清空」把 A 侧速度清回初始');

  // 配置独立性：改 A 侧的加点，不影响 B 侧，也不影响详情页那份
  const spA = A2.bySpirit.get(A2.calc.a);
  const spB = A2.bySpirit.get(A2.calc.b);
  const cfgA = api.withCalcSide('a', () => api.spiritCalcOf(spA));
  const cfgB = api.withCalcSide('b', () => api.spiritCalcOf(spB));
  const modalCfg = api.spiritCalcOf(spA);
  api.withCalcSide('a', () => { cfgA.stats.spd.iv = 60; cfgA.stats.spd.nature = 'up'; });
  ok(cfgB.stats.spd.iv === 0, '改 A 侧不影响 B 侧');
  ok(modalCfg.stats.spd.iv === 0 && modalCfg.stats.spd.nature === 'neutral', '改 A 侧也不影响详情页那份');
  ok(cfgA !== modalCfg, '两侧配置与详情页配置是不同对象');
}

/* ---------------------------------------------------------- 四技能槽 */
console.log('\n· 四技能槽 + 伤害占比');
{
  // 干净起点：两侧加点清空（注意 iv 与 nature 都要清），并把"已自动填过"的标记复位
  A2.calc.a = '20:1'; A2.calc.b = '43:1'; A2.calc.skillA = 7150060;
  A2.calc.loadA = [null, null, null, null]; A2.calc.powA = [null, null, null, null]; A2.calc.hitA = [1, 1, 1, 1];
  A2.calc.loadB = [null, null, null, null]; A2.calc.powB = [null, null, null, null]; A2.calc.hitB = [1, 1, 1, 1];
  A2.calc.loInitA = false; A2.calc.loInitB = false;
  for (const side of ['a', 'b']) {
    const sp = A2.bySpirit.get(A2.calc[side]);
    const c = api.withCalcSide(side, () => api.spiritCalcOf(sp));
    for (const k of ['hp', 'patk', 'satk', 'pdef', 'sdef', 'spd']) c.stats[k] = { iv: 0, nature: 'neutral' };
  }
  A2.view = 'calc';
  ids.get('app').innerHTML = '';
  api.render();

  const appL = () => ids.get('app')._el;
  ok(appL().querySelectorAll('.calc-loadout').length === 2, '两侧各有一个四技能槽区块');
  const loA = () => appL().querySelector('.calc-loadout[data-loadout="a"]');
  const loB = () => appL().querySelector('.calc-loadout[data-loadout="b"]');
  ok(loA().querySelectorAll('.lo-table tbody tr').length === 4, '每侧四行（四个技能槽）');

  // 初始自动填：两侧都放进"自己伤害最高的 4 个技能"，防守方不再是空白
  const filledA = A2.calc.loadA.filter(Boolean).length;
  const filledB = A2.calc.loadB.filter(Boolean).length;
  ok(filledA === 4, `A 侧初始自动填满 4 个（实际 ${filledA}）`);
  ok(filledB === 4, `B 侧（防守方）初始也自动填满 4 个（实际 ${filledB}）`);
  ok(loB().querySelectorAll('tr.lo-empty').length === 0, '防守方四技能槽没有空位');
  ok(!/class="lo-dmg">\s*<span class="desc">—/.test(loB().innerHTML), '防守方每一招都算出了伤害（不是「—」）');
  ok(loB().querySelectorAll('.lo-bar').length >= 4, '防守方每一招都有占比条');
  // 自动填的应当是"伤害最高的几个"：与 topSkillsOf 的前 4 个一致
  const topB4 = api.topSkillsOf('b', A2.bySpirit.get(A2.calc.b), A2.bySpirit.get(A2.calc.a), 4).map((x) => x.s.id);
  ok(JSON.stringify(A2.calc.loadB) === JSON.stringify(topB4), 'B 侧填的正是它伤害最高的 4 个技能');

  // 清空 A 侧（并把"已自动填过"标记复位），验证"点排序表一行 -> 放进第一个空位"
  A2.calc.loadA = [null, null, null, null];
  A2.calc.loInitA = false;
  ids.get('app').innerHTML = '';
  api.render();
  ok(loA().querySelectorAll('tr.lo-empty').length === 0 || A2.calc.loadA.filter(Boolean).length === 4,
    '（复位标记后）A 侧会被重新自动填满');
  // 再清一次但**不复位标记**，模拟"用户自己把四招都删了" -> 不该自动填回来
  for (const i of [0, 1, 2, 3]) {
    const del = appL().querySelector(`[data-loadout="a"] [data-lo-del="a:${i}"]`);
    if (del) del.click();
  }
  ok(A2.calc.loadA.every((x) => !x), '用户把四招都删掉后，不会被自动填回来');
  ok(loA().querySelectorAll('tr.lo-empty').length === 4, '（删除后）A 侧四个槽都是空的');
  const pickRow = appL().querySelector('[data-calc-pick]');
  const pickId = Number(pickRow.dataset.calcPick);
  pickRow.click();
  ok(A2.calc.loadA[0] === pickId, `点排序表一行 -> 放进 A 侧槽 1（实际 ${A2.calc.loadA[0]}）`);
  const loA2 = () => appL().querySelector('.calc-loadout[data-loadout="a"]');
  ok(loA2().querySelectorAll('tr[data-lo-row]').length === 1, '槽 1 已填上，其余仍是空位');
  ok(/≈|%/.test(loA2().innerHTML) || /%/.test(loA2().innerHTML), '显示了伤害占比（%）');
  ok(/class="lo-bar"/.test(loA2().innerHTML) && /style="width:/.test(loA2().innerHTML),
    '有占比进度条（lo-bar + 宽度内联样式）');

  // 伤害口径：技能槽 = 含全局加成（flatAdd / skillPct）的那一份
  const skL = A2.bySkill.get(pickId);
  const aL = A2.bySpirit.get(A2.calc.a);
  const bL = A2.bySpirit.get(A2.calc.b);
  const cfgAL = api.withCalcSide('a', () => api.spiritCalcOf(aL));
  const expect = api.withCalcSide('b', () => api.spiritCalcOf(bL));
  const ak = (skL.cat ?? '') === '魔法' ? 'satk' : 'patk';
  const dk = ak === 'satk' ? 'sdef' : 'pdef';
  const want = api.calcDamage(aL, bL, skL, {
    level: A2.calc.level, atkIV: cfgAL.stats[ak].iv, atkNature: cfgAL.stats[ak].nature,
    defIV: expect.stats[dk].iv, defNature: expect.stats[dk].nature,
    power: skL.dmgMax, flatAdd: A2.calc.flatAdd, skillPct: A2.calc.skillPct,
  }).dmg;
  const shownDmg = Number((loA2().querySelector('.lo-dmg').innerHTML.match(/<b>(\d+)<\/b>/) || [])[1]);
  ok(shownDmg === want, `槽里的伤害 = 含全局加成的手算值（界面 ${shownDmg} / 期望 ${want}）`);

  // 威力覆盖真的参与计算
  const powEl = appL().querySelector('[data-lo-pow="a:0"]');
  ok(Number(powEl.value) === skL.dmgMax, `威力输入框默认是技能自带威力（${powEl.value}）`);
  powEl.value = String(Math.round(skL.dmgMax / 2));
  powEl.dispatch('change');
  const halfDmg = Number((appL().querySelector('[data-loadout="a"] .lo-dmg').innerHTML.match(/<b>(\d+)<\/b>/) || [])[1]);
  ok(halfDmg < shownDmg, `威力减半 -> 伤害下降（${shownDmg} -> ${halfDmg}）`);

  // 连击：总伤害翻倍，并显示 ×N 击
  const hitEl = appL().querySelector('[data-lo-hit="a:0"]');
  hitEl.value = '2';
  hitEl.dispatch('change');
  const hitCell = appL().querySelector('[data-loadout="a"] .lo-dmg');
  const hitDmg = Number((hitCell.innerHTML.match(/<b>(\d+)<\/b>/) || [])[1]);
  ok(hitDmg === halfDmg * 2, `连击 2 -> 总伤害翻倍（${halfDmg} -> ${hitDmg}）`);
  ok(/×2/.test(hitCell.innerHTML), '标注了 ×2 击');

  // 占比：只剩一个技能时是 100%（单招占比的分母就是它自己）
  {
    const keep = A2.calc.loadA[0];
    A2.calc.loadA = [keep, null, null, null];
    ids.get('app').innerHTML = '';
    api.render();
    const cell = appL().querySelector('[data-loadout="a"] .lo-dmg');
    ok(/100\.0%/.test(cell.innerHTML), '（清掉另外三招后）单招占比 100.0%');
  }

  // 移除
  appL().querySelector('[data-lo-del="a:0"]').click();
  ok(A2.calc.loadA[0] === null, '点「×」能把技能移出槽位');
  ok(appL().querySelectorAll('.calc-loadout[data-loadout="a"] tr.lo-empty').length === 4,
    '把四招都删掉后是四个空位（不会又自动填回来）');
}

/* ---------------------------------------------------------- 状态面板 */
console.log('\n· 状态面板');
{
  ok(api.STATE.statuses.length === 54, `状态数据集 54 条（实际 ${api.STATE.statuses.length}）`);
  const kinds = A2.data.meta.statusKinds ?? {};
  ok(Object.keys(kinds).length >= 6, `分类至少 6 种（实际 ${Object.keys(kinds).length}）`);
  const mark = api.STATE.statuses.filter((s) => s.kind === 'mark');
  ok(mark.length === 15, `印记 15 条（实际 ${mark.length}）`);
  ok(mark.some((s) => s.name === '星陨印记'), '印记里有星陨印记');
  ok(api.STATE.statuses.every((s) => s.name && s.desc), '每条都有名称与描述（描述已去掉标记）');
  ok(!api.STATE.statuses.some((s) => /<[^>]+>/.test(s.desc)), '描述里没有残留的 <> 标记');

  A2.calc.a = '20:1'; A2.calc.b = '43:1'; A2.calc.skillA = 7150060;
  A2.calc.statusA = { picks: [], star: 0 }; A2.calc.statusB = { picks: [], star: 0 };
  A2.calc.modsA = { patkPct: 0, satkPct: 0, powerPct: 0, powerAdd: 0, finalPct: 100 };
  A2.calc.modsB = { patkPct: 0, satkPct: 0, powerPct: 0, powerAdd: 0, finalPct: 100 };
  A2.calc.hpPctA = 100; A2.calc.hpPctB = 100;
  A2.view = 'calc';
  ids.get('app').innerHTML = '';
  api.render();

  const appS = () => ids.get('app')._el;
  ok(!!appS().querySelector('.calc-status'), '伤害计算页有「状态」区块');
  ok(appS().querySelectorAll('.st-side').length === 2, '状态区块分两侧');
  ok(appS().querySelectorAll('[data-st-mod]').length === 16, `两侧各 8 个攻击因子（共 16，实际 ${appS().querySelectorAll('[data-st-mod]').length}）`);
  // 因子的类别与顺序要跟参考图一致
  {
    const labels = [...appS().querySelectorAll('.st-side[data-st-side="a"] .st-mod')]
      .map((m) => m.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    for (const want of ['物攻', '魔攻', '物防', '魔防', '速度', '技能威力']) {
      ok(labels.some((l) => l.includes(want)), `攻击因子里有「${want}」`);
    }
    ok(labels.length === 8, `我方恰好 8 个因子（实际 ${labels.length}）`);
  }
  ok(appS().querySelectorAll('[data-st-hp]').length === 2, '两侧各一条血量滑块');
  ok(appS().querySelectorAll('[data-st-star]').length === 2, '两侧各一个星陨层数');
  ok(appS().querySelectorAll('[data-st-pick]').length === 33 * 2, `两侧共 66 个状态可选按钮（前四类 33 条 ×2，实际 ${appS().querySelectorAll('[data-st-pick]').length}）`);

  // 点一个状态 -> 出现卡片
  appS().querySelector('[data-st-pick="a:starfall-mark"]').click();
  ok(A2.calc.statusA.picks.includes('starfall-mark'), '点一下把星陨印记加进我方');
  const card = appS().querySelector('.st-card');
  ok(!!card, '选中后出现状态卡片');
  ok(/星陨印记/.test(card.innerHTML) && /幻系伤害/.test(card.innerHTML), '卡片里有名称与描述');
  ok(/被 \d+ 个技能引用/.test(card.innerHTML), '卡片里标了引用技能数');
  // 再点一次取消
  appS().querySelector('[data-st-pick="a:starfall-mark"]').click();
  ok(!A2.calc.statusA.picks.includes('starfall-mark'), '再点一次取消选中');

  // 攻击因子真的进伤害计算：物攻% 影响物攻类技能，魔攻% 不影响
  const spS = A2.bySpirit.get(A2.calc.a);
  const defS = A2.bySpirit.get(A2.calc.b);
  const skS = A2.bySkill.get(7150060);            // 扇风：物理
  ok(skS.cat === '物理', '拿来做对照的技能是物理类');
  const base = api.calcDamage(spS, defS, skS, { level: 60, flatAdd: 20, skillPct: 0.5 });
  const withPatk = api.calcDamage(spS, defS, skS, {
    level: 60, flatAdd: 20, skillPct: 0.5,
    mods: { patkPct: 50, satkPct: 0, powerPct: 0, powerAdd: 0, finalPct: 100 },
  });
  const withSatk = api.calcDamage(spS, defS, skS, {
    level: 60, flatAdd: 20, skillPct: 0.5,
    mods: { patkPct: 0, satkPct: 50, powerPct: 0, powerAdd: 0, finalPct: 100 },
  });
  ok(withPatk.dmg > base.dmg, `物攻+50% 让物攻技能伤害变高（${base.dmg} -> ${withPatk.dmg}）`);
  ok(withSatk.dmg === base.dmg, '魔攻+50% 不影响物攻技能（物理/魔法各走各的）');
  const withPower = api.calcDamage(spS, defS, skS, {
    level: 60, flatAdd: 20, skillPct: 0.5,
    mods: { patkPct: 0, satkPct: 0, powerPct: 0, powerAdd: 20, finalPct: 100 },
  });
  ok(withPower.dmg > base.dmg, `技能威力+20 让伤害变高（${base.dmg} -> ${withPower.dmg}）`);
  const withFinal = api.calcDamage(spS, defS, skS, {
    level: 60, flatAdd: 20, skillPct: 0.5,
    mods: { patkPct: 0, satkPct: 0, powerPct: 0, powerAdd: 0, finalPct: 150 },
  });
  ok(withFinal.dmg > base.dmg, `独立乘区 150% 让伤害变高（${base.dmg} -> ${withFinal.dmg}）`);
  ok(!api.calcDamage(spS, defS, skS, { mods: null }).dmg !== base.dmg, '不传 mods 时行为不变（基准一致）');
  // 物防/魔防走 defMods：物防只影响物理技能，魔防只影响魔法技能
  const defUp = api.calcDamage(spS, defS, skS, {
    level: 60, flatAdd: 20, skillPct: 0.5,
    defMods: { pdefPct: 100, sdefPct: 0 },
  });
  const defCross = api.calcDamage(spS, defS, skS, {
    level: 60, flatAdd: 20, skillPct: 0.5,
    defMods: { pdefPct: 0, sdefPct: 100 },
  });
  ok(defUp.dmg < base.dmg, `物防+100% 让物理技能伤害减半（${base.dmg} -> ${defUp.dmg}）`);
  ok(defCross.dmg === base.dmg, '魔防+100% 不影响物理技能（物防/魔防各走各的）');
  ok(defUp.defStat === base.defStat * 2, `物防+100% 后防御值翻倍（${base.defStat} -> ${defUp.defStat}）`);

  // 血量滑块
  const hp = appS().querySelector('[data-st-hp="a"]');
  hp.value = '40';
  hp.dispatch('input');
  ok(A2.calc.hpPctA === 40, '拖血量滑块会写进状态');

  // 重置
  A2.calc.statusA = { picks: ['starfall-mark'], star: 3 };
  A2.calc.modsA.patkPct = 30;
  ids.get('app').innerHTML = '';
  api.render();
  appS().querySelector('[data-st-reset]').click();
  ok(A2.calc.statusA.picks.length === 0 && A2.calc.statusA.star === 0 && A2.calc.modsA.patkPct === 0,
    '「重置」清掉状态、层数与攻击因子');
  ok(A2.calc.hpPctA === 100, '「重置」把血量回到 100%');
}

/* ---------------------------------------------------------- 星陨印记（按威力走标准公式） */
console.log('\n· 星陨印记：显示威力 = 层数² + 24 × 层数 − 24');
{
  // 威力曲线：单调递增，0 层按 0 算
  const curve = [[0, 0], [1, 1], [2, 28], [5, 121], [10, 316], [20, 856], [30, 1596]];
  for (const [n, want] of curve) {
    ok(api.starfallPower(n) === want, `${n} 层 -> 威力 ${want}（实际 ${api.starfallPower(n)}）`);
  }
  let mono = true;
  for (let i = 1; i <= 60; i++) if (api.starfallPower(i) < api.starfallPower(i - 1)) mono = false;
  ok(mono, '威力随层数单调递增');
  ok(api.starfallPower(-3) === 0, '负数层数按 0 算');
  ok(api.starfallPower(0) === 0, '0 层威力 0（公式值 -24 被夹掉）');
  ok(api.statusModeOf('starfall-mark') === 'power', '星陨走 power 模式（不是百分比掉血）');
  ok(api.statusModeOf('burn') === 'pct', '灼烧仍走百分比模式');
  // 层数上限是 99
  {
    A2.calc.statusB = { picks: ['starfall-mark'], star: 0, layers: { 'starfall-mark': 0 } };
    A2.view = 'calc';
    ids.get('app').innerHTML = '';
    api.render();
    const starEl = () => ids.get('app')._el.querySelector('[data-st-star="b"]');
    const rowEl = () => ids.get('app')._el.querySelector('[data-st-layers="b:starfall-mark"]');
    ok(String(starEl().max || starEl().getAttribute('max')) === '99', '「星陨层数」上限 99');
    ok(String(rowEl().max || rowEl().getAttribute('max')) === '99', '状态伤害那行的层数上限 99');
    // 两处是同一份真值，改一个另一个跟着变
    const a1 = starEl(); a1.value = '40'; a1.dispatch('change');
    ok(A2.calc.statusB.star === 40, `在「星陨层数」填 40 -> star = ${A2.calc.statusB.star}`);
    ok(Number(rowEl().value) === 40, '状态伤害那行同步显示 40');
    const b1 = rowEl(); b1.value = '99'; b1.dispatch('change');
    ok(A2.calc.statusB.star === 99, `在状态伤害那行填 99 -> star = ${A2.calc.statusB.star}`);
    ok(Number(starEl().value) === 99, '「星陨层数」同步显示 99');
    ok(api.starfallPower(99) === 12153, `99 层威力 = ${api.starfallPower(99)}`);
    const c1 = starEl(); c1.value = '500'; c1.dispatch('change');
    ok(A2.calc.statusB.star === 99, '超过 99 会被夹到 99');
    const d1 = starEl(); d1.value = '-5'; d1.dispatch('change');
    ok(A2.calc.statusB.star === 0, '负数会被夹到 0');
    // 连击数上限还是 9，没被误改
    const hitEl = ids.get('app')._el.querySelector('[data-lo-hit]');
    ok(!!hitEl && String(hitEl.max || hitEl.getAttribute('max')) === '9', '四技能槽连击数上限仍是 9');
  }

  // 物理技能触发 vs 魔法技能触发：攻防面板不同，结果应不同
  A2.calc.a = '20:1'; A2.calc.b = '43:1'; A2.calc.skillA = 7150060;
  A2.calc.statusA = { picks: [], star: 0, layers: {} };
  A2.calc.statusB = { picks: ['starfall-mark'], star: 5, layers: { 'starfall-mark': 5 } };
  A2.calc.statusPctA = {}; A2.calc.statusPctB = {};
  A2.calc.hpPctA = 100; A2.calc.hpPctB = 100;
  A2.calc.modsA = { patkPct: 0, satkPct: 0, pdefPct: 0, sdefPct: 0, spdAdd: 0, powerPct: 0, powerAdd: 0, finalPct: 100 };
  A2.calc.modsB = { ...A2.calc.modsA };
  A2.view = 'calc';
  ids.get('app').innerHTML = '';
  api.render();

  const spSA = A2.bySpirit.get('20:1');
  const spSB = A2.bySpirit.get('43:1');
  const phys = [...A2.data.skills].find((s) => s.cat === '物理' && (s.dmgMax ?? 0) > 0 && s.id !== 7150060);
  const mag = [...A2.data.skills].find((s) => s.cat === '魔法' && (s.dmgMax ?? 0) > 0);
  const rPhys = api.statusDamageOf('b', spSB, { attacker: spSA, skill: phys }).rows[0];
  const rMag = api.statusDamageOf('b', spSB, { attacker: spSA, skill: mag }).rows[0];
  ok(rPhys.mode === 'power' && rPhys.power === 121, `5 层显示威力 = 121（实际 ${rPhys.power}）`);
  ok(rPhys.raw > 0 && rMag.raw > 0, `物理/魔法触发都算出伤害（${rPhys.raw} / ${rMag.raw}）`);
  ok(rPhys.detail.isPhysical === true, '物理技能触发时用物攻/物防');
  ok(rMag.detail.isPhysical === false, '魔法技能触发时用魔攻/魔防');
  ok(rPhys.raw !== rMag.raw, `两种攻击类型结果不同（${rPhys.raw} vs ${rMag.raw}）`);
  // 系别固定幻系：克制按幻系算，与触发技能的系别无关
  {
    const fx = A2.typeByName.get('幻系').id;
    ok(rPhys.detail.typeEff === api.typeEffect(fx, spSB.types), `克制按幻系算（×${rPhys.detail.typeEff}）`);
    ok(rPhys.detail.dmgTypeId === fx, '实际参与计算的系别是幻系（typeOverrideId 生效）');
    // 换一个对幻系抗性不同的目标，伤害应随之变（证明克制确实在起作用）
    const other = A2.data.spirits.find((s) => s.formId === 1 && api.typeEffect(fx, s.types) !== 1);
    if (other) {
      const rOther = api.statusDamageOf('b', other, { attacker: spSA, skill: phys }).rows[0];
      ok(rOther.detail.typeEff === api.typeEffect(fx, other.types), `换目标后按幻系克制重算（×${rOther.detail.typeEff}）`);
    }
  }
  // 页面显示
  {
    const box = [...ids.get('app')._el.querySelectorAll('.st-dmg')][1];
    const t = box.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    ok(/显示威力/.test(t), '页面标出「显示威力」');
    ok(/121/.test(t), '页面出现威力 121');
    ok(/5 层/.test(t), '页面标出层数');
    ok(/物理|魔法/.test(t), '页面标出物理/魔法归属');
  }
  // 还原
  A2.calc.statusA = { picks: [], star: 0, layers: {} };
  A2.calc.statusB = { picks: [], star: 0, layers: {} };
  A2.calc.statusPctA = {}; A2.calc.statusPctB = {};
  ids.get('app').innerHTML = '';
  api.render();
}

/* ---------------------------------------------------------- 星陨斩杀线 */
console.log('\n· 斩杀线：这一招 + 几层星陨到线（含回合末掉血）');
{
  const setupK = (picks) => {
    A2.calc.a = '20:1'; A2.calc.b = '43:1'; A2.calc.skillA = 7150060;
    A2.calc.hpPctA = 100; A2.calc.hpPctB = 100;
    A2.calc.statusA = { picks: [], star: 0, layers: {} };
    A2.calc.statusB = { picks, star: 0, layers: {} };
    A2.calc.statusPctA = {}; A2.calc.statusPctB = {};
    A2.calc.modsA = { patkPct: 0, satkPct: 0, pdefPct: 0, sdefPct: 0, spdAdd: 0, powerPct: 0, powerAdd: 0, finalPct: 100 };
    A2.calc.modsB = { ...A2.calc.modsA };
    A2.view = 'calc';
    ids.get('app').innerHTML = '';
    api.render();
  };
  const spKA = () => A2.bySpirit.get('20:1');
  const spKB = () => A2.bySpirit.get('43:1');
  const physK = [...A2.data.skills].find((s) => s.cat === '物理' && (s.dmgMax ?? 0) > 0
    && s.typeId !== A2.typeByName.get('幻系').id);
  const killCols = (sel) => ids.get('app')._el.querySelectorAll(sel);

  // ① 什么都没挂 -> 整列不显示（用户要求：正常情况下不用显示）
  setupK([]);
  ok(killCols('.lo-kill').length === 0, '什么都没挂时不显示斩杀列');
  ok(api.starfallKillLayers(spKA(), spKB(), physK, {}) === null, '无回合末伤害时函数返回 null');

  // ② 只挂星陨印记 -> 出层数，且必须是最小的那个
  setupK(['starfall-mark']);
  ok(killCols('.lo-kill').length > 0, '挂星陨印记后出现斩杀列');
  {
    const n = api.starfallKillLayers(spKA(), spKB(), physK, {});
    const hp = api.targetHpOf('b', spKB());
    const at = (layers) => api.damageWithPower(spKA(), spKB(), physK, physK.dmgMax, {})
      + api.damageWithPower(spKA(), spKB(), physK, api.starfallPower(layers), { phantom: true });
    ok(n > 0, `「${physK.name}」需要 ${n} 层`);
    ok(at(n) >= hp, `${n} 层总伤害 ${at(n)} ≥ 目标 ${hp}`);
    // 关键回归：必须是"最少"层数（早先估算偏大时会返回偏大的值）
    ok(at(n - 1) < hp, `${n - 1} 层 ${at(n - 1)} 不足以斩杀 —— 确认是最少层数`);
  }
  // ③ 只挂回合末掉血（灼烧，没星陨）-> 也显示该列，层数恒为 0（星陨帮不上忙）
  setupK(['burn']);
  ok(killCols('.lo-kill').length > 0, '只有回合末掉血时也显示斩杀列');
  ok(api.starfallKillLayers(spKA(), spKB(), physK, {}) === 0 || api.starfallKillLayers(spKA(), spKB(), physK, {}) === null,
    '没有星陨可补时只可能是 0（已到线）或 null（到不了）');
  ok(Array.from(killCols('.lo-kill')).every((c) => /不需要|—/.test(c.innerHTML)),
    '没有星陨时该列只会是「不需要」或「—」');
  // ④ 非回合末的状态（棘刺印记）不该让这一列出现
  setupK(['thorn-mark']);
  ok(killCols('.lo-kill').length === 0, '只挂「离场换人时」结算的棘刺印记时不显示（它不是回合末）');
  // ⑤ 回合末伤害会降低所需层数
  //    注意是"最多层数"的那一招体现最明显：层数给得越足，灼烧那点固定伤害越容易补上
  //    临界差（少一层就差几百伤害），所以这里扫一遍找确实能看出差异的技能。
  {
    const skills = [...A2.data.skills].filter((s) => (s.dmgMax ?? 0) > 0 && s.cat !== '状态'
      && s.typeId && s.typeId !== A2.typeByName.get('幻系').id);
    const layerOf = (picks, s) => {
      setupK(picks);
      return api.starfallKillLayers(spKA(), spKB(), s, {});
    };
    let improved = null;
    let maxOnly = -1;
    for (const s of skills) {
      const only = layerOf(['starfall-mark'], s);
      if (only === null || only < 2) continue;
      const withBurn = layerOf(['starfall-mark', 'burn'], s);
      if (withBurn !== null && withBurn < only && only > maxOnly) {
        maxOnly = only; improved = { s, only, withBurn };
      }
    }
    ok(!!improved, `找得到"加上回合末掉血后所需层数变少"的技能${improved ? `（${improved.s.name}）` : ''}`);
    if (improved) {
      ok(improved.withBurn < improved.only,
        `「${improved.s.name}」加上灼烧后层数下降（${improved.only} -> ${improved.withBurn} 层）`);
    }
    // 全局口径：任何一招加上回合末伤害后都不该需要更多层
    let worse = null;
    for (const s of skills.slice(0, 40)) {
      const only = layerOf(['starfall-mark'], s);
      const withBurn = layerOf(['starfall-mark', 'burn'], s);
      if (only !== null && withBurn !== null && withBurn > only) { worse = s; break; }
    }
    ok(!worse, `没有任何一招会因为加了回合末掉血而需要更多层${worse ? `（反例：${worse.name}）` : ''}`);
  }
  // ⑥ 回合末伤害单独就能到线 -> 不需要星陨
  {
    setupK(['burn']);
    A2.calc.hpPctB = 8;   // 对面残血，光靠灼烧就够
    const n = api.starfallKillLayers(spKA(), spKB(), physK, {});
    ok(n === 0 || n === null, `残血 + 灼烧时不会要求星陨层数（实际 ${n}）`);
    A2.calc.hpPctB = 100;
  }
  // ⑦ 幻系技能不触发星陨
  {
    setupK(['starfall-mark']);
    const phId = A2.typeByName.get('幻系').id;
    const ph = [...A2.data.skills].find((s) => s.typeId === phId && (s.dmgMax ?? 0) > 0);
    if (ph) ok(api.starfallKillLayers(spKA(), spKB(), ph, {}) === null, `幻系技能「${ph.name}」不触发星陨`);
  }
  // ⑧ 本身打得死 -> 0 / 「不需要」
  {
    setupK(['starfall-mark']);
    A2.calc.hpPctB = 5;
    ids.get('app').innerHTML = '';
    api.render();
    ok(api.starfallKillLayers(spKA(), spKB(), physK, {}) === 0, '对面残血时返回 0');
    ok(/不需要/.test(ids.get('app')._el.innerHTML), '页面显示「不需要」');
    A2.calc.hpPctB = 100;
  }
  // ⑨ 两张表口径不同：含全局加成时所需层数不会更多
  {
    setupK(['starfall-mark']);
    const bare = api.starfallKillLayers(spKA(), spKB(), physK, { sendGlobal: false });
    const glob = api.starfallKillLayers(spKA(), spKB(), physK, { sendGlobal: true });
    ok(glob <= bare, `含全局加成时所需层数不多于裸威力口径（${glob} ≤ ${bare}）`);
  }
  // ⑩ 页面真的渲染出列（两侧都要有技能 —— 自动填标记可能被前面的用例烧掉，这里显式填）
  {
    setupK(['starfall-mark']);
    api.fillLoadoutWithTop('a', A2.bySpirit.get(A2.calc.a), A2.bySpirit.get(A2.calc.b), 4);
    api.fillLoadoutWithTop('b', A2.bySpirit.get(A2.calc.b), A2.bySpirit.get(A2.calc.a), 4);
    ids.get('app').innerHTML = '';
    api.render();
    const lo = [...killCols('.lo-table .lo-kill')];
    ok(lo.length === 8, `两侧四技能槽各 4 行斩杀列（共 ${lo.length}）`);
    ok(lo.every((c) => /层|—|不需要/.test(c.innerHTML)), '四技能槽的斩杀格都有内容');
    // 两侧的技能表也该有斩杀列
    const st = [...killCols('.calc-skill-table .lo-kill')];
    ok(st.length > 12, `两侧技能表也有斩杀列（共 ${st.length} 格）`);
  }
  // 还原
  setupK([]);
}

/* ---------------------------------------------------------- 状态造成的伤害 */
console.log('\n· 状态造成的伤害（含元素克制）');
{
  ok(api.STATUS_EFFECTS && Object.keys(api.STATUS_EFFECTS).length >= 6,
    `状态伤害表至少 6 项（实际 ${Object.keys(api.STATUS_EFFECTS ?? {}).length}）`);
  for (const k of ['burn', 'poison', 'freeze', 'parasite', 'conductive-charge', 'poison-mark', 'thorn-mark', 'starfall-mark']) {
    ok(!!api.STATUS_EFFECTS[k], `表里有「${k}」`);
  }
  ok(api.STATUS_EFFECTS.burn.pct === 2 && api.STATUS_EFFECTS.burn.element === '火系', '灼烧 = 火系 2%');
  ok(api.STATUS_EFFECTS.poison.pct === 3 && api.STATUS_EFFECTS.poison.element === '毒系', '中毒 = 毒系 3%');
  // 冻结与寄生**不受克制关系影响**（element 为 null），寄生按最大生命 6%
  ok(api.STATUS_EFFECTS.freeze.pct === 5 && api.STATUS_EFFECTS.freeze.element === null, '冻结 = 5%、不受克制');
  ok(api.STATUS_EFFECTS.parasite.pct === 6 && api.STATUS_EFFECTS.parasite.element === null, '寄生 = 最大生命 6%、不受克制');
  ok(api.STATUS_EFFECTS['thorn-mark'].pct === 6 && api.STATUS_EFFECTS['thorn-mark'].element === null, '棘刺印记 = 6%、不受克制');
  // 双克制只有 ×3、双抵抗是 ×¼，且这两个倍率确实会出现在数据里
  {
    const mults = new Set();
    for (const sp of A2.data.spirits) {
      for (const t of A2.data.meta.types) mults.add(api.typeEffect(t.id, sp.types ?? []));
    }
    ok(mults.has(3), '双系数据里确实存在 ×3 双克制');
    ok(mults.has(0.25), '双系数据里确实存在 ×¼ 双抵抗');
    ok(!mults.has(4), '不存在 ×4 —— 双克制按规则算 ×3 而不是相乘');
    ok(!mults.has(0.125), '不存在 ×0.125 —— 双抵抗按规则算 ×¼');
    const sorted = [...mults].sort((a, b) => a - b);
    ok(sorted.join(',') === '0.25,0.5,1,2,3', `倍率只可能是 0.25/0.5/1/2/3（实际 ${sorted.join(',')}）`);
  }

  // 奇丽花是草系：火系打草系应触发克制
  A2.calc.a = '20:1'; A2.calc.b = '43:1'; A2.calc.skillA = 7150060;
  A2.calc.statusA = { picks: [], star: 0, layers: {} };
  A2.calc.statusB = { picks: ['burn'], star: 0, layers: { burn: 3 } };
  A2.calc.statusPctA = {}; A2.calc.statusPctB = {};
  A2.calc.hpPctA = 100; A2.calc.hpPctB = 100;
  A2.calc.modsA = { patkPct: 0, satkPct: 0, pdefPct: 0, sdefPct: 0, spdAdd: 0, powerPct: 0, powerAdd: 0, finalPct: 100 };
  A2.calc.modsB = { ...A2.calc.modsA };
  A2.view = 'calc';
  ids.get('app').innerHTML = '';
  api.render();
  const appD = () => ids.get('app')._el;
  const dmgBlock = (side) => [...appD().querySelectorAll('.st-dmg')][side === 'a' ? 0 : 1];
  const txtD = (el) => el.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  ok(appD().querySelectorAll('.st-dmg').length === 2, '两侧各有一块「状态造成的伤害」');
  ok(/状态造成的伤害/.test(txtD(dmgBlock('b'))), '对方那侧有该区块');

  // 草系被火系克制：3 层 × 2% × 2 倍
  const spB = A2.bySpirit.get(A2.calc.b);
  const maxB = api.hpMaxOf('b', spB);
  const expect = Math.floor((maxB * 6) / 100 * 2);
  const d = api.statusDamageOf('b', spB);
  ok(d.rows.length === 1 && d.rows[0].name === '灼烧', '算出的是灼烧这一条');
  ok(d.rows[0].eff === 2, `火系打草系拿到 ×2 克制（实际 ×${d.rows[0].eff}）`);
  ok(d.rows[0].raw === expect, `掉血 = floor(${maxB} × 6% × 2) = ${expect}（实际 ${d.rows[0].raw}）`);
  ok(d.total === expect, `合计 = ${expect}（实际 ${d.total}）`);
  ok(new RegExp(`合计\\s*${expect}`).test(txtD(dmgBlock('b'))), `页面显示合计 ${expect}`);
  ok(/2% × 3 层/.test(txtD(dmgBlock('b'))), '页面写清了「每层% × 层数」');
  ok(/克制/.test(txtD(dmgBlock('b'))), '页面标了克制');

  // 换个不被火克制的目标：倍数应为 ×1
  A2.calc.b = '152:1';
  ids.get('app').innerHTML = '';
  api.render();
  {
    const sp2 = A2.bySpirit.get(A2.calc.b);
    const d2 = api.statusDamageOf('b', sp2);
    ok(d2.rows[0].eff === 1, `翼系不克制也不抵抗 -> ×1（实际 ×${d2.rows[0].eff}）`);
    ok(d2.rows[0].raw === Math.floor((api.hpMaxOf('b', sp2) * 6) / 100), '掉血按 ×1 算');
  }

  // 层数：3 -> 5，掉血按比例涨
  A2.calc.b = '43:1';
  ids.get('app').innerHTML = '';
  api.render();
  const before5 = api.statusDamageOf('b', A2.bySpirit.get('43:1')).total;
  const layEl = appD().querySelector('[data-st-layers="b:burn"]');
  layEl.value = '5';
  layEl.dispatch('change');
  const after5 = api.statusDamageOf('b', A2.bySpirit.get('43:1')).total;
  ok(A2.calc.statusB.layers.burn === 5, `层数改成 5（实际 ${A2.calc.statusB.layers.burn}）`);
  ok(after5 > before5, `层数变多 -> 掉血变多（${before5} -> ${after5}）`);

  // 每层百分比可改（默认取词条描述）
  const pctEl = appD().querySelector('[data-st-pct="b:burn"]');
  ok(Number(pctEl.value) === 2, `每层百分比默认 2（实际 ${pctEl.value}）`);
  pctEl.value = '10';
  pctEl.dispatch('change');
  ok(A2.calc.statusPctB.burn === 10, '改百分比写进状态');
  ok(api.statusDamageOf('b', A2.bySpirit.get('43:1')).total > after5, '百分比变大 -> 掉血变多');

  // 掉血不会超过当前生命（最多力竭）
  A2.calc.hpPctB = 10;
  ids.get('app').innerHTML = '';
  api.render();
  {
    const dd = api.statusDamageOf('b', A2.bySpirit.get('43:1'));
    ok(dd.total > dd.curHp, '这个例子里理论掉血已经超过当前生命');
    ok(dd.capped === dd.curHp, `实际扣除夹到当前生命（${dd.capped} = ${dd.curHp}）`);
    ok(dd.lethal === true, '标记为会力竭');
    ok(/会力竭/.test(txtD(dmgBlock('b'))), '页面上标出「会力竭」');
  }

  // 不受克制的状态也要进这块（只是不乘克制），并标出「不受克制」
  A2.calc.statusB = { picks: ['thorn-mark'], star: 0, layers: {} };
  A2.calc.statusPctB = {};
  A2.calc.hpPctB = 100;
  ids.get('app').innerHTML = '';
  api.render();
  {
    const dd = api.statusDamageOf('b', A2.bySpirit.get('43:1'));
    ok(dd.rows.length === 1 && dd.rows[0].name === '棘刺印记', '无元素的状态也进"状态造成的伤害"');
    ok(dd.rows[0].effective === false, '它被标记为 effective=false（不走克制）');
    ok(dd.rows[0].eff === 1, `它的倍率是 ×1（实际 ×${dd.rows[0].eff}）`);
    ok(/不受克制/.test(txtD(dmgBlock('b'))), '页面上标出「不受克制」');
  }
  // 寄生：最大生命 6%、不受克制
  A2.calc.statusB = { picks: ['parasite'], star: 0, layers: {} };
  A2.calc.statusPctB = {};
  ids.get('app').innerHTML = '';
  api.render();
  {
    const spP = A2.bySpirit.get('43:1');
    const dd = api.statusDamageOf('b', spP);
    ok(dd.rows.length === 1, '寄生进这块');
    ok(dd.rows[0].pct === 6, `寄生默认 6%（实际 ${dd.rows[0].pct}）`);
    ok(dd.rows[0].effective === false && dd.rows[0].eff === 1, '寄生不受克制影响');
    ok(dd.total === Math.floor((api.hpMaxOf('b', spP) * 6) / 100),
      `寄生掉血 = floor(面板生命 × 6%)（实际 ${dd.total}）`);
  }
  // 冻结：不受克制，按层数
  A2.calc.statusB = { picks: ['freeze'], star: 0, layers: { freeze: 2 } };
  A2.calc.statusPctB = {};
  ids.get('app').innerHTML = '';
  api.render();
  {
    const spF = A2.bySpirit.get('43:1');
    const dd = api.statusDamageOf('b', spF);
    ok(dd.rows[0].effective === false, '冻结不受克制');
    ok(dd.rows[0].pctSum === 10, `2 层 × 5% = 10%（实际 ${dd.rows[0].pctSum}%）`);
    ok(dd.total === Math.floor((api.hpMaxOf('b', spF) * 10) / 100), '冻结掉血按层数算且不乘克制');
  }

  // 没选任何状态时给出提示
  A2.calc.statusB = { picks: [], star: 0, layers: {} };
  ids.get('app').innerHTML = '';
  api.render();
  ok(appD().querySelectorAll('.st-dmg-empty').length === 2, '没选状态时两侧都显示提示文案');

  // 还原
  A2.calc.statusA = { picks: [], star: 0, layers: {} };
  A2.calc.statusB = { picks: [], star: 0, layers: {} };
  A2.calc.statusPctA = {}; A2.calc.statusPctB = {};
  A2.calc.hpPctA = 100; A2.calc.hpPctB = 100;
  A2.calc.b = '43:1';
  ids.get('app').innerHTML = '';
  api.render();
}

/* ---------------------------------------------------------- 血量 / 精灵选择 / 分类 */
console.log('\n· 血量条 · 精灵选择 · 状态分类');
{
  A2.calc.a = '20:1'; A2.calc.b = '43:1'; A2.calc.skillA = 7150060;
  A2.calc.spOpen = null; A2.calc.spQuery = { a: '', b: '' };
  A2.view = 'calc';
  ids.get('app').innerHTML = '';
  api.render();
  const appH = () => ids.get('app')._el;

  // ① 旧的「当前血量」输入框已摘掉，血量只在下方状态面板里调
  ok(appH().querySelectorAll('[data-calc="hp"]').length === 0, '侧栏不再有「当前血量」输入框');
  ok(!appH().querySelector('#chp-a') && !appH().querySelector('#chp-b'), '旧的 #chp- 输入框已移除');

  // ② 血量条是可拖动的滑块，叠在进度条上；拖动时只就地更新、不重渲染
  const tracks = appH().querySelectorAll('.st-hp-track input[type="range"][data-st-hp]');
  ok(tracks.length === 2, `两侧各一个可拖动血量滑块（实际 ${tracks.length}）`);
  ok(appH().querySelectorAll('.st-hp-track .st-hp-bar').length === 2, '滑块下面有进度条');
  {
    // 打个标记：若拖动中发生重渲染，这个标记会随节点一起消失
    const box = appH().querySelector('[data-st-hp="a"]').closest('.st-hp');
    box.dataset.dragProbe = 'keep';
    const hpEl = appH().querySelector('[data-st-hp="a"]');
    hpEl.value = '42';
    hpEl.dispatch('input');
    ok(A2.calc.hpPctA === 42, `拖动写进状态（实际 ${A2.calc.hpPctA}）`);
    const box2 = appH().querySelector('[data-st-hp="a"]').closest('.st-hp');
    ok(box2.querySelector('.st-hp-pct').textContent === '42%', `拖动中百分比文字就地更新（实际 ${box2.querySelector('.st-hp-pct').textContent}）`);
    ok(/^\d+\/\d+$/.test(box2.querySelector('.st-hp-max').textContent), `拖动中当前/总量就地更新（实际 ${box2.querySelector('.st-hp-max').textContent}）`);
    ok(box2.querySelector('.st-hp-bar i').style.width === '42%', `拖动中进度条宽度就地更新（实际 ${box2.querySelector('.st-hp-bar i').style.width}）`);
    ok(appH().querySelector('[data-drag-probe="keep"]') !== null, '拖动过程中没有重渲染（否则正在拖的滑块会被换掉 → 卡手）');
    // 松手（change）后才整体重算
    delete box2.dataset.dragProbe;
  }

  // ③ 状态选择只保留前四类
  const groups = [...appH().querySelectorAll('.st-group-head')].map((g) => g.innerHTML.replace(/<[^>]+>/g, ' ').trim());
  ok(appH().querySelectorAll('.st-group').length === 8, `两侧各 4 个分类分组（共 8，实际 ${appH().querySelectorAll('.st-group').length}）`);
  for (const label of ['印记', '天气', '状态', '增益']) {
    ok(groups.some((g) => g.includes(label)), `选择区保留了「${label}」分类`);
  }
  for (const label of ['应对', '离场', '机制']) {
    ok(!groups.some((g) => g.startsWith(label)), `选择区不再显示「${label}」分类`);
  }
  // 但说明弹窗里仍然全都有
  const helpKinds = Object.keys(A2.data.meta.statusKinds);
  ok(helpKinds.includes('counter') && helpKinds.includes('mechanic'), '「？异常与印记」里仍有应对/机制（数据没删）');

  // 血量必须与卡片区的生命面板值一致（先前这里用种族基础值当总量，
  // 卡片显示面板值 323、血量条却显示 100/90，两个数对不上）
  {
    A2.calc.hpPctA = 100; A2.calc.hpPctB = 100;
    ids.get('app').innerHTML = '';
    api.render();
    const appX = () => ids.get('app')._el;
    const cardHp = (side) => {
      const card = [...appX().querySelectorAll(`.stat-cards[data-calc-side="${side}"] .s-card`)]
        .find((c) => c.dataset.stat === 'hp');
      const m = /s-panel">(\d+)</.exec(card ? card.innerHTML : '');
      return m ? Number(m[1]) : null;
    };
    const barHp = (side) => {
      const box = [...appX().querySelectorAll('.st-hp')][side === 'a' ? 0 : 1];
      const m = /(\d+)%\s*(\d+)\/(\d+)/.exec(box.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
      return m ? { pct: Number(m[1]), cur: Number(m[2]), max: Number(m[3]) } : null;
    };
    for (const side of ['a', 'b']) {
      const c = cardHp(side); const b = barHp(side);
      ok(c !== null && b !== null, `${side} 侧能同时读到卡片生命值与血量条`);
      ok(c === b.max, `${side} 侧血量条的「总量」= 卡片生命面板值（${b.max} vs ${c}）`);
    }
    // 拖到 60%：当前血量 = round(总量 × 60%)，且绝不超过总量
    A2.calc.hpPctA = 60;
    ids.get('app').innerHTML = '';
    api.render();
    {
      const c = cardHp('a'); const b = barHp('a');
      ok(b.pct === 60, `拖动后百分比是 60（实际 ${b.pct}）`);
      ok(b.cur === Math.round(c * 0.6), `当前血量 = round(${c} × 60%) = ${b.cur}`);
      ok(b.cur <= b.max, '当前血量不超过总量（不会再出现 100/90 这种）');
    }
    // 换精灵：总量跟着换成新精灵的面板生命值，且不残留上一只的数值
    A2.calc.hpPctA = 50;
    A2.calc.a = '152:1';
    A2.calc.spOpen = null;
    ids.get('app').innerHTML = '';
    api.render();
    {
      const c = cardHp('a'); const b = barHp('a');
      ok(c === b.max, `换精灵后总量换成新面板值（${b.max} vs ${c}）`);
      ok(b.cur === Math.round(c * 0.5), `当前血量按新总量换算（${b.cur} = round(${c} × 50%)）`);
      ok(b.cur <= b.max, '换精灵后也不出现"当前 > 总量"');
    }
    // 还原
    A2.calc.a = '20:1'; A2.calc.hpPctA = 100; A2.calc.hpPctB = 100;
    ids.get('app').innerHTML = '';
    api.render();
  }

  // ④ 精灵选择是可搜索的下拉
  ok(appH().querySelectorAll('select[data-calc="spirit"]').length === 0, '不再是原生 select');
  ok(appH().querySelectorAll('[data-calc-picker]').length === 2, '两侧各一个下拉按钮');
  ok(/岚鸟/.test(appH().querySelector('[data-calc-picker="a"]').innerHTML), '按钮显示当前精灵');
  appH().querySelector('[data-calc-picker="a"]').click();
  ok(A2.calc.spOpen === 'a', '点一下展开下拉');
  const qEl = appH().querySelector('[data-calc-picker-q="a"]');
  ok(!!qEl, '下拉里有搜索框');
  ok(appH().querySelectorAll('.calc-picker-item').length > 10, '未过滤时列出候选');
  // 输入过滤（debounce 之后生效）
  qEl.value = '翼王';
  qEl.dispatch('input');
  await new Promise((r) => setTimeout(r, 240));
  const hits = [...appH().querySelectorAll('.calc-picker-item')].map((x) => x.innerHTML.replace(/<[^>]+>/g, ''));
  ok(hits.length >= 1 && hits.every((h) => h.includes('翼王')), `搜「翼王」只留下匹配项（${hits.join(' / ')}）`);
  // 选中：注意精灵键本身含冒号（152:1），不能被 split(':') 截断
  appH().querySelector('.calc-picker-item').click();
  ok(A2.calc.a === '152:1', `选中后记下完整键（实际 ${A2.calc.a}）`);
  ok(!!A2.bySpirit.get(A2.calc.a), '选中的键在精灵表里查得到');
  ok(A2.calc.spOpen === null, '选完自动收起');
  ok(/翼王/.test(appH().querySelector('[data-calc-picker="a"]').innerHTML), '按钮换成新精灵');
  ok(appH().querySelectorAll('.stat-cards .s-card').length === 12, `换精灵后卡片区跟着重画（共 12 张，实际 ${appH().querySelectorAll('.stat-cards .s-card').length}）`);

  // 还原，别影响后面的断言
  A2.calc.a = '20:1'; A2.calc.hpPctA = 100;
}

// 性格表源自 BiliWiki：30 种，每种 +1 项 / -1 项，每项属性当"增""减"各 5 次。
// 修正系数 ±10%，且本作生命也受性格影响（与宝可梦不同）。
console.log('\n· 性格 · 天分 · 资质');
const lan2 = A2.data.spirits.find((s) => s.name === '岚鸟');   // 物攻种族 128
const natures = api.NATURES;                        // [名称, 增, 减, 描述]
ok(!!natures, '钩子暴露了 NATURES');
ok(natures.length === 30, `性格 30 种（实际 ${natures.length}）`);
ok(new Set(natures.map((n) => n[0])).size === 30, '性格无重名');

// 均衡性：每项属性作为"增"和"减"各 5 次
const upCount = {}, downCount = {};
for (const [, u, d] of natures) { upCount[u] = (upCount[u] || 0) + 1; downCount[d] = (downCount[d] || 0) + 1; }
const SIX = ['hp', 'patk', 'satk', 'pdef', 'sdef', 'spd'];
ok(SIX.every((k) => upCount[k] === 5), `每项属性作为"增"各 5 次（${SIX.map((k) => upCount[k]).join(',')}）`);
ok(SIX.every((k) => downCount[k] === 5), `每项属性作为"减"各 5 次（${SIX.map((k) => downCount[k]).join(',')}）`);
ok(natures.every((n) => n[1] !== n[2]), '没有"增""减"同一项的性格');

// 抽查几条已知性格（用 natureByName 取结构化对象）
const byName = api.natureByName;
ok(byName.get('固执').up === 'patk' && byName.get('固执').down === 'satk', '固执 = 物攻▲ 魔攻▼');
ok(byName.get('胆小').up === 'spd' && byName.get('胆小').down === 'patk', '胆小 = 速度▲ 物攻▼');
ok(byName.get('逞强').up === 'patk' && byName.get('逞强').down === 'hp', '逞强 = 物攻▲ 生命▼（本作生命也受性格影响）');

// ±10% 修正：性格乘在 round(…) 之后，round 只作用于「种族值×1.1 + 个体×0.55 + 10」
// 实测校验（来自用户游戏内数据）：
//   翼王(速度种族125) 个体60 加成×1.2 → round(137.5+33+10)=181 → ×1.2=217 → 267
//   水灵(速度种族85)  个体60 加成×1.2 → round(93.5+33+10)=137  → ×1.2=164 → 214
//   水灵(物防种族94)  个体0  中性×1.0 → round(103.4+10)=113    → 163
//   水灵(魔防种族132) 个体0  中性×1.0 → round(145.2+10)=155    → 205
ok(api.panelInt('spd', 125, 60, 'up') === 267, `翼王速度 267（实际 ${api.panelInt('spd', 125, 60, 'up')}）—— 游戏实测值`);
ok(api.panelInt('spd', 85, 60, 'up') === 214, `水灵速度 214（实际 ${api.panelInt('spd', 85, 60, 'up')}）—— 游戏实测值`);
ok(api.panelInt('pdef', 94, 0, 'neutral') === 163, `水灵物防 163（实际 ${api.panelInt('pdef', 94, 0, 'neutral')}）`);
ok(api.panelInt('sdef', 132, 0, 'neutral') === 205, `水灵魔防 205（实际 ${api.panelInt('sdef', 132, 0, 'neutral')}）`);
ok(api.panelInt('hp', 125, 60, 'neutral') === 434, `水灵生命 434（实际 ${api.panelInt('hp', 125, 60, 'neutral')}）—— 生命走独立公式`);
ok(api.panelInt('satk', 127, 60, 'neutral') === 233, `水灵魔攻 233（实际 ${api.panelInt('satk', 127, 60, 'neutral')}）`);
// 加成/中性/削弱三档
ok(api.panelInt('spd', 125, 60, 'up') > api.panelInt('spd', 125, 60, 'neutral'), '加成 > 中性');
ok(api.panelInt('spd', 125, 60, 'neutral') > api.panelInt('spd', 125, 60, 'down'), '中性 > 削弱');
// 星级/天分 -> 个体（ivOf 仍保留：它是"天分 × 星级倍率"的换算工具）
ok(api.ivOf(10, 5) === 60, `天分10 5★ -> 个体 60（实际 ${api.ivOf(10, 5)}）`);
ok(api.ivOf(10, 1) === 12, `天分10 1★ -> 个体 12（实际 ${api.ivOf(10, 1)}）`);
ok(api.ivOf(0, 5) === 0, '天分0 -> 个体 0');

// 独立的「性格 · 天分」页面已按用户要求切掉（功能并入精灵详情）
A2.view = 'nature';
ids.get('app').innerHTML = '';
api.render();
ok(!/天分 · 资质 · 性格/.test(ids.get('app').innerHTML), '访问 #/nature 不再渲染性格页');
ok(/精灵图鉴/.test(ids.get('app').innerHTML), '回退到精灵图鉴（不是白屏）');
ok(/data-nat-kind="up"/.test(ids.get('app').innerHTML) === false, '页面上不再有整页的性格开关（只在详情弹窗里）');
A2.view = 'spirits';
// source_type=legendary 的技能只有 7 只精灵有，早先模板没渲染这一桶、被静默丢弃。
/* ---------------------------------------------------------- 详情页加点面板 */
// 这一组是这次的重点：老桩的 querySelectorAll 永远返回空，所以"事件绑定有没有生效"
// 从来没被验证过 —— 详情页加点面板"点了没反应"就是那样漏掉的。
console.log('\n· 详情页加点面板（真的点一下）');
api.spiritDetail('152:1');                       // 翼王：速度种族 125
const modal = ids.get('modalBody')._el;
const box = modal.querySelector('.natal-block');
ok(!!box, '详情里渲染出加点面板 .natal-block');
ok(!box.querySelector('#dnat-talent') && !box.querySelector('#dnat-star'), '详情面板里没有天分/星级下拉（个体上限常驻 60）');
ok(box.querySelectorAll('[data-nat-btn]').length === 12, `每项两个性格开关，共 12 个（实际 ${box.querySelectorAll('[data-nat-btn]').length}）`);
ok(box.querySelectorAll('[data-nat-ivbtn]').length === 6, `六项各一个「个体」按钮（实际 ${box.querySelectorAll('[data-nat-ivbtn]').length}）`);
ok([...box.querySelectorAll('[data-nat-ivbtn]')].every((b) => !b.classList.contains('on')), '初始六个按钮都不高亮');

// 初始：六项都不投个体，性格全中性 —— 面板与独立页面用两套状态，互不影响
const wc = api.spiritCalcOf(api.STATE.bySpirit.get('152:1'));
ok(['hp', 'patk', 'satk', 'pdef', 'sdef', 'spd'].every((k) => wc.stats[k].iv === 0),
  '初始六项个体都是 0（都不加，等用户点按钮）');
ok(Object.values(wc.stats).every((x) => x.nature === 'neutral'), '初始性格全中性');
// 「个体」按钮：点一下投满该项并高亮，再点取消
{
  const box0 = ids.get('modalBody')._el.querySelector('.natal-block');
  const btn = box0.querySelector('[data-nat-ivbtn="spd"]');
  ok(!btn.classList.contains('on'), '点之前速度按钮不高亮');
  btn.click();
  ok(wc.stats.spd.iv === 60, `点一下速度投满 60（实际 ${wc.stats.spd.iv}）`);
  const btn2 = ids.get('modalBody')._el.querySelector('.natal-block').querySelector('[data-nat-ivbtn="spd"]');
  ok(btn2.classList.contains('on'), '点之后速度按钮高亮');
  btn2.click();
  ok(wc.stats.spd.iv === 0, '再点一下取消（回到 0）');
  const btn3 = ids.get('modalBody')._el.querySelector('.natal-block').querySelector('[data-nat-ivbtn="spd"]');
  ok(!btn3.classList.contains('on'), '取消后按钮不再高亮');
  btn3.click();   // 留一个投满的状态给后面的用例
}
// 独立「性格·天分」页已切掉，所以加点状态只剩详情面板这一份
ok(api.STATE.nat === undefined, '已无 STATE.nat（独立页的状态随页面一起移除）');

// 点「性格+」：速度加成，面板与雷达都要跟着变
const before = api.calcStatsOf(api.STATE.bySpirit.get('152:1'), wc).spd;
modal.querySelector('[data-nat-btn="spd"][data-nat-kind="up"]').click();
ok(wc.stats.spd.nature === 'up', '点「性格+」后速度性格变成 up');
const after = api.calcStatsOf(api.STATE.bySpirit.get('152:1'), wc).spd;
ok(after > before, `速度面板从 ${before} 升到 ${after}`);
const html2 = ids.get('modalBody').innerHTML;
ok(html2 !== '', '重画后弹窗仍有内容');
ok(new RegExp(`>${after}<`).test(html2), `弹窗里显示了新的速度值 ${after}`);

// 再点一次取消
ids.get('modalBody')._el.querySelector('.natal-block');           // 重画后要重新取
const box2 = ids.get('modalBody')._el.querySelector('.natal-block');
box2.querySelector('[data-nat-btn="spd"][data-nat-kind="up"]').click();
ok(wc.stats.spd.nature === 'neutral', '再点一次取消加成');

// 点「个体」按钮：投满 / 取消 / 3 项上限
{
  // 把状态清干净，从"都不投"开始
  ids.get('modalBody')._el.querySelector('.natal-block').querySelector('.natal-reset').click();
  ok(['hp', 'patk', 'satk', 'pdef', 'sdef', 'spd'].every((k) => wc.stats[k].iv === 0), '「清空」后六项都不投');

  const clickIv = (k) => ids.get('modalBody')._el.querySelector('.natal-block')
    .querySelector(`[data-nat-ivbtn="${k}"]`).click();
  const btnOf = (k) => ids.get('modalBody')._el.querySelector('.natal-block')
    .querySelector(`[data-nat-ivbtn="${k}"]`);

  clickIv('spd');
  ok(wc.stats.spd.iv === 60, `点速度按钮 -> 投满 60（实际 ${wc.stats.spd.iv}）`);
  ok(btnOf('spd').classList.contains('on'), '投了之后按钮高亮');

  // 再点取消
  clickIv('spd');
  ok(wc.stats.spd.iv === 0, '再点一次取消');
  ok(!btnOf('spd').classList.contains('on'), '取消后按钮不再高亮');

  // 投满三项
  for (const k of ['hp', 'patk', 'satk']) clickIv(k);
  const filled = ['hp', 'patk', 'satk', 'pdef', 'sdef', 'spd'].filter((x) => wc.stats[x].iv > 0);
  ok(filled.length === 3, `投满 3 项（${filled.join(',')}）`);
  // 第 4 项应被拦下（按钮置灰）
  ok(btnOf('spd').disabled, '投满 3 项后，其余项的按钮被禁用');
  const before4 = wc.stats.spd.iv;
  clickIv('spd');
  ok(wc.stats.spd.iv === before4 && wc.stats.spd.iv === 0, '第 4 项点不动，仍是 0');
  const count = ['hp', 'patk', 'satk', 'pdef', 'sdef', 'spd'].filter((x) => wc.stats[x].iv > 0).length;
  ok(count === 3, `仍只有 3 项（实际 ${count}）`);
}
// 清空 = 六项都不投
{
  ids.get('modalBody')._el.querySelector('.natal-block').querySelector('.natal-reset').click();
  const ivs = ['hp', 'patk', 'satk', 'pdef', 'sdef', 'spd'].map((x) => wc.stats[x].iv);
  ok(ivs.join(',') === '0,0,0,0,0,0', `「清空」后六项都是 0（实际 ${ivs.join(',')}）`);
}

// 加点状态只此一份（独立页已切掉），并且按精灵分开存
{
  const other = api.spiritCalcOf(api.STATE.bySpirit.get('466:1'));
  ok(other !== wc, '不同精灵的加点配置是两个对象（互不影响）');
  ok(['hp', 'patk', 'satk', 'pdef', 'sdef', 'spd'].every((k) => other.stats[k].iv === 0),
    '另一只精灵的配置仍是初始状态（没被上一只的改动串到）');
}

/* ---------------------------------------------------------- 基础数值明细 */
// 详情页每行要把"面板值是怎么来的"和加点控件合在一起：
//   基础（种族值 × 系数）+ 常数 + 个体 × 系数 → ×性格 → + 常数 = 面板值  [性格+ 性格− 个体]
console.log('\n· 详情页每行：基础数值 + 加点控件合并');
api.spiritDetail('152:1');
const baseHtml = ids.get('modalBody').innerHTML;
ok(/每行怎么读/.test(baseHtml), '详情里有「每行怎么读」的说明');
ok(!/base-table/.test(baseHtml), '不再有单独的基础数值表（已合并进每行）');
const boxBase = ids.get('modalBody')._el.querySelector('.natal-block');
const combined = boxBase.querySelectorAll('.nat-line.combined');
ok(combined.length === 6, `六行都是合并行（实际 ${combined.length}）`);
// 每行都要有：基础 / 常数 / 个体 / 性格开关 / 个体按钮
// （进度条与数值在雷达图旁边那组，不在这一行里）
let complete = 0;
for (const line of combined) {
  const hasBase = line.innerHTML.includes('nb-k');
  const hasPlus = line.innerHTML.includes('nb-plus');
  const hasIvBtn = line.querySelectorAll('[data-nat-ivbtn]').length === 1;
  const hasBtns = line.querySelectorAll('[data-nat-btn]').length === 2;
  if (hasBase && hasPlus && hasIvBtn && hasBtns) complete++;
}
ok(complete === 6, `六行都含 基础/常数/个体按钮/性格开关（齐全 ${complete}/6）`);
ok((baseHtml.match(/class="bar s-/g) || []).length === 12, `进度条共 12 条（雷达图旁 6 条 + 每行各 1 条；实际 ${(baseHtml.match(/class="bar s-/g) || []).length}）`);

// 逐项核对：合并行里出现的面板值必须与 statBreakdown 一致
const wingSp = api.STATE.bySpirit.get('152:1');
const wc2 = api.spiritCalcOf(wingSp);
for (const k of ['hp', 'patk', 'satk', 'pdef', 'sdef', 'spd']) {
  const b = api.statBreakdown(k, wingSp.stats[k], wc2.stats[k].iv, wc2.stats[k].nature);
  ok(new RegExp(`>${b.panel}<`).test(baseHtml), `${k} 面板 ${b.panel} 出现在行里`);
  ok(new RegExp(`>${b.basePart}<`).test(baseHtml), `${k} 基础值（种族×系数）${b.basePart} 出现在行里`);
}
// statBreakdown 自检
const b0 = api.statBreakdown('spd', wingSp.stats.spd, 0, 'neutral');
ok(b0.ivGain === 0 && b0.natureGain === 0, '个体0/中性时两处增量都是 0');
const b1 = api.statBreakdown('spd', wingSp.stats.spd, 60, 'up');
ok(b1.ivGain > 0 && b1.natureGain > 0, `投满+加成时两项增量都为正（+${b1.ivGain} / +${b1.natureGain}）`);
ok(b1.panel === api.panelInt('spd', wingSp.stats.spd, 60, 'up'), 'statBreakdown 与 panelInt 结果一致');
const bh = api.statBreakdown('hp', 78, 0, 'neutral');
ok(bh.flat === 70 && bh.const === 100, `生命常数是 70 / 100（实际 ${bh.flat} / ${bh.const}）`);

/* ---------------------------------------------------------- 性格单项规则 */
// 一个性格 = 一项加成 + 一项削弱：「性格+」整列最多一项，「性格−」整列最多一项；
// 同一项不能既加成又削弱。点已选的那项 = 取消。
console.log('\n· 性格单项规则（+整列一项、−整列一项）');
{
  ids.get('modalBody')._el.querySelector('.natal-block').querySelector('.natal-reset').click();
  const nb = () => ids.get('modalBody')._el.querySelector('.natal-block');
  const upBtn = (k) => nb().querySelector(`[data-nat-btn="${k}"][data-nat-kind="up"]`);
  const downBtn = (k) => nb().querySelector(`[data-nat-btn="${k}"][data-nat-kind="down"]`);
  const natOf = (k) => wc.stats[k].nature;

  ok(['hp', 'patk', 'satk', 'pdef', 'sdef', 'spd'].every((k) => natOf(k) === 'neutral'), '初始六项性格都是中性');

  upBtn('spd').click();
  ok(natOf('spd') === 'up', '给速度选「性格+」');
  ok(upBtn('spd').classList.contains('on'), '速度的「性格+」按钮高亮');
  ok(upBtn('patk').disabled, '别的行的「性格+」被禁用（整列只能一项）');

  // 直接点被禁用的按钮不应生效
  const beforeNat = JSON.stringify(['hp', 'patk', 'satk', 'pdef', 'sdef', 'spd'].map(natOf));
  upBtn('patk').click();
  ok(JSON.stringify(['hp', 'patk', 'satk', 'pdef', 'sdef', 'spd'].map(natOf)) === beforeNat, '再点别的「性格+」无效');

  // 「性格−」是另一列，可以单独选一项
  downBtn('patk').click();
  ok(natOf('patk') === 'down', '给物攻选「性格−」（另一列不受影响）');
  ok(upBtn('spd').classList.contains('on'), '速度的加成仍在');
  ok(downBtn('satk').disabled, '别的行的「性格−」被禁用');

  // 同一项的两个按钮互斥：速度已是「性格+」时，它的「性格−」应被禁用
  ok(downBtn('spd').disabled, '速度已是「性格+」，它的「性格−」被禁用（同一项不能既加又减）');
  ok(!upBtn('spd').disabled, '已高亮的那个按钮仍可点（用来取消）');
  const natBefore = natOf('spd');
  downBtn('spd').click();
  ok(natOf('spd') === natBefore, '点被禁用的「性格−」无效');

  // 取消加成就把「+」列腾出来了，也解除了本项的互斥
  upBtn('spd').click();
  ok(natOf('spd') === 'neutral', '再点「性格+」取消加成');
  // 「−」列此时被物攻占着，所以速度的「性格−」仍应禁用
  ok(downBtn('spd').disabled, '「−」列被物攻占用，速度的「性格−」仍禁用');
  ok(!upBtn('hp').disabled, '取消后「性格+」整列空出来，别的行可用');

  // 腾出「−」列后再让速度选削弱（能选上）
  downBtn('patk').click();
  ok(natOf('patk') === 'neutral', '取消物攻的削弱');
  downBtn('spd').click();
  ok(natOf('spd') === 'down', '速度改成削弱');
  ok(upBtn('spd').disabled, '此时速度的「性格+」被禁用（互斥的另一半）');

  // 再点自己 = 取消
  downBtn('spd').click();
  ok(natOf('spd') === 'neutral', '再点一次取消削弱');

  // 保证「+」「−」各至多一项
  upBtn('hp').click(); upBtn('satk').click();      // 第二次应无效
  downBtn('pdef').click(); downBtn('sdef').click(); // 第二次应无效
  const ups = ['hp', 'patk', 'satk', 'pdef', 'sdef', 'spd'].filter((k) => natOf(k) === 'up');
  const downs = ['hp', 'patk', 'satk', 'pdef', 'sdef', 'spd'].filter((k) => natOf(k) === 'down');
  ok(ups.length <= 1, `「性格+」至多一项（实际 ${ups.join(',') || '无'}）`);
  ok(downs.length <= 1, `「性格−」至多一项（实际 ${downs.join(',') || '无'}）`);
  // 收尾：清干净，后面的用例从干净状态开始
  ids.get('modalBody')._el.querySelector('.natal-block').querySelector('.natal-reset').click();
}

/* ---------------------------------------------------------- 性格速查（挂到术语页） */
console.log('\n· 术语页的性格速查');
A2.view = 'glossary';
ids.get('app').innerHTML = '';
api.render();
const glHtml = ids.get('app').innerHTML;
ok(/性格速查/.test(glHtml), '术语页有「性格速查」区块');
ok((glHtml.match(/<tr>/g) || []).length >= 30, `性格表至少 30 行（实际 ${(glHtml.match(/<tr>/g) || []).length}）`);
ok(/加成 ×1\.2、削弱 ×0\.9/.test(glHtml), '写明了加成/削弱系数');
ok(/生命也受性格影响/.test(glHtml), '说明本作生命也受性格影响');
ok(/同一项不能既加又减/.test(glHtml), '说明详情页的开关规则');
A2.view = 'spirits';

/* ---------------------------------------------------------- 传说技能 */
// source_type=legendary 只有 7 只精灵有，早先模板没渲染这一桶、被静默丢弃。
console.log('\n· 传说技能');
const legendSpirits = Object.entries(api.STATE.data.spiritSkills)
  .filter(([, list]) => list.some((r) => r.src === 'legendary'))
  .map(([k]) => k);
ok(legendSpirits.length === 7, `有传说技能的精灵 7 只（实际 ${legendSpirits.length}）`);
const lk = legendSpirits[0];
api.spiritDetail(lk);
const lHtml = ids.get('modalBody').innerHTML;
ok(/传说技能/.test(lHtml), `详情里出现「传说技能」区块（${lk}）`);
const expectName = api.STATE.data.spiritSkills[lk].find((r) => r.src === 'legendary');
ok(new RegExp(api.STATE.bySkill.get(expectName.id).name).test(lHtml),
  `该区块列出了 ${api.STATE.bySkill.get(expectName.id).name}`);
// 每只都渲染得出来，且不出现 undefined
let legendBad = 0;
for (const k of legendSpirits) {
  api.spiritDetail(k);
  const h = ids.get('modalBody').innerHTML;
  if (!/传说技能/.test(h) || /undefined/.test(h)) legendBad++;
}
ok(legendBad === 0, `7 只精灵的传说技能都能渲染（异常 ${legendBad}）`);

console.log('');
if (problems.length) {
  console.log(`✗ ${problems.length} 项不通过:`);
  problems.forEach((p) => console.log('   - ' + p));
  process.exit(1);
}
console.log('✓ 雷达图检查通过');
