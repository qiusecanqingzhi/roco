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
// 双系别相乘
ok(api.typeEffect(tid('火系'), [tid('草系'), tid('水系')]) === 1, '打「草+水」双系：×2 × ×0.5 = ×1');

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
ok(/142\.5/.test(calcHtml), '页面摊开了①有效威力 142.5');
ok(/356/.test(calcHtml), '页面摊开了②显示威力 356');
ok(/332/.test(calcHtml), '页面摊开了④预计伤害 332');
ok(/0\.9024/.test(calcHtml), '页面显示等级系数 0.9024');
ok(/需要/.test(calcHtml) && /下/.test(calcHtml), '给出「需要几下」');
ok(/data-calc="level"/.test(calcHtml), '等级可调');
ok(/data-calc="flatAdd"/.test(calcHtml), '固定加威力可调');
ok(/data-calc="skillPct"/.test(calcHtml), '本次技能威力%可调');
ok(/data-calc="atkStage"/.test(calcHtml) && /data-calc="defStage"/.test(calcHtml), '攻防等级可调');
ok((calcHtml.match(/data-calc="skill"/g) || []).length === 2, '两侧各有一个技能选择框');
// 伤害排序表
ok(/伤害最高的技能/.test(calcHtml), '有「伤害最高的技能」排序表');
const rankRows = (calcHtml.match(/data-calc-pick="/g) || []).length;
ok(rankRows > 0, `排序表有 ${rankRows} 行`);
// 排序必须是降序
const rankDmg = [...calcHtml.matchAll(/data-calc-pick="\d+"[\s\S]*?<td class="num"><b>(\d+)<\/b>/g)].map((m) => Number(m[1]));
ok(rankDmg.length > 1 && rankDmg.every((v, i) => i === 0 || rankDmg[i - 1] >= v),
  `排序表按伤害降序（${rankDmg.slice(0, 5).join(' ≥ ')} …）`);
// 岚鸟用扇风打奇丽花：排序表走的是基础参数（无全局加成），所以是 327；加上默认的
// +20 固定威力 / +50% 后就是参考页的 332（上面已断言）
ok(rankDmg[0] >= 327, `最高伤害 ≥ 327（实际 ${rankDmg[0]}）`);

/* ---------------------------------------------------------- 性格 · 天分 */
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
// 星级/天分 -> 个体
ok(api.ivOf(10, 5) === 60, `天分10 5★ -> 个体 60（实际 ${api.ivOf(10, 5)}）`);
ok(api.ivOf(10, 1) === 12, `天分10 1★ -> 个体 12（实际 ${api.ivOf(10, 1)}）`);
ok(api.ivOf(0, 5) === 0, '天分0 -> 个体 0');
// 套用性格
api.applyNature('胆小');
ok(A2.nat.stats.spd.nature === 'up' && A2.nat.stats.patk.nature === 'down', '套用「胆小」-> 速度加成、物攻削弱');
ok(A2.nat.stats.satk.nature === 'neutral', '未被该性格涉及的项保持中性');

// 天分档位由个体推断
ok(api.talentOf(10).label === '了不起的天分', `个体 10 -> 了不起的天分（实际 ${api.talentOf(10).label}）`);
ok(api.talentOf(0).rank < api.talentOf(10).rank, '低个体档位低于满个体');

// 页面渲染（新结构：六项各自 { iv, nature }）
A2.nat = api.defaultNat('152:1');
A2.view = 'nature';
ids.get('app').innerHTML = '';
api.render();
const natHtml = ids.get('app').innerHTML;
ok(/天分 · 资质 · 性格/.test(natHtml), '渲染出性格页');
ok(/个体值/.test(natHtml), '显示个体值');
ok(/速度/.test(natHtml) && /物攻/.test(natHtml), '六维都有行');
ok(/267/.test(natHtml), '算出翼王速度 267（与游戏实测一致）');
ok((natHtml.match(/data-nat-btn="/g) || []).length === 12, `每项两个性格开关，共 12 个（实际 ${(natHtml.match(/data-nat-btn="/g) || []).length}）`);
ok((natHtml.match(/data-nat-iv="/g) || []).length === 6, `六项各一个个体输入（实际 ${(natHtml.match(/data-nat-iv="/g) || []).length}）—— 这是独立「性格·天分」页，仍用输入框`);
ok((natHtml.match(/data-nat-apply="/g) || []).length === 30, `性格套用表 30 行（实际 ${(natHtml.match(/data-nat-apply="/g) || []).length}）`);
ok(/data-nat-kind="up"/.test(natHtml) && /data-nat-kind="down"/.test(natHtml), '同时有"性格+"与"性格-"开关');

// 无性格时不修正
A2.nat = api.defaultNat('152:1');
for (const k of ['hp', 'patk', 'satk', 'pdef', 'sdef', 'spd']) A2.nat.stats[k].nature = 'neutral';
api.render();
const neutralHtml = ids.get('app').innerHTML;
ok(/无加成/.test(neutralHtml), '全中性时提示「无加成」');
ok(/231/.test(neutralHtml), '翼王速度中性与加成分开显示（中性 231）');
// source_type=legendary 的技能只有 7 只精灵有，早先模板没渲染这一桶、被静默丢弃。
/* ---------------------------------------------------------- 详情页加点面板 */
// 这一组是这次的重点：老桩的 querySelectorAll 永远返回空，所以"事件绑定有没有生效"
// 从来没被验证过 —— 详情页加点面板"点了没反应"就是那样漏掉的。
console.log('\n· 详情页加点面板（真的点一下）');
api.spiritDetail('152:1');                       // 翼王：速度种族 125
const modal = ids.get('modalBody')._el;
const box = modal.querySelector('#natalBlock');
ok(!!box, '详情里渲染出加点面板 #natalBlock');
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
  const box0 = ids.get('modalBody')._el.querySelector('#natalBlock');
  const btn = box0.querySelector('[data-nat-ivbtn="spd"]');
  ok(!btn.classList.contains('on'), '点之前速度按钮不高亮');
  btn.click();
  ok(wc.stats.spd.iv === 60, `点一下速度投满 60（实际 ${wc.stats.spd.iv}）`);
  const btn2 = ids.get('modalBody')._el.querySelector('#natalBlock').querySelector('[data-nat-ivbtn="spd"]');
  ok(btn2.classList.contains('on'), '点之后速度按钮高亮');
  btn2.click();
  ok(wc.stats.spd.iv === 0, '再点一下取消（回到 0）');
  const btn3 = ids.get('modalBody')._el.querySelector('#natalBlock').querySelector('[data-nat-ivbtn="spd"]');
  ok(!btn3.classList.contains('on'), '取消后按钮不再高亮');
  btn3.click();   // 留一个投满的状态给后面的用例
}
// 隔离性：先把独立页面的状态记下来，改完详情面板后它必须原样不变
const natSnapshot = JSON.stringify(api.STATE.nat.stats);
ok(JSON.stringify(api.STATE.nat.stats) === natSnapshot, '独立「性格·天分」页状态此刻有一份快照');

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
ids.get('modalBody')._el.querySelector('#natalBlock');           // 重画后要重新取
const box2 = ids.get('modalBody')._el.querySelector('#natalBlock');
box2.querySelector('[data-nat-btn="spd"][data-nat-kind="up"]').click();
ok(wc.stats.spd.nature === 'neutral', '再点一次取消加成');

// 点「个体」按钮：投满 / 取消 / 3 项上限
{
  // 把状态清干净，从"都不投"开始
  ids.get('modalBody')._el.querySelector('#natalBlock').querySelector('#dnat-reset').click();
  ok(['hp', 'patk', 'satk', 'pdef', 'sdef', 'spd'].every((k) => wc.stats[k].iv === 0), '「清空」后六项都不投');

  const clickIv = (k) => ids.get('modalBody')._el.querySelector('#natalBlock')
    .querySelector(`[data-nat-ivbtn="${k}"]`).click();
  const btnOf = (k) => ids.get('modalBody')._el.querySelector('#natalBlock')
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
  ids.get('modalBody')._el.querySelector('#natalBlock').querySelector('#dnat-reset').click();
  const ivs = ['hp', 'patk', 'satk', 'pdef', 'sdef', 'spd'].map((x) => wc.stats[x].iv);
  ok(ivs.join(',') === '0,0,0,0,0,0', `「清空」后六项都是 0（实际 ${ivs.join(',')}）`);
}

// 隔离性：以上所有操作都改的是"详情面板"的状态，独立页面那份必须没被动过
ok(JSON.stringify(api.STATE.nat.stats) === natSnapshot,
  '详情面板的改动没有串到「性格 · 天分」页面（两套状态隔离）');
ok(api.STATE.nat !== wc, '两个状态对象不是同一个引用');

/* ---------------------------------------------------------- 基础数值明细 */
// 详情页每行要把"面板值是怎么来的"和加点控件合在一起：
//   基础（种族值 × 系数）+ 常数 + 个体 × 系数 → ×性格 → + 常数 = 面板值  [性格+ 性格− 个体]
console.log('\n· 详情页每行：基础数值 + 加点控件合并');
api.spiritDetail('152:1');
const baseHtml = ids.get('modalBody').innerHTML;
ok(/每行怎么读/.test(baseHtml), '详情里有「每行怎么读」的说明');
ok(!/base-table/.test(baseHtml), '不再有单独的基础数值表（已合并进每行）');
const boxBase = ids.get('modalBody')._el.querySelector('#natalBlock');
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
  ids.get('modalBody')._el.querySelector('#natalBlock').querySelector('#dnat-reset').click();
  const nb = () => ids.get('modalBody')._el.querySelector('#natalBlock');
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
  ids.get('modalBody')._el.querySelector('#natalBlock').querySelector('#dnat-reset').click();
}

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
