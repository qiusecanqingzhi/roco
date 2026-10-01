/* ============================================================
   洛克王国：世界 图鉴浏览器
   ------------------------------------------------------------
   数据来源：同目录 data-bundle.js（单文件包，file:// 直接可用）
             或 data/*.json（部署到静态托管时更省流量）
   无任何第三方依赖，纯原生 DOM
   ============================================================ */
'use strict';

/* ---------------------------------------------------------- 常量
   六维顺序【按原站】来：从正上方顺时针为
     生命 → 魔攻 → 魔防 → 速度 → 物防 → 物攻
   （原站用 spirit_stats_mini_label--top / upper_right / lower_right /
     bottom / lower_left / upper_left 这套类名，顺序就是这么排的。）
   键名直接用上游的短名（satk/sdef/spd/pdef/patk），这样查 stat_icons 时
   可以用 stat + '_attack'/'_defense' 直接对上，不必再维护一张映射表。
   ------------------------------------------------------------------ */
const STAT_KEYS = [
  { stat: 'hp', label: '生命' },
  { stat: 'satk', label: '魔攻' },
  { stat: 'sdef', label: '魔防' },
  { stat: 'spd', label: '速度' },
  { stat: 'pdef', label: '物防' },
  { stat: 'patk', label: '物攻' },
];
/** 内部统计键 -> stat_icons 表里的键 */
const ICON_KEY = { hp: 'hp', patk: 'physical_attack', satk: 'special_attack', pdef: 'physical_defense', sdef: 'special_defense', spd: 'speed' };
/**
 * 面板值的参考上限，用于进度条与雷达图的缩放（两者必须共用同一套，否则形状对不上）。
 * 取值依据是全库 621 只精灵在「个体 0 / 中性」下的实际分布（约 95% 分位）：
 *   生命 224~663（中位 328）、物攻 66~280、魔攻 69~271、
 *   物防 90~261、魔防 90~261、速度 89~220
 * 早先写死成 hp:200 / 其他:180，而生命中位数就有 328，于是
 *   所有条子都是满的、雷达被压平（踩过：用户反馈"有点不美观"）。
 */
const STAT_MAX = { hp: 450, patk: 250, satk: 250, pdef: 250, sdef: 250, spd: 250 };
const SRC_LABEL = { level: '升级学会', machine: '技能石', blood: '血脉', passive: '被动', legendary: '传说' };
const GROUP_LABEL = { level_up: '升级学会', spirit_stone: '技能石', bloodline_elixir: '血脉' };
// 官方 effect_values：counter=1（克制 ×2）、neutral=0（普通 ×1）、resisted=-1（抵抗 ×0.5）
const EFFECT_LABEL = { 2: '双重克制', 1: '克制', 0: '普通', '-1': '抵抗', '-2': '双重抵抗' };

/* ---------------------------------------------------------- 工具 */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const imgTag = (local, online, alt, cls = '') =>
  `<img loading="lazy" ${cls ? `class="${cls}" ` : ''}src="${esc(local || online || '')}" data-fallback="${esc(online || '')}" alt="${esc(alt)}">`;

// 本地图片缺失时回退到在线地址，再失败就隐藏，避免出现碎图
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  const fb = img.dataset.fallback;
  if (fb && img.src !== fb) { img.src = fb; return; }
  img.style.visibility = 'hidden';
}, true);

function toast(msg, ms = 1800) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------------------------------------------------------- 数据 */
const STATE = {
  data: null,
  bySpirit: new Map(),   // "id:formId" -> spirit
  bySkill: new Map(),
  typeById: new Map(),
  glossaryById: new Map(),
  statIconByStat: new Map(),
  skillIconById: new Map(),
  typeByName: new Map(),
  effect: new Map(),
  // 伤害计算的输入状态（两侧各一份加点配置，见 spiritCalcOf 的 STATE.calcSide）
  calc: {
    a: '20:1', b: '43:1',
    skillA: 7150060, skillB: null,
    // 四技能槽（参考图那一栏）：每侧四个位置，空位为 null。
    // 与 skillA/skillB 是两套东西 —— 后者是"这一次出哪一招"（单技能计算），
    // 这里是一整套配置，用来算各招的伤害占比。点击会互相带入。
    loadA: [null, null, null, null],
    loadB: [null, null, null, null],
    // 每招的覆盖值：威力（null=用技能本身的基础威力）、连击（默认 1）
    powA: [null, null, null, null], powB: [null, null, null, null],
    hitA: [1, 1, 1, 1], hitB: [1, 1, 1, 1],
    // 四技能槽是否已经"自动填过一次"（每侧一个）。
    // 只在第一次渲染时按伤害自动填；用户手动删空后不会又被填回来。
    // 换精灵时把对应那一侧重置为 false，让它对新精灵重新自动填。
    loInitA: false, loInitB: false,
    // 状态面板：每侧选中的状态 key、可调攻击因子、血量百分比、星陨层数。
    // 攻击因子会真正进入伤害计算（见 calcDamage 的 mods 参数）。
    statusA: { picks: [], star: 0, layers: {} }, statusB: { picks: [], star: 0, layers: {} },
    // 每种状态的伤害百分比（可改）；不填就用 STATUS_EFFECTS 里的默认值
    statusPctA: {}, statusPctB: {},
    // 攻击因子：攻方四项（物攻/魔攻/速度/技能威力）与守方两项（物防/魔防）
    // 会真正进入伤害计算，见 calcDamage 的 mods 与 defMods
    modsA: { patkPct: 0, satkPct: 0, pdefPct: 0, sdefPct: 0, spdAdd: 0, powerPct: 0, powerAdd: 0, finalPct: 100 },
    modsB: { patkPct: 0, satkPct: 0, pdefPct: 0, sdefPct: 0, spdAdd: 0, powerPct: 0, powerAdd: 0, finalPct: 100 },
    hpPctA: 100, hpPctB: 100,
    // 精灵选择下拉：哪一侧展开着、各自的搜索词
    spOpen: null, spQuery: { a: '', b: '' },
    level: 60,
    // 与官方说明页算例同参数：(75 + 20) × (1 + 50%) = 142.5 -> 显示威力 356 -> 伤害 332
    flatAdd: 20, skillPct: 0.5, atkStage: 0, defStage: 0,
    powerMul: 1, finalMul: 1, sortByDamage: true,
    // 两侧各自的加点配置：Map<"id:form", {stats:{k:{iv,nature}}}>，与详情页那份独立
    cfgA: new Map(), cfgB: new Map(),
  },
  calcSide: null,       // null=详情弹窗 / 'a'|'b'=伤害计算左右两侧
  view: 'spirits',
  filters: {
    spirits: { q: '', types: new Set(), sort: 'id', dir: 1, forms: false },
    skills: { q: '', types: new Set(), cats: new Set(), sort: 'id', dir: 1, minDmg: '', maxEnergy: '' },
  },
  searchSel: -1,
  searchItems: [],
};

async function loadData() {
  if (window.ROCO_DATA) return window.ROCO_DATA;
  // 没有单文件包时（例如托管环境只上传了 data/），退回逐文件 fetch。
  // 注意：这里新增导出文件时必须同步加进来，否则托管环境下那块数据是空的
  // （踩过：spirit-bloodlines.json 忘了加，导致线上血脉区块空白、本地 bundle 正常）。
  const names = ['meta', 'spirits', 'skills', 'matchups', 'glossary',
    'spirit-skills', 'skill-learners', 'spirit-bloodlines'];
  const loaded = await Promise.all(names.map((n) => fetch(`data/${n}.json`).then((r) => {
    if (!r.ok) throw new Error(`${n}.json HTTP ${r.status}`);
    return r.json();
  })));
  const [meta, spirits, skills, matchups, glossary, spiritSkills, skillLearners, spiritBloodlines] = loaded;
  return { meta, spirits, skills, matchups, glossary, spiritSkills, skillLearners, spiritBloodlines };
}

function index(data) {
  STATE.data = data;
  for (const s of data.spirits) STATE.bySpirit.set(`${s.id}:${s.formId}`, s);
  for (const s of data.skills) STATE.bySkill.set(s.id, s);
  for (const t of data.meta.types) STATE.typeById.set(t.id, t);
  STATE.glossaryById = new Map((data.glossary ?? []).map((g) => [g.id, g]));
  // 状态与印记（由 tools/build-status-data.mjs 从本项目的术语库生成）
  STATE.statuses = data.statuses ?? [];
  STATE.statusByKey = new Map(STATE.statuses.map((s) => [s.key, s]));
  STATE.statIconByStat = new Map((data.meta.statIcons ?? []).map((x) => [x.stat, x]));
  STATE.skillIconById = new Map(data.meta.skillIcons ?? []);
  // 伤害计算用：系别名 -> 系别，以及 "攻:防" -> 克制级别
  // （matchups 是 [attacking_type_id, defending_type_id, effect] 三元组）
  STATE.typeByName = new Map(data.meta.types.map((t) => [t.name, t]));
  STATE.effect = new Map((data.matchups ?? []).map(([a, d, e]) => [`${a}:${d}`, e]));
}

/* ============================================================
   详情页里的加点面板
   ------------------------------------------------------------
   每个精灵的加点配置存在 STATE.spiritCalc（Map，按 "id:form" 分开）。
   雷达图与数值条都按当前配置实时重算，改一下就能看到形状变化。
   ============================================================ */
/**
 * 每只精灵独立的加点配置。
 * 个体上限固定 60：面板值已经把基础数值含进去了，再选天分/星级会让人
 * 误以为"星级影响面板"，所以只保留个体投入与性格开关。
 * 个体【初始都不加，点按钮一项一项地投】：每行有一个「个体」按钮，
 * 点一下把该项投满 60 并高亮，再点取消 —— 和游戏里那个亮/暗的按钮一致。
 * 最多 3 项是游戏规则，工具要挡住，否则会算出游戏里不存在的面板。
 */
/**
 * 取某只精灵的加点配置对象（活的引用，改它即生效）。
 *
 * 配置源由 STATE.calcSide 决定：
 *   null / undefined -> 详情弹窗那份（STATE.spiritCalc）
 *   'a' / 'b'        -> 伤害计算左右两侧各自的份（STATE.calc.cfgA / cfgB）
 * 这样详情页与伤害计算共用同一套渲染与绑定代码，但状态完全独立
 * （用户在伤害计算里调加点，不会影响详情页里看到的那只精灵）。
 */
function spiritCalcOf(sp) {
  const key = `${sp.id}:${sp.formId}`;
  const side = STATE.calcSide ?? null;
  const slot = side ? (side === 'a' ? 'cfgA' : 'cfgB') : 'spiritCalc';
  if (side) STATE.calc[slot] ??= new Map();
  else STATE.spiritCalc ??= new Map();
  const map = side ? STATE.calc[slot] : STATE.spiritCalc;
  if (!map.has(key)) {
    const c = defaultNat(key);
    for (const k of STAT_ORDER) c.stats[k] = { iv: 0, nature: 'neutral' };
    map.set(key, c);
  }
  return map.get(key);
}

/** 当前配置下的六维实测值（用于雷达图与数值条）*/
function calcStatsOf(sp, c) {
  const out = {};
  for (const k of STAT_ORDER) out[k] = panelInt(k, sp.stats[k] ?? 0, c.stats[k].iv, c.stats[k].nature);
  return out;
}

/** 单项的完整拆解：种族值 → 个体贡献 → 性格系数 → 面板值
 *  面板 = round(种族值 × 系数 + 个体值 × 系数 + 常数) × 性格 + 常数 */
function statBreakdown(stat, baseStat, iv, nature) {
  const c = STAT_COEF[stat] ?? STAT_NORMAL_COEF;
  const coef = NATURE_MULT[nature] ?? 1;
  const inner = Math.round(baseStat * c.base + iv * c.iv + c.flat);
  const panel = Math.round(inner * coef + c.plus);
  const noIvInner = Math.round(baseStat * c.base + c.flat);
  const noIvPanel = Math.round(noIvInner * coef + c.plus);
  const neutralPanel = Math.round(inner + c.plus);
  return {
    baseStat, iv, nature, coef,
    basePart: Math.round(baseStat * c.base),     // 种族值贡献
    flat: c.flat,
    const: c.plus,
    ivGain: panel - noIvPanel,                   // 个体贡献了多少面板值
    natureGain: panel - neutralPanel,            // 性格带来多少（可为负）
    noIvPanel,                                   // 不投个体、但保留性格时的面板值
    neutralPanel,                                // 投了个体、但性格中性时的面板值
    inner, panel,
  };
}

/**
 * （已废弃，保留函数以便测试/其他调用）按种族值折算排序，返回最高三项的集合。
 * 详情页现在的规则是"初始都不加，点按钮逐项投满"，不再用它做默认值。
 */
function defaultInvestSet(sp) {
  const ranked = STAT_ORDER
    .map((k) => {
      const coef = STAT_COEF[k] ?? STAT_NORMAL_COEF;
      return { k, weight: (sp.stats[k] ?? 0) * coef.base };
    })
    .sort((a, b) => b.weight - a.weight);
  return new Set(ranked.slice(0, 3).map((x) => x.k));
}

/** 六维图标（复用 stat_icons，当 CSS mask 用）—— 详情面板每行都要用 */
function stateIcon(k) {
  const icon = STATE.statIconByStat.get(ICON_KEY[k] ?? k);
  if (!icon) return '';
  const url = esc(icon.icon || icon.iconOnline);
  return `<span class="natal-ic" style="-webkit-mask-image:url('${url}');mask-image:url('${url}')"></span>`;
}

/** 雷达图 + 数值条 + 加点控件（整体可重画）。
 *  配置源由 STATE.calcSide 决定（null=详情弹窗 / 'a'|'b'=伤害计算两侧） */
function natalBlock(sp, c) {
  const vals = calcStatsOf(sp, c);
  const cap = IV_MAX;
  // 「最多 3 项」是游戏规则，要保留 —— 否则会算出游戏里不存在的面板
  const invested = STAT_ORDER.filter((k) => c.stats[k].iv > 0).length;
  const canInvestMore = invested < 3;

  const bars = STAT_ORDER.map((k) => {
    const st = c.stats[k];
    const base = sp.stats[k] ?? 0;
    const b = statBreakdown(k, base, st.iv, st.nature);
    const denom = STAT_MAX[k] ?? 250;
    // 分段着色：不投个体时就有的一段（浅） + 个体加上去的一段（深）
    const baseW = Math.min(100, (b.noIvPanel / denom) * 100);
    const ivW = Math.min(100 - baseW, (Math.max(0, b.ivGain) / denom) * 100);
    const mark = st.nature === 'up' ? '<b class="nv-up">▲</b>' : st.nature === 'down' ? '<b class="nv-down">▼</b>' : '';
    return `<div class="stat">
      <span class="k">${STAT_LABEL6[k]}${mark}</span>
      <div class="bar s-${k}" title="${b.panel} / 参考上限 ${denom}">
        <i style="width:${baseW}%"></i>${ivW > 0 ? `<u style="width:${ivW}%"></u>` : ''}
      </div>
      <span class="v">${b.panel}</span>
    </div>`;
  }).join('');

  // 合并成一行：基础数值（种族值 × 系数 + 常数）+ 加点控件 + 面板值
  // 之前是"上面一组加点控件 + 下面一张基础数值表"，同一项信息出现两次；现在合成一行。
  const controls = STAT_ORDER.map((k) => {
    const st = c.stats[k];
    const b = statBreakdown(k, sp.stats[k] ?? 0, st.iv, st.nature);
    const canEdit = st.iv > 0 || canInvestMore;
    // 性格：一个性格 = 一项加成 + 一项削弱，三条规则：
    //   ① 「性格+」整列最多一项  ② 「性格−」整列最多一项
    //   ③ 同一项不能同时被加成和削弱（两个按钮互斥，各自的高亮会禁用另一个）
    const upUsedByOther = STAT_ORDER.some((x) => x !== k && c.stats[x].nature === 'up');
    const downUsedByOther = STAT_ORDER.some((x) => x !== k && c.stats[x].nature === 'down');
    const btn = (kind, label) => {
      const active = st.nature === kind;
      // 已高亮的那一个总是可点（用来取消）；
      // 否则：本列已被别的项占用 或 本项已被另一列占用 -> 禁用
      const blocked = !active && (
        (kind === 'up' ? upUsedByOther : downUsedByOther)
        || st.nature === (kind === 'up' ? 'down' : 'up')
      );
      return `<button type="button" class="nat-btn ${kind}${active ? ' on' : ''}"
        data-nat-btn="${k}" data-nat-kind="${kind}" ${blocked ? 'disabled' : ''}
        title="${active ? `取消 ${STAT_LABEL6[k]} 的${kind === 'up' ? '加成' : '削弱'}`
          : st.nature === (kind === 'up' ? 'down' : 'up')
            ? `${STAT_LABEL6[k]} 已经在${kind === 'up' ? '削弱' : '加成'}了，同一项不能既加又减`
            : (kind === 'up' ? upUsedByOther : downUsedByOther)
              ? `${kind === 'up' ? '加成' : '削弱'}已经给了别的属性，先取消那一项`
              : `给 ${STAT_LABEL6[k]} ${kind === 'up' ? `加成 ×${NATURE_MULT.up}` : `削弱 ×${NATURE_MULT.down}`}`}"
        >${label}</button>`;
    };
    const denom = STAT_MAX[k] ?? 250;
    const baseW = Math.min(100, (b.noIvPanel / denom) * 100);
    const ivW = Math.min(100 - baseW, (Math.max(0, b.ivGain) / denom) * 100);
    const mark = st.nature === 'up' ? '<b class="nv-up">▲</b>' : st.nature === 'down' ? '<b class="nv-down">▼</b>' : '';
    return `<div class="nat-line combined">
      <span class="nat-name"><span class="nat-ic-wrap">${stateIcon(k)}</span>${STAT_LABEL6[k]}${mark}</span>

      <span class="nb" title="种族值 ${b.baseStat} × 系数 ${STAT_COEF[k]?.base ?? STAT_NORMAL_COEF.base} = ${b.basePart}">
        <span class="nb-k">基础</span><b>${b.basePart}</b>
      </span>
      <span class="nb-plus">+</span>
      <span class="nb" title="公式里的常数（生命 70 / 其余 10）">
        <b>${b.flat}</b>
      </span>
      <span class="nb-plus">+</span>
      <span class="nb iv" title="个体值 ${st.iv} × 系数 ${STAT_COEF[k]?.iv ?? STAT_NORMAL_COEF.iv}${b.ivGain ? ' = 面板 +' + b.ivGain : ''}">
        <span class="nb-k">个体</span><b>${st.iv}</b>${b.ivGain ? `<i class="gain">+${b.ivGain}</i>` : ''}
      </span>
      ${st.nature !== 'neutral' ? `<span class="nb-nat ${st.nature === 'up' ? 'nv-up' : 'nv-down'}">×${b.coef}</span>` : ''}
      <span class="nb-const">+${b.const}</span>
      <span class="nb-plus">=</span>

      <span class="nat-val">${b.panel}</span>

      <span class="nat-ctl">
        ${btn('up', '性格+')}${btn('down', '性格−')}
        <button type="button" class="nat-ivbtn${st.iv > 0 ? ' on' : ''}" data-nat-ivbtn="${k}"
                ${st.iv > 0 || canInvestMore ? '' : 'disabled'}
                title="${st.iv > 0 ? `取消 ${STAT_LABEL6[k]} 的个体投入` : canInvestMore ? `点一下投满 ${STAT_LABEL6[k]}（个体 ${IV_MAX}）` : '最多只能投入 3 项，请先取消一项'}">
          个体${st.iv > 0 ? ` ${st.iv}` : ''}
        </button>
      </span>

      <span class="nat-barwrap">
        <span class="bar s-${k}" title="${b.panel} / 参考上限 ${denom}">
          <i style="width:${baseW}%"></i>${ivW > 0 ? `<u style="width:${ivW}%"></u>` : ''}
        </span>
      </span>
    </div>`;
  }).join('');

  // compact：伤害计算两侧用的紧凑版 —— 去掉雷达图与重复的数值条
  return `<div class="natal-block" data-natal-block="1" data-calc-spirit="${sp.id}:${sp.formId}">
    <div class="stat-wrap">
      ${radarChart(vals)}
      <div class="stat-bars">${bars}</div>
    </div>
    <div class="natal-toolbar">
      <span class="desc">个体上限 <b>${IV_MAX}</b>　最多投 <b>3 项</b>　已投 <b>${invested}/3</b></span>
      <span class="desc">点各项右侧的「个体」按钮投满 ${IV_MAX} 并高亮，再点取消</span>
      <button class="chip natal-reset">清空</button>
    </div>
    <div class="nat-lines">${controls}</div>

    <div class="natal-base">
      <div class="natal-base-head">
        <b>每行怎么读</b>
        <span class="desc">基础（种族值 × 系数）+ 常数 + 个体 × 系数 → ×性格 → + 常数 = 面板值</span>
      </div>
      <div class="desc" style="font-size:12px">
        生命用另一套系数：种族值 × 1.7 + 个体值 × 0.85 + 70，乘性格后 + 100；
        其余五项是 种族值 × 1.1 + 个体值 × 0.55 + 10，乘性格后 + 50。
        个体那个小绿字（如 <span class="gain">+40</span>）是它实际带来的面板增量 ——
        性格会把它一起放大或缩小，所以不等于 个体值 × 0.55。
      </div>
    </div>
  </div>`;
}

/* ============================================================
   展示辅助
   ============================================================ */
const typeName = (id) => STATE.typeById.get(id)?.name ?? '';
const typeShort = (id) => STATE.typeById.get(id)?.short ?? typeName(id);
const typeColor = (id) => STATE.typeById.get(id)?.color ?? '#7a8699';

/** 数字显示：整数不带小数点，小数最多两位 */
const fmt = (n) => (Number.isInteger(n) ? String(n) : Number(n.toFixed(2)).toString());

/** 威力显示：基础威力 + 可变标记
 *  damage 数组的 [0] 才是基础威力；[1..] 是附加状态/阈值/上限哨兵，
 *  所以不能对数组取 min/max（早先版本因此把 20580010 当成威力显示，已修）。 */
const powerCell = (s) => {
  const p = s.dmgMax ?? '';
  return `${p}${s.powerIsVariable ? ' <span class="pill" title="威力可变，基础威力 ' + p + '，实际随效果变化">可变</span>' : ''}`;
};

/** 技能图标（本地优先，回退在线）；索引是 [[id, path], …] 数组，构建时转 Map */
const skillIconOf = (id) => {
  const local = STATE.skillIconById.get(id);
  const sk = STATE.bySkill.get(id);
  return { local: local ?? sk?.img ?? null, online: sk?.imgOnline ?? null };
};
const skillIconTag = (id, cls = 'skill-icon') => {
  const { local, online } = skillIconOf(id);
  if (!local && !online) return '';
  return imgTag(local, online, '', cls);
};

/**
 * 系别徽章：原站用的是圆形图标（56×56 的圆形徽章图），比文字更直观。
 * 找不到图标时退回文字徽章，不会变成空白。
 */
function badge(id, ghost = false) {
  const t = STATE.typeById.get(id);
  if (!t) return '';
  if (t.icon || t.iconOnline) {
    const title = `${t.name}${t.immunities?.length ? `（免疫：${t.immunities.join('、')}）` : ''}`;
    return `<span class="tbadge-img" style="--tc:${t.color}" title="${esc(title)}">
      ${imgTag(t.icon, t.iconOnline, t.name, 'type-icon')}<span class="tbadge-txt">${esc(t.short || t.name)}</span></span>`;
  }
  return `<span class="tbadge${ghost ? ' ghost' : ''}" style="--tc:${t.color}">${esc(t.short || t.name)}</span>`;
}
const badges = (ids, ghost = false) => (ids ?? []).map((i) => badge(i, ghost)).join('');

const catPill = (cat) => (cat ? `<span class="pill cat-${esc(cat)}">${esc(cat)}</span>` : '');

/* ---------------------------------------------------- 富文本描述
   站点描述里带两类标记（实测只有这两种，其余按兜底处理）：
     <desc_id=1015>应对状态</>         术语链接 → 渲染成可点小标签，悬停看释义
     <span fork_road="or">或</>        分支连接词 → 渲染成普通强调文字
   兜底：任何无法识别的 <...>…</> 只保留中间的文字，不把标记原样露给用户。
   ------------------------------------------------------------------ */
function glossaryTag(html) {
  const out = [];
  const re = /<desc_id=(\d+)>([\s\S]*?)<\/>|<span\s+fork_road="([^"]*)">([\s\S]*?)<\/>|<[^<>]{1,80}>([\s\S]*?)<\/>/g;
  let last = 0, m;
  const push = (s) => out.push(esc(s));
  while ((m = re.exec(String(html ?? '')))) {
    push(String(html).slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) {                       // desc_id 术语链接
      const id = Number(m[1]);
      const g = STATE.glossaryById.get(id);
      if (g) out.push(`<span class="dterm linked" data-glossary="${id}" title="${esc(g.name)}：${esc(g.descPlain ?? g.desc)}">${esc(m[2])}</span>`);
      else out.push(`<span class="dterm">${esc(m[2])}</span>`);
    } else if (m[3] !== undefined) {                // fork_road 连接词
      out.push(`<span class="dfork">${esc(m[4])}</span>`);
    } else {                                        // 未知标记：只留文字
      out.push(esc(m[5] ?? ''));
    }
  }
  push(String(html ?? '').slice(last));
  return out.join('').replace(/\n/g, '<br>');
}

/** 纯文本描述（搜索/复制用）：站点原文去掉标记 */
const plainDesc = (s) => String(s ?? '')
  .replace(/<desc_id=\d+>/g, '')
  .replace(/<span\s+fork_road="[^"]*">/g, '')
  .replace(/<\/>/g, '')
  .replace(/<[^<>]{1,80}>/g, '');

// 精灵的技能：level 按解锁等级，machine 按名字；被动单列。
// 注意 source_type 实际有四种：level / machine / passive / legendary。
// legendary（传说技能）只有 7 只精灵有，之前模板没渲染这一桶，被静默丢了 —— 已补上。
// 另外 blood 不存在（血脉技能在 spirit_bloodlines，由 bloodlineSection() 渲染）。
// `bucket` 那行是兜底：万一上游以后新增 source_type，也不会丢数据。
function spiritSkillsOf(sp) {
  const raw = STATE.data.spiritSkills[`${sp.id}:${sp.formId}`] ?? [];
  const out = { level: [], machine: [], legendary: [], passive: [] };
  for (const r of raw) {
    const sk = STATE.bySkill.get(r.id);
    if (!sk) continue;
    const bucket = out[r.src] ?? (out[r.src] = []);
    bucket.push({ ...sk, lv: r.lv, ord: r.ord, src: r.src });
  }
  out.level.sort((a, b) => (a.lv ?? 999) - (b.lv ?? 999) || (a.name > b.name ? 1 : -1));
  out.machine.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  out.legendary.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  return out;
}

function learnersOf(skillId) {
  const raw = STATE.data.skillLearners[skillId] ?? [];
  return raw.map((r) => {
    const sp = STATE.bySpirit.get(`${r.id}:${r.formId}`);
    return { ...r, sp };
  });
}

/* ============================================================
   路由
   ============================================================ */
const VIEWS = ['spirits', 'skills', 'types', 'calc', 'glossary'];
function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'spirits';
  const name = VIEWS.includes(hash) ? hash : 'spirits';
  STATE.view = name;
  $$('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === name));
  render();
}
window.addEventListener('hashchange', route);

/* ============================================================
   视图：精灵图鉴
   ============================================================ */
function filterSpirits() {
  const f = STATE.filters.spirits;
  const q = f.q.trim().toLowerCase();
  let list = STATE.data.spirits.filter((s) => {
    if (!f.forms && s.formId !== 1) return false;                 // 默认只显示默认形态
    if (f.types.size && !s.types.some((t) => f.types.has(t))) return false;
    if (q) {
      const hay = `${s.id} ${s.name} ${s.form ?? ''} ${s.passive?.name ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const val = (s) => {
    switch (f.sort) {
      case 'bst': return s.bst;
      case 'spd': return s.stats.spd;
      case 'hp': return s.stats.hp;
      case 'patk': return s.stats.patk;
      case 'satk': return s.stats.satk;
      case 'pdef': return s.stats.pdef;
      case 'sdef': return s.stats.sdef;
      case 'skills': return s.skills;
      case 'name': return s.name;
      default: return s.id * 100 + s.formId;
    }
  };
  list = list.slice().sort((a, b) => {
    const x = val(a), y = val(b);
    if (typeof x === 'string') return x.localeCompare(y, 'zh') * f.dir;
    return (x - y) * f.dir;
  });
  return list;
}

function viewSpirits() {
  const f = STATE.filters.spirits;
  const list = filterSpirits();
  const typeChips = STATE.data.meta.types.map((t) => `
    <button class="chip${f.types.has(t.id) ? ' on' : ''}" data-type="${t.id}" style="--tc:${t.color}">
      <span class="dot"></span>${esc(t.short)}
    </button>`).join('');

  return `
  <div class="page-head">
    <h1>精灵图鉴</h1>
    <span class="sub">共 ${STATE.data.meta.counts.spirits} 条（含形态）· 当前筛选出 <b>${list.length}</b> 条</span>
  </div>
  <div class="panel filters">
    <div class="frow">
      <span class="label">搜索</span>
      <input type="search" id="spiritQ" placeholder="名称 / 编号 / 被动技能" value="${esc(f.q)}">
      <select id="spiritSort">
        ${[['id', '图鉴编号'], ['bst', '种族值总和'], ['spd', '速度'], ['hp', '生命'], ['patk', '物攻'],
           ['satk', '魔攻'], ['pdef', '物防'], ['sdef', '魔防'], ['skills', '技能数'], ['name', '名称']]
          .map(([v, l]) => `<option value="${v}"${f.sort === v ? ' selected' : ''}>按${l}</option>`).join('')}
      </select>
      <select id="spiritDir">
        <option value="1"${f.dir === 1 ? ' selected' : ''}>升序</option>
        <option value="-1"${f.dir === -1 ? ' selected' : ''}>降序</option>
      </select>
      <label class="chip${f.forms ? ' on' : ''}" style="--tc:var(--accent)">
        <input type="checkbox" id="showForms" ${f.forms ? 'checked' : ''} style="margin:0"> 显示其它形态
      </label>
      <span class="reset" id="resetSpirits">清除筛选</span>
    </div>
    <div class="frow"><span class="label">系别</span>${typeChips}</div>
  </div>
  ${list.length ? `<div class="grid">${list.map(spiritCard).join('')}</div>` : '<div class="empty">没有符合条件的精灵</div>'}`;
}

function spiritCard(s) {
  const types = s.types.map((t) => typeShort(t)).join(' ');
  return `
  <div class="card" data-spirit="${s.id}:${s.formId}">
    <span class="num">#${s.id}</span>
    ${s.form ? `<span class="form-tag">${esc(s.form)}</span>` : ''}
    <div class="pic">${imgTag(s.head, s.headOnline, s.name)}</div>
    <div class="name">${esc(s.name)}</div>
    <div class="trow">${badges(s.types)}</div>
    <div class="tstat">${esc(types)} · 种族值 ${s.bst}</div>
  </div>`;
}

/* ============================================================
   视图：技能库
   ============================================================ */
function filterSkills() {
  const f = STATE.filters.skills;
  const q = f.q.trim().toLowerCase();
  let list = STATE.data.skills.filter((s) => {
    if (f.types.size && !f.types.has(s.typeId)) return false;
    if (f.cats.size && !f.cats.has(s.cat)) return false;
    if (f.minDmg !== '' && (s.dmgMax ?? 0) < Number(f.minDmg)) return false;
    if (f.maxEnergy !== '' && (s.energy ?? 0) > Number(f.maxEnergy)) return false;
    // 用纯文本描述做匹配，否则带 <desc_id=…> 标记的描述搜不到词
    if (q && !(`${s.name} ${plainDesc(s.desc)} ${s.type ?? ''}`.toLowerCase().includes(q))) return false;
    return true;
  });
  const val = (s) => {
    switch (f.sort) {
      case 'dmg': return s.dmgMax ?? 0;
      case 'energy': return s.energy ?? 0;
      case 'uses': return s.uses ?? 0;
      case 'n': return s.n ?? 0;
      case 'name': return s.name;
      default: return s.id;
    }
  };
  return list.slice().sort((a, b) => {
    const x = val(a), y = val(b);
    if (typeof x === 'string') return x.localeCompare(y, 'zh') * f.dir;
    return (x - y) * f.dir || (a.id - b.id) * f.dir;
  });
}

function viewSkills() {
  const f = STATE.filters.skills;
  const list = filterSkills();
  const typeChips = STATE.data.meta.types.map((t) => `
    <button class="chip${f.types.has(t.id) ? ' on' : ''}" data-stype="${t.id}" style="--tc:${t.color}">
      <span class="dot"></span>${esc(t.short)}
    </button>`).join('');
  const catChips = ['物理', '魔法', '状态', '防御'].map((c) => `
    <button class="chip${f.cats.has(c) ? ' on' : ''}" data-cat="${c}">${c}</button>`).join('');
  const sortHead = (key, label, cls = '') => {
    const on = f.sort === key;
    return `<th class="sortable ${cls}" data-sort="${key}">${label}${on ? ` <span class="arrow">${f.dir === 1 ? '▲' : '▼'}</span>` : ''}</th>`;
  };

  return `
  <div class="page-head">
    <h1>技能库</h1>
    <span class="sub">共 ${STATE.data.meta.counts.skills} 个技能 · 当前筛选出 <b>${list.length}</b> 个</span>
  </div>
  <div class="panel filters">
    <div class="frow">
      <span class="label">搜索</span>
      <input type="search" id="skillQ" placeholder="技能名 / 描述关键词" value="${esc(f.q)}">
      <span class="label">分类</span>${catChips}
      <span class="label">威力≥</span>
      <input type="number" id="minDmg" value="${esc(f.minDmg)}" placeholder="0" style="width:74px">
      <span class="label">能耗≤</span>
      <input type="number" id="maxEnergy" value="${esc(f.maxEnergy)}" placeholder="∞" style="width:74px">
      <span class="reset" id="resetSkills">清除筛选</span>
    </div>
    <div class="frow"><span class="label">系别</span>${typeChips}</div>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th class="mid">图标</th>
        ${sortHead('name', '技能')}
        ${sortHead('dmg', '威力', 'num')}
        ${sortHead('energy', '能耗', 'num')}
        <th class="mid">分类</th>
        <th class="mid">系别</th>
        <th>效果</th>
        ${sortHead('n', '可学', 'num')}
      </tr></thead>
      <tbody>
      ${list.map((s) => `
        <tr class="clickable" data-skill="${s.id}">
          <td class="mid">${imgTag(s.img, s.imgOnline, s.name, 'skill-icon')}</td>
          <td class="skill-name">${esc(s.name)}</td>
          <td class="num">${powerCell(s)}</td>
          <td class="num">${s.energy ?? ''}</td>
          <td class="mid">${catPill(s.cat)}</td>
          <td class="mid">${s.typeId ? badge(s.typeId) : ''}</td>
          <td class="desc">${glossaryTag(s.desc)}</td>
          <td class="num">${s.n ?? ''}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
  ${list.length ? '' : '<div class="empty">没有符合条件的技能</div>'}`;
}

/* ============================================================
   视图：系别克制
   ============================================================ */
function viewTypes() {
  const { types, matchups } = STATE.data.meta.counts ? STATE.data.meta : STATE.data;
  const tlist = STATE.data.meta.types;
  const ef = new Map();
  for (const [a, d, e] of STATE.data.matchups) ef.set(`${a}:${d}`, e);

  // 格子显示：以官方 effect_values 为准（1=克制 ×2 / 0=普通 ×1 / -1=抵抗 ×0.5）
  const cellCls = (e) => ({ 1: 'mx2', 0: 'mx1', '-1': 'mxh', 2: 'mx4', '-2': 'mxq' }[String(e)] ?? 'mx1');
  const cellText = (e) => ({ 1: '×2', 0: '', '-1': '½', 2: '×4', '-2': '¼' }[String(e)] ?? '');

  // 矩阵里 18×18 格子很密，这里的系别只显示文字（加 icon-off 关掉图标），
  // 表头/行首允许显示图标
  const header = tlist.map((t) => `<th title="${esc(t.name)}">${badge(t.id)}</th>`).join('');
  const rows = tlist.map((atk) => `
    <tr>
      <th class="rowhead">${badge(atk.id)}</th>
      ${tlist.map((def) => {
        const e = ef.get(`${atk.id}:${def.id}`) ?? 0;
        return `<td class="${cellCls(e)}" title="${esc(atk.name)} → ${esc(def.name)}：${EFFECT_LABEL[String(e)] ?? e}">${cellText(e)}</td>`;
      }).join('')}
    </tr>`).join('');

  // 状态免疫（另一种机制，跟伤害倍率无关）
  const immun = tlist.filter((t) => t.immunities?.length).map((t) => `
    <tr><td class="mid">${badge(t.id)}</td><td>${t.immunities.map(esc).join('、')}</td></tr>`).join('');

  // 用真实数据算出「最怕打」和「最耐打」的系别，作为速查结论
  const tally = tlist.map((def) => ({
    t: def,
    weak: tlist.filter((atk) => ef.get(`${atk.id}:${def.id}`) === 1).length,
    resist: tlist.filter((atk) => ef.get(`${atk.id}:${def.id}`) === -1).length,
  }));
  const mostWeak = [...tally].sort((a, b) => b.weak - a.weak).slice(0, 4);
  const mostTough = [...tally].sort((a, b) => b.resist - a.resist).slice(0, 4);
  const chip = (x) => `<span class="pill">${badge(x.t.id)}${x.weak} 个系别克制 / ${x.resist} 个系别抵抗</span>`;

  /**
   * 双系组合速查。
   * 上面那张矩阵是**单系**的（只有克制 / 普通 / 抵抗三档），但双系精灵不是把两个单系
   * 倍率相乘 —— 游戏里：两个系都被克制是 ×3（不是 ×4），两个系都抵抗是 ×¼。
   * 所以单系矩阵看不出双系的结果，这里按"打到某双系组合"列出 ×3 与 ×¼ 的各有哪些。
   */
  const dblRows = [];
  for (let i = 0; i < tlist.length; i++) {
    for (let j = i + 1; j < tlist.length; j++) {
      const pair = [tlist[i], tlist[j]];
      const ids = pair.map((t) => t.id);
      const triple = [];   // 双克制 ×3
      const quarter = [];  // 双抵抗 ×¼
      for (const atk of tlist) {
        const e = typeEffect(atk.id, ids);
        if (e === 3) triple.push(atk);
        if (e === 0.25) quarter.push(atk);
      }
      if (triple.length || quarter.length) dblRows.push({ pair, triple, quarter });
    }
  }
  const dblBlock = dblRows.length ? `
  <div class="panel" style="margin-top:12px">
    <h3 style="margin-top:0">双系组合速查 <span class="n">${dblRows.length} 组有 ×3 或 ×¼</span></h3>
    <div class="desc" style="margin-bottom:8px">
      双系精灵按<b>次数</b>算，不把两个单系倍率相乘：两个系都被克制 = <b>×3</b>（不是 ×4），
      两个系都抵抗 = <b>×¼</b>。下表只列出现 ×3 或 ×¼ 的组合。
    </div>
    <div class="table-wrap" style="max-height:420px;overflow:auto"><table>
      <thead><tr><th>双系组合</th><th class="mid">×3 双克制（打它）</th><th class="mid">×¼ 双抵抗（打它）</th></tr></thead>
      <tbody>${dblRows.map((r) => `
        <tr>
          <td>${r.pair.map((t) => badge(t.id)).join(' ')}</td>
          <td class="mid">${r.triple.length ? r.triple.map((t) => badge(t.id)).join(' ') : '<span class="desc">—</span>'}</td>
          <td class="mid">${r.quarter.length ? r.quarter.map((t) => badge(t.id)).join(' ') : '<span class="desc">—</span>'}</td>
        </tr>`).join('')}</tbody>
    </table></div>
  </div>` : '';

  return `
  <div class="page-head">
    <h1>系别克制</h1>
    <span class="sub">${tlist.length} 个系别 · ${STATE.data.matchups.length} 条克制关系</span>
  </div>
  <div class="panel">
    <div class="frow" style="gap:14px;color:var(--text-dim);font-size:12px">
      <span><b class="mx2" style="padding:1px 8px;border-radius:4px">×2</b> 克制</span>
      <span><b class="mx1" style="padding:1px 8px;border-radius:4px">—</b> 普通</span>
      <span><b class="mxh" style="padding:1px 8px;border-radius:4px">½</b> 抵抗</span>
      <span>读法：<b>行</b>=攻击方系别，<b>列</b>=防守方系别；游戏内只有「克制 / 普通 / 抵抗」三档，没有免疫</span>
    </div>
  </div>
  <div class="panel">
    <div class="frow" style="gap:8px;align-items:center">
      <b style="font-size:13px">最怕打：</b>${mostWeak.map(chip).join('')}
    </div>
    <div class="frow" style="gap:8px;align-items:center;margin-top:8px">
      <b style="font-size:13px">最耐打：</b>${mostTough.map(chip).join('')}
    </div>
  </div>
  <div class="panel matchup-wrap"><table class="matrix">
    <thead><tr><th></th>${header}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  ${immun ? `<div class="panel"><h3 style="margin:0 0 8px;font-size:15px">状态免疫（异常状态，与伤害倍率无关）</h3>
    <table><tbody>${immun}</tbody></table></div>` : ''}
  ${dblBlock}`;
}

/* ============================================================
   伤害计算（按官方结算顺序实现）
   ------------------------------------------------------------
   公式来自对战模拟器的说明页，已用它的算例逐步验证通过：
     (基础威力 + 固定加威力) x (1 + 本次技能威力%合计) = 有效威力
     round(有效威力 x 本系 x 克制 x 攻防等级 x 杂项) = 显示威力
     等级系数 = (等级 x 45 / 100 + 10) / 41
     floor( round(攻击 x 显示威力 x 等级系数) / 防御 x 最终乘区 ) = 预计伤害
   验证算例（岚鸟 扇风 打 奇丽花）：234/226、142.5、356、37/41、332、81% —— 全部吻合。

   注意两点（容易算错）：
   1. 等级系数必须用满精度（37/41），不能先四舍五入成 0.9，否则 332 会算成 340。
   2. 内层 round 只作用于「攻击 x 显示威力 x 等级系数」，除完防御才 floor。
   ============================================================ */

/* ============================================================
   性格与天分（静态游戏数据，非抓取）
   ------------------------------------------------------------
   性格表源自 BiliWiki 性格表（经 rocokingdomworld.org 转载）：
   30 种，每种提升 1 项、降低 1 项属性；每项属性作为"增"各 5 次、
   作为"减"各 5 次 —— 启动时校验，对不上会打日志。
   注意：本作生命也受性格影响，且性格修正系数是 ±10%（见 panelStat 的 nature）。
   天分：四档，最高「了不起的天分」；同档下初始个体资质仍会不同，10 为最佳。
   上游数据只有种族值，没有个体/性格/天分字段，所以这部分是静态知识而非抓取数据。
   ============================================================ */
const NATURES = [
  ['大胆', 'patk', 'pdef', '喜欢独处、警惕性强、有些敏感、独立自主、似乎有点黏人'],
  ['固执', 'patk', 'satk', '喜欢随心所欲、有点倔强、不服输、领地意识强、坚持自我'],
  ['调皮', 'patk', 'sdef', '喜欢捣乱、精力充沛、活泼好动、偶尔会闯祸、经常撒娇'],
  ['勇敢', 'patk', 'spd', '喜欢挑战、好奇心旺盛、无所畏惧、偶尔会冲动、坚韧不屈'],
  ['逞强', 'patk', 'hp', '喜欢交朋友、自由自在、常与同伴打闹、偶尔会任性、经常撒娇'],
  ['稳重', 'pdef', 'patk', '喜欢探险、有些冒失、总是一往直前、行动有些冲动、喜欢新鲜事物'],
  ['天真', 'pdef', 'satk', '喜欢胡闹、好奇心旺盛、有些粗心、偶尔会恶作剧、喜欢寻求关注'],
  ['懒散', 'pdef', 'sdef', '喜欢打瞌睡、常常偷懒、有些迟钝、偶尔会打呼噜、总是漫不经心'],
  ['悠闲', 'pdef', 'spd', '喜欢看风景、从容不迫、悠然自得、偶尔会发呆、总是慢吞吞'],
  ['坦率', 'pdef', 'hp', '喜欢宁静、善于忍耐、害怕陌生事物、行动谨慎、非常黏人'],
  ['聪明', 'satk', 'patk', '喜欢独处、享受安静、谨小慎微、行动谨慎、总是一板一眼'],
  ['专注', 'satk', 'pdef', '非常可靠、经常思考、一丝不苟、决策慎重、总是不慌不忙'],
  ['偏执', 'satk', 'sdef', '喜欢玩闹、不拘小节、丢三落四、常常闯祸、活泼好动'],
  ['冷静', 'satk', 'spd', '喜欢思考、临危不乱、行动谨慎、有些迟钝、总是慢条斯理'],
  ['理性', 'satk', 'hp', '非常敏锐、专注力强、有些偏执、专心致志、一丝不苟'],
  ['警惕', 'sdef', 'patk', '喜欢思考、偶尔会任性、行动谨慎、总是有条不紊、总是深思熟虑'],
  ['温顺', 'sdef', 'pdef', '喜欢撒娇、乖巧听话、友善宽和、善于忍耐、温柔体贴'],
  ['害羞', 'sdef', 'satk', '行动谨慎、有一点任性、偶尔会不听指令、善于忍耐、谨小慎微'],
  ['慎重', 'sdef', 'spd', '争强好胜、经常吵闹、行为强势、不轻易放弃、容易得意忘形'],
  ['焦虑', 'sdef', 'hp', '善于抗压、非常勤奋、吃苦耐劳、意志坚强、有些执拗'],
  ['胆小', 'spd', 'patk', '对动静非常敏感、逃跑飞快、警惕性强、总是小心翼翼、有些粘人'],
  ['急躁', 'spd', 'pdef', '容易生气、喜欢赛跑、迅疾如风、有些莽撞、行动迅捷'],
  ['开朗', 'spd', 'satk', '爱与同伴嬉闹、热情阳光、喜欢自由驰骋、有些冲动、有时会心不在焉'],
  ['莽撞', 'spd', 'sdef', '喜欢新奇事物、偶尔惹祸、总是三心二意、喜欢被夸奖、非常粘人'],
  ['热情', 'spd', 'hp', '容易生气、缺乏耐心、喜欢赛跑、反应迅速、有点容易得意忘形'],
  ['沉默', 'hp', 'patk', '喜欢独自沉思、总是默默无闻、总是十分被动、疏于交朋友、缺乏自信'],
  ['忧郁', 'hp', 'pdef', '喜欢独自沉思、有些冷漠、善于观察、思维敏捷、总是深思熟虑'],
  ['平和', 'hp', 'satk', '情绪稳定、喜欢拥抱、悠闲自在、值得信任、偶尔会偷吃'],
  ['粗心', 'hp', 'sdef', '喜欢发呆、无精打采、有些消极、总是闷闷不乐、善于观察'],
  ['踏实', 'hp', 'spd', '喜欢独处、非常黏人、缺乏安全感、总是忐忑不安、善于观察'],
];
const STAT_LABEL6 = { hp: '生命', patk: '物攻', satk: '魔攻', pdef: '物防', sdef: '魔防', spd: '速度' };
// 天分档位（了不起 / 不错 / 普通 / 平庸）本来用于独立「性格·天分」页，
// 那个页面按用户要求切掉后就没有消费方了，相关常量与 talentOf() 一并删除。
const natureByName = new Map(NATURES.map(([n, up, down, desc]) => [n, { name: n, up, down, desc }]));

/** 自检：30 种性格，且每项属性当"增"/"减"各 5 次（对不上说明转录出错） */
(function checkNatures() {
  const up = {}, down = {};
  for (const [, u, d] of NATURES) { up[u] = (up[u] || 0) + 1; down[d] = (down[d] || 0) + 1; }
  const bad = [];
  if (NATURES.length !== 30) bad.push(`数量 ${NATURES.length}≠30`);
  for (const k of Object.keys(STAT_LABEL6)) {
    if (up[k] !== 5) bad.push(`${k} 增 ${up[k]}≠5`);
    if (down[k] !== 5) bad.push(`${k} 减 ${down[k]}≠5`);
  }
  if (new Set(NATURES.map((n) => n[0])).size !== 30) bad.push('有重名');
  if (bad.length) console.warn('⚠ 性格数据校验失败:', bad.join('; '));
})();

/* ============================================================
   面板数值计算（按官方公式，已用实测数据验证）
   ------------------------------------------------------------
   面板A（物攻/魔攻/物防/魔防/速度）
     真实数值 = round(种族值 × 1.1 + 个体值 × 0.55 + 10) × 性格 + 50
   面板B（生命）
     真实血量 = round(种族值 × 1.7 + 个体值 × 0.85 + 70) × 性格 + 100
   个体值 = 天分 × 星级倍率（5★ 时 ×6，满 60）

   ⚠ round 只作用于「种族值×系数 + 个体值×系数 + 常数」这一整块，
     乘性格、加常数都在 round 外面。这个位置踩过两次坑（都差 1）：
       - 把 round 放到乘性格之后 → 翼王速度算成 266，游戏实测 267
       - 把 round 换成向下取整   → 水灵速度算成 201，游戏实测 214
     两个实测点同时吻合的只有下面这个写法。

   已验证的实测点：
     翼王(速度种族125) 个体60 加速×1.2 → round(137.5+33+10)=181 → ×1.2=217 → 267 ✓
     水灵(速度种族85)  个体60 加速×1.2 → round(93.5+33+10)=137  → ×1.2=164 → 214 ✓
     水灵(物防种族94)  个体 0  中性×1.0 → round(103.4+10)=113    → 163 ✓
     水灵(魔防种族132) 个体 0  中性×1.0 → round(145.2+10)=155    → 205 ✓
   ============================================================ */
const STAT_COEF = { hp: { base: 1.7, iv: 0.85, flat: 70, plus: 100 } };
const STAT_NORMAL_COEF = { base: 1.1, iv: 0.55, flat: 10, plus: 50 };
/** 性格系数：每项可单独设 up / down / neutral */
const NATURE_MULT = { up: 1.2, down: 0.9, neutral: 1 };

/** 单项面板值（可能带小数）*/
function panelValue(stat, baseStat, iv = 0, nature = 'neutral') {
  const c = STAT_COEF[stat] ?? STAT_NORMAL_COEF;
  const inner = Math.round(baseStat * c.base + iv * c.iv + c.flat);
  return inner * (NATURE_MULT[nature] ?? 1) + c.plus;
}
/** 面板值取整（游戏里显示整数）*/
const panelInt = (stat, baseStat, iv = 0, nature = 'neutral') =>
  Math.round(panelValue(stat, baseStat, iv, nature));

const STAT_ORDER = ['hp', 'patk', 'satk', 'pdef', 'sdef', 'spd'];

/**
 * 一只精灵的加点配置初始值：六项各自 { iv, nature }，初始都不投、性格全中性。
 * spiritCalcOf() 用它建 Map 里的条目。
 */
function defaultNat(spirit = '152:1') {
  const stats = {};
  for (const k of STAT_ORDER) stats[k] = { iv: 0, nature: 'neutral' };
  return { spirit, stats };
}

/** 星级 -> 个体倍率（5★ 为 ×6，天分10 时满 60）*/
const STAR_MULT = { 1: 1.2, 2: 2.4, 3: 3.6, 4: 4.8, 5: 6 };
const ivOf = (talent, star) => Math.round(talent * (STAR_MULT[star] ?? 1));

/** 个体值上限：常驻 60（详情页不再区分天分/星级，因为面板值已经包含基础数值那部分） */
const IV_MAX = 60;

/** 兼容旧调用：按 0~60 的个体值 + 性格系数换算面板 */
const panelStat = (base, iv = 0, natureMult = 1, stat = 'patk') =>
  Math.round(panelValue(stat, base, iv, natureMult > 1 ? 'up' : natureMult < 1 ? 'down' : 'neutral'));

/** 等级系数 */
const levelCoef = (level) => (level * 45 / 100 + 10) / 41;

/** 某个能力值（物攻/魔攻/物防/魔防/速度）。血量也走独立公式 */
function panelOf(sp, which, iv = 0, nature = 'neutral') {
  const base = sp.stats[which] ?? 0;
  return panelInt(which, base, iv, nature);
}

/**
 * 克制倍率。
 *
 * ⚠ 官方 types.json 里的 effect_values 是：{ counter: 1, neutral: 0, resisted: -1 }
 * 也就是说 1 = 克制 ×2、0 = 普通 ×1、-1 = 抵抗 ×0.5。
 * 只靠"看起来像不像"猜语义会猜反 —— 早先版本把 1 当成 ×0.5、-1 当成 ×0.25，
 * 整个系别克制页都是错的。这个映射必须以源数据的 effect_values 为准。
 * 另外这个游戏没有 ×0 免疫（全库只有 0/1/-1 三种取值）。
 *
 * 双系精灵不按"单系倍率相乘"算，而是按游戏规则：
 *   两个系都被克制 -> ×3（**不是** ×2 ×2 = ×4，即"双克制只有三倍"）
 *   两个系都抵抗   -> ×0.25（单系 ×0.5，叠加后 ×0.25，即"抵抗是四倍"）
 * 所以这里不能简单地把两个 1（=×2）乘起来，否则双克制会算成 ×4。
 */
const EFFECT_MULT = { 1: 2, 0: 1, '-1': 0.5 };
// 叠加结果：按克制/抵抗的**次数**查表，而不是把单系倍率相乘
const STACKED_MULT = {
  '2': 3,       // 双克制
  '1': 2,       // 单克制
  '0': 1,       // 中性
  '-1': 0.5,    // 单抵抗
  '-2': 0.25,   // 双抵抗
};

/** 被攻击方可能有两个系别。
 *  ⚠ 参数是"系别 id 的数组"（spirit.types 存的是数字 id，如 [15]），
 *  不是名字。早先版本把名字当作 id 传进来，结果永远命中不到，克制恒为 ×1。
 *  技能侧同理：用 sk.typeId（数字），不要用 sk.type（名字）。 */
function typeEffect(atkTypeId, defenderTypeIds) {
  const atk = typeof atkTypeId === 'number' ? STATE.typeById.get(atkTypeId) : STATE.typeByName.get(atkTypeId);
  if (!atk) return 1;
  // 把每个防御系别的 ±1/0 累加成"克制次数"，再查表得最终倍率
  let score = 0;
  for (const raw of defenderTypeIds ?? []) {
    const def = typeof raw === 'number' ? STATE.typeById.get(raw) : STATE.typeByName.get(raw);
    if (!def) continue;
    const v = STATE.effect.get(`${atk.id}:${def.id}`);
    if (v === 1 || v === -1) score += v;
  }
  const stacked = STACKED_MULT[String(Math.max(-2, Math.min(2, score)))];
  if (stacked != null) return stacked;
  // 兜底：超出 ±2 时退回逐项相乘（当前数据不会走到这里）
  let mult = 1;
  for (const raw of defenderTypeIds ?? []) {
    const def = typeof raw === 'number' ? STATE.typeById.get(raw) : STATE.typeByName.get(raw);
    if (!def) continue;
    const m = EFFECT_MULT[String(STATE.effect.get(`${atk.id}:${def.id}`))];
    if (m != null) mult *= m;
  }
  return mult;
}

/**
 * 计算一次攻击。返回每个乘区的中间值，页面按这个逐步展示。
 * opts: {
 *   level, flatAdd, skillPct, atkStage, defStage, powerMul, finalMul, targetHp, random,
 *   atkIV, defIV,                    // 个体值 0~60（对应攻/防那一项）
 *   atkNature, defNature,            // 'up' | 'down' | 'neutral'
 * }
 */
function calcDamage(atkSp, defSp, sk, opts = {}) {
  const level = opts.level ?? 60;
  const atkIV = opts.atkIV ?? 0;
  const defIV = opts.defIV ?? 0;
  const atkNature = opts.atkNature ?? 'neutral';
  const defNature = opts.defNature ?? 'neutral';
  const skillPct = opts.skillPct ?? 0;
  const flatAdd = opts.flatAdd ?? 0;
  const atkStage = opts.atkStage ?? 0;
  const defStage = opts.defStage ?? 0;
  const powerMul = opts.powerMul ?? 1;
  const finalMul = opts.finalMul ?? 1;
  const random = opts.random ?? 1;
  // 状态面板的攻击因子（可选）：
  //   mods     = 出招那一侧的加成（物攻/魔攻/技能威力/独立乘区）
  //   defMods  = 挨打那一侧的加成（物防/魔防）
  const mods = opts.mods ?? null;
  const defMods = opts.defMods ?? null;

  const isPhysical = (sk?.cat ?? '') === '物理';
  const isStatus = (sk?.cat ?? '') === '状态';
  const atkKey = isPhysical ? 'patk' : 'satk';
  const defKey = isPhysical ? 'pdef' : 'sdef';

  // 基础威力：opts.power 允许覆盖（四技能槽里可以把某一招的威力改成别的值，
  // 比如把固定伤害技按实际威力填）。不传就用技能自身的基础威力 damage[0]。
  const basePower = opts.power ?? sk?.dmgMax ?? 0;
  // 面板值先算出来，再叠状态里的"物攻%/魔攻%"加成（只影响参与计算的那一项）
  const rawAtkStat = panelOf(atkSp, atkKey, atkIV, atkNature);
  const modAtkPct = mods ? (atkKey === 'patk' ? (mods.patkPct ?? 0) : (mods.satkPct ?? 0)) : 0;
  const atkStat = Math.round(rawAtkStat * (1 + modAtkPct / 100));
  // 防御侧：物防/魔防的百分比加成（只影响参与计算的那一项）
  const rawDefStat = panelOf(defSp, defKey, defIV, defNature);
  const modDefPct = defMods ? (defKey === 'pdef' ? (defMods.pdefPct ?? 0) : (defMods.sdefPct ?? 0)) : 0;
  const defStat = Math.max(1, Math.round(rawDefStat * (1 + modDefPct / 100)));

  // 攻防等级：攻击提升和防御下降都在分子，攻击下降和防御提升都在分母
  const atkZone = ((1 + atkStage) / (1 + defStage)) || 1;

  // 技能威力：先加固定值，再按百分比放大；状态里的"技能威力"两项就作用在这里
  const modPowerAdd = mods?.powerAdd ?? 0;
  const modPowerPct = mods?.powerPct ?? 0;
  const effective = (basePower + flatAdd + modPowerAdd) * (1 + skillPct + modPowerPct / 100);
  // 系别：默认用技能自身的系别；opts.typeOverrideId 允许覆盖
  // （星陨印记那段额外伤害是幻系，跟触发它的技能是什么系无关）
  const dmgTypeId = opts.typeOverrideId ?? sk?.typeId;
  // 本系加成：这个系别出现在攻击方自身系别里（spirit.types 是 id 数组）
  const stab = (atkSp.types ?? []).includes(dmgTypeId) ? 1.25 : 1;
  const typeEff = typeEffect(dmgTypeId, defSp.types ?? []);
  const shown = Math.round(effective * stab * typeEff * atkZone * powerMul);

  const lvCoef = levelCoef(level);
  const inner = Math.round(atkStat * shown * lvCoef);
  // 独立乘区：状态里给的是百分数（100 = 不变），换算成倍率
  const modFinal = mods ? (mods.finalPct ?? 100) / 100 : 1;
  const dmg = isStatus ? 0 : Math.floor((inner / defStat) * finalMul * modFinal * random);

  const targetHp = opts.targetHp ?? defSp.stats.hp;
  const hits = dmg > 0 ? Math.ceil(targetHp / dmg) : Infinity;

  return {
    basePower, flatAdd, skillPct, effective, atkStat, defStat, atkKey, defKey, isPhysical, isStatus,
    dmgTypeId, stab, typeEff, atkZone, powerMul, shown, lvCoef, level, inner, finalMul, random, dmg,
    targetHp, hits, pct: targetHp > 0 ? dmg / targetHp : 0,
    modAtkPct, modPowerAdd, modPowerPct, modFinal, modDefPct,
  };
}

/* ============================================================
   视图：伤害计算
   ============================================================ */

/** 该精灵能用的全部技能（升级 + 技能石 + 传说 + 血脉专属），带去重 */
function usableSkillsOf(sp) {
  const own = spiritSkillsOf(sp);
  const out = [...own.level, ...own.machine, ...own.legendary];
  const seen = new Set(out.map((s) => s.id));
  for (const b of STATE.data.spiritBloodlines?.[`${sp.id}:${sp.formId}`] ?? []) {
    if (!b.skillId || seen.has(b.skillId)) continue;
    const sk = STATE.bySkill.get(b.skillId);
    if (sk) { out.push({ ...sk, src: 'blood' }); seen.add(b.skillId); }
  }
  return out;
}

/**
 * 精灵选择：可搜索的下拉。
 * 原来是原生 <select>，几百只精灵只能靠输入首字跳转；这里做成
 * 「按钮显示当前选择 + 点开是带搜索框的列表」，按名字或编号过滤。
 */
function spiritPicker(side, current) {
  const sp = STATE.bySpirit.get(current);
  const q = (STATE.calc.spQuery?.[side] ?? '').trim().toLowerCase();
  const open = STATE.calc.spOpen === side;
  const label = sp ? `#${sp.id} ${sp.name}${sp.form ? '·' + sp.form : ''}` : '(未选择)';
  let list = '';
  if (open) {
    const all = STATE.data.spirits
      .filter((s) => (!q ? true : `${s.id} ${s.name}${s.form ? '·' + s.form : ''}`.toLowerCase().includes(q)))
      .slice(0, 60);
    list = `<div class="calc-picker-panel">
      <input type="search" class="calc-picker-q" data-calc-picker-q="${side}"
        placeholder="搜精灵名或编号…" value="${esc(STATE.calc.spQuery?.[side] ?? '')}" autocomplete="off">
      <div class="calc-picker-list">
        ${all.length ? all.map((s) => {
      const key = `${s.id}:${s.formId}`;
      const nm = `#${s.id} ${s.name}${s.form ? '·' + s.form : ''}`;
      return `<button type="button" class="calc-picker-item${key === current ? ' on' : ''}"
            data-calc-pick-spirit="${side}:${key}">${esc(nm)}</button>`;
    }).join('') : '<div class="desc" style="padding:6px">没有匹配的精灵</div>'}
      </div>
    </div>`;
  }
  return `<div class="calc-picker">
    <button type="button" class="calc-picker-btn" data-calc-picker="${side}"
      aria-expanded="${open ? 'true' : 'false'}">
      <span class="calc-picker-cur">${esc(label)}</span>
      <span class="calc-picker-caret" aria-hidden="true">▾</span>
    </button>
    ${list}
  </div>`;
}

/**
 * 伤害计算的六维卡片区：3×2 网格。
 * 每张卡片：属性名 + 大字面板值 + 小字种族值 + 右侧「个体」按钮；
 * 卡片右上角是「+ / −」性格开关（整列各至多一项、同一项不能既加又减）——
 * 性格加点就在这一页完成，不用跑去详情页。
 */
function statCards(sp, c, opts = {}) {
  const canInvestMore = STAT_ORDER.filter((k) => c.stats[k].iv > 0).length < 3;
  const upKey = STAT_ORDER.find((k) => c.stats[k].nature === 'up') ?? null;
  const downKey = STAT_ORDER.find((k) => c.stats[k].nature === 'down') ?? null;

  return `<div class="stat-cards" data-stat-cards="1" data-calc-side="${opts.side ?? ''}" data-calc-spirit="${sp.id}:${sp.formId}">${STAT_ORDER.map((k) => {
    const st = c.stats[k];
    const b = statBreakdown(k, sp.stats[k] ?? 0, st.iv, st.nature);
    const isUp = upKey === k;
    const isDown = downKey === k;
    // 性格按钮的禁用规则（与详情页一致）：
    //   已选中 -> 可点（取消）；本列已被别的项占用 或 本项已占另一列 -> 禁用
    const blocked = (kind) => {
      if (st.nature === kind) return false;
      const takenByOther = STAT_ORDER.some((x) => x !== k && c.stats[x].nature === kind);
      const otherKind = kind === 'up' ? isDown : isUp;
      return takenByOther || otherKind;
    };
    const ivBlocked = !(st.iv > 0) && !canInvestMore;
    const title = `${STAT_LABEL6[k]}：${b.basePart}（种族${b.baseStat}×系数）+ ${b.flat}（常数）+ 个体${st.iv}×系数${b.ivGain ? ` +${b.ivGain}` : ''}${b.coef !== 1 ? ` ×${b.coef}（性格）` : ''} + ${b.const} = ${b.panel}`;
    return `<div class="s-card" data-stat="${k}" title="${title}">
      <div class="s-card-top">
        <span class="s-name"><span class="nat-ic-wrap">${stateIcon(k)}</span>${STAT_LABEL6[k]}</span>
        <span class="s-nats">
          <button type="button" class="nat-btn up${isUp ? ' on' : ''}" data-nat-btn="${k}" data-nat-kind="up"
            ${blocked('up') ? 'disabled' : ''} title="${isUp ? `取消 ${STAT_LABEL6[k]} 的加成` : `给 ${STAT_LABEL6[k]} 加成 ×${NATURE_MULT.up}`}">+</button>
          <button type="button" class="nat-btn down${isDown ? ' on' : ''}" data-nat-btn="${k}" data-nat-kind="down"
            ${blocked('down') ? 'disabled' : ''} title="${isDown ? `取消 ${STAT_LABEL6[k]} 的削弱` : `给 ${STAT_LABEL6[k]} 削弱 ×${NATURE_MULT.down}`}">−</button>
        </span>
      </div>
      <div class="s-card-main">
        <div class="s-vals">
          <b class="s-panel">${b.panel}</b>
          <span class="s-base">种族 <b>${b.baseStat}</b></span>
        </div>
        <button type="button" class="nat-ivbtn${st.iv > 0 ? ' on' : ''}" data-nat-ivbtn="${k}"
          ${ivBlocked ? 'disabled' : ''}
          title="${st.iv > 0 ? `取消 ${STAT_LABEL6[k]} 的个体投入` : ivBlocked ? '最多只能投入 3 项，请先取消一项' : `点一下投满 ${STAT_LABEL6[k]}（个体 ${IV_MAX}）`}">
          <span class="iv-k">个体</span><span class="iv-v">${st.iv}</span>
        </button>
      </div>
    </div>`;
  }).join('')}</div>`;
}

/** 绑伤害计算两侧的六维卡片区 */
function bindStatCards() {
  for (const side of ['a', 'b']) {
    const box = $(`.stat-cards[data-calc-side="${side}"]`);
    if (!box || box.dataset.bound === '1') continue;
    box.dataset.bound = '1';
    const key = box.dataset.calcSpirit;
    const sp = STATE.bySpirit.get(key);
    if (!sp) continue;
    const c = withCalcSide(side, () => spiritCalcOf(sp));
    const redraw = () => render();

    for (const btn of box.querySelectorAll('[data-nat-btn]')) {
      btn.addEventListener('click', () => {
        const k = btn.dataset.natBtn;
        const kind = btn.dataset.natKind;
        const st = c.stats[k];
        if (st.nature === kind) {
          st.nature = 'neutral';
        } else {
          if (STAT_ORDER.some((x) => x !== k && c.stats[x].nature === kind)) {
            toast(kind === 'up' ? '加成已经给了别的属性，请先取消那一项' : '削弱已经给了别的属性，请先取消那一项');
            return;
          }
          if (st.nature === (kind === 'up' ? 'down' : 'up')) st.nature = 'neutral';
          st.nature = kind;
        }
        redraw();
      });
    }
    for (const btn of box.querySelectorAll('[data-nat-ivbtn]')) {
      btn.addEventListener('click', () => {
        const k = btn.dataset.natIvbtn;
        const st = c.stats[k];
        if (st.iv > 0) {
          st.iv = 0;
        } else {
          if (STAT_ORDER.filter((x) => x !== k && c.stats[x].iv > 0).length >= 3) {
            toast('最多只能投入 3 项，请先取消一项');
            return;
          }
          st.iv = IV_MAX;
        }
        redraw();
      });
    }
  }
}

/** 把一个技能放进某一侧四技能槽的第一个空位（已被占则覆盖最后一个） */
function pushLoadout(side, skillId) {
  const load = side === 'a' ? STATE.calc.loadA : STATE.calc.loadB;
  if (load.includes(skillId)) return;
  const empty = load.indexOf(null);
  load[empty >= 0 ? empty : load.length - 1] = skillId;
}

/**
 * 把这侧"伤害最高的技能"（可选只取前 limit 个）算出来。
 * 用该侧自己的加点配置；威力用技能自带的基础威力。
 * 注意：这里**不含**全局的 固定加威力 / 本次技能威力% —— 保持与官方说明页
 * 算例口径一致（扇风打奇丽花 = 332）；四技能槽那份是含全局加成的。
 */
function topSkillsOf(side, sp, otherSp, limit) {
  const c = STATE.calc;
  const cfg = withCalcSide(side, () => spiritCalcOf(sp));
  const otherSide = side === 'a' ? 'b' : 'a';
  const targetHp = targetHpOf(otherSide, otherSp);
  const list = usableSkillsOf(sp)
    .filter((s) => (s.dmgMax ?? 0) > 0 && s.cat !== '状态')
    .map((s) => {
      const ak = (s.cat ?? '') === '魔法' ? 'satk' : 'patk';
      return {
        s,
        r: calcDamage(sp, otherSp, s, {
          level: c.level,
          atkIV: cfg.stats[ak].iv, atkNature: cfg.stats[ak].nature,
          targetHp,
        }),
      };
    })
    .sort((x, y) => y.r.dmg - x.r.dmg);
  return limit ? list.slice(0, limit) : list;
}

/** 某一侧的四技能槽是否还全是空的 */
function loadoutIsEmpty(side) {
  return (side === 'a' ? STATE.calc.loadA : STATE.calc.loadB).every((x) => !x);
}

/** 该侧是否已经自动填过（没填过才自动填；用户删空后不再填回来） */
function loadoutInited(side) {
  return side === 'a' ? STATE.calc.loInitA : STATE.calc.loInitB;
}
function markLoadoutInited(side) {
  if (side === 'a') STATE.calc.loInitA = true; else STATE.calc.loInitB = true;
}
/** 换精灵时重置该侧的自动填标记，让它对新精灵重新自动填 */
function resetLoadoutInit(side) {
  if (side === 'a') STATE.calc.loInitA = false; else STATE.calc.loInitB = false;
  if (side === 'a') {
    STATE.calc.loadA = [null, null, null, null];
    STATE.calc.powA = [null, null, null, null];
    STATE.calc.hitA = [1, 1, 1, 1];
  } else {
    STATE.calc.loadB = [null, null, null, null];
    STATE.calc.powB = [null, null, null, null];
    STATE.calc.hitB = [1, 1, 1, 1];
  }
}

/** 用该侧伤害最高的前 n 个技能填满四技能槽 */
function fillLoadoutWithTop(side, sp, otherSp, n = 4) {
  const top = topSkillsOf(side, sp, otherSp, n).map((x) => x.s.id);
  if (side === 'a') STATE.calc.loadA = [top[0] ?? null, top[1] ?? null, top[2] ?? null, top[3] ?? null];
  else STATE.calc.loadB = [top[0] ?? null, top[1] ?? null, top[2] ?? null, top[3] ?? null];
}

/**
 * 算出一侧四技能槽每一招的伤害与合计。
 * 与 calcDamage 同一套参数（等级 / 个体 / 性格 / 各类乘区），只是逐槽算一遍。
 * atkKey / defKey 这两个入参保留是为了调用方语义清晰，实际内部按每一招自己的
 * 类别（物攻/魔攻）决定用哪两项 —— 因为四招里可能物魔混着。
 */
function loadoutDamage(side, sp, otherSp) {
  const c = STATE.calc;
  const load = side === 'a' ? c.loadA : c.loadB;
  const pows = side === 'a' ? c.powA : c.powB;
  const hits = side === 'a' ? c.hitA : c.hitB;
  const cfg = withCalcSide(side, () => spiritCalcOf(sp));
  const otherSide = side === 'a' ? 'b' : 'a';
  const targetHp = targetHpOf(otherSide, otherSp);
  const rows = [];
  let sum = 0;
  load.forEach((sid, i) => {
    const sk = sid ? STATE.bySkill.get(sid) : null;
    if (!sk) { rows.push({ i, sk: null, pow: 0, hit: 1, dmg: 0, total: 0 }); return; }
    const pow = pows[i] != null ? pows[i] : (sk.dmgMax ?? 0);
    const hit = hits[i] ?? 1;
    // 出招这一侧自己能打多少，只取决于自己的攻 + 技能 + 对面的防，
    // 与"对面选没选技能"无关（外面传进来的 defKey 是"对面打我会用到的防"，
    // 对面没选技能时是 null，拿它当守卫会让整块算不出来）。
    const ownAtk = (sk.cat ?? '') === '魔法' ? 'satk' : 'patk';
    const againstDef = ownAtk === 'satk' ? 'sdef' : 'pdef';
    // 挨打的是对面：用对面的这一项配置
    const tgtDefIV = withCalcSide(otherSide, () => spiritCalcOf(otherSp).stats[againstDef]?.iv ?? 0);
    const tgtDefNature = withCalcSide(otherSide, () => spiritCalcOf(otherSp).stats[againstDef]?.nature ?? 'neutral');
    let dmg = 0;
    if (pow > 0) {
      dmg = calcDamage(sp, otherSp, sk, {
        level: c.level,
        atkIV: cfg.stats[ownAtk].iv, atkNature: cfg.stats[ownAtk].nature,
        defIV: tgtDefIV, defNature: tgtDefNature,
        power: pow,
        flatAdd: c.flatAdd, skillPct: c.skillPct,
        atkStage: c.atkStage, defStage: c.defStage,
        powerMul: c.powerMul, finalMul: c.finalMul,
        targetHp,
        // 状态面板里的攻击因子：出招这一侧的加成 + 挨打那一侧的防加成
        mods: side === 'a' ? c.modsA : c.modsB,
        defMods: side === 'a' ? c.modsB : c.modsA,
      }).dmg;
    }
    const total = dmg * hit;
    sum += total;
    // 斩杀线：这一招配星陨几层能一轮打死对面（口径与上表一致，含全局加成）
    const killN = pow > 0 ? starfallKillLayers(sp, otherSp, sk, { sendGlobal: true }) : null;
    rows.push({ i, sk, pow, hit, dmg, total, killN });
  });
  return { rows, sum };
}

/** 「？异常与印记」说明：把状态面板里的数据集按分类摊开 */
function statusHelpDialog() {
  const kinds = STATE.data.meta.statusKinds ?? {};
  const body = Object.entries(kinds).map(([kind, meta]) => {
    const list = STATE.statuses.filter((s) => s.kind === kind);
    if (!list.length) return '';
    return `<div class="section"><h3><span class="st-tag" style="--c:${meta.color}">${esc(meta.label)}</span> ${esc(meta.desc)} <span class="n">${list.length} 条</span></h3>
      <div class="table-wrap"><table>
        <thead><tr><th>名称</th><th>效果</th><th class="num">引用技能</th></tr></thead>
        <tbody>${list.map((s) => `<tr>
          <td><b>${esc(s.name)}</b></td>
          <td class="desc">${esc(s.desc)}</td>
          <td class="num">${s.n}</td>
        </tr>`).join('')}</tbody>
      </table></div></div>`;
  }).join('');
  openModal(`<div class="modal-body">
    <h2>异常与印记</h2>
    <p class="desc" style="margin:6px 0 12px">
      共 ${STATE.statuses.length} 条，来自本项目的术语库（上游 description_notes）。
      「印记」下场不会消失、由新入场的精灵继承，最多同时拥有 1 种正面 + 1 种负面印记。
    </p>
    ${body}
  </div>`);
}

/**
 * 状态面板：两侧各一栏，显示【当前选中的状态/印记】与【可调的攻击因子】。
 *
 * 数据来自本项目自己的术语库（out/<locale>/status.jsonl，由 tools/build-status-data.mjs
 * 从 roco.world 的 description_notes 抽取），不依赖任何第三方整理的数据。
 *
 * 每侧的结构：
 *   ① 当前生效的状态卡片（名称 / 分类 / 描述 / 引用技能数）
 *   ② 一组"攻击因子"：物攻% 魔攻% 物防% 魔防% 速度 技能威力+值 技能威力% 独立乘区%
 *      这些会真正进入伤害计算（见 calcDamage 的 mods / defMods）
 *   ③ 血量条：当前血量 / 总血量 + 可拖动滑块
 *   ④ 星陨印记层数
 *   ⑤ 状态造成的伤害（百分比掉血，或星陨那样按威力走标准公式）
 *   ⑥ 状态选择区（前四类分类）
 */
function sideStatusPanel(side, sp, otherSp = null) {
  const c = STATE.calc;
  const isA = side === 'a';
  const st = isA ? c.statusA : c.statusB;
  const mods = isA ? c.modsA : c.modsB;
  const hpPct = isA ? c.hpPctA : c.hpPctB;
  // 总量用面板生命值（与卡片区同一个数），不是种族基础值
  const hpMax = hpMaxOf(side, sp);
  const cur = hpNowOf(side, sp);
  const kinds = STATE.data.meta.statusKinds ?? {};
  const picked = st.picks ?? [];

  // 已选中的状态（官方规则：最多同时 1 种正面印记 + 1 种负面印记，这里不强行限制种类）
  const chosen = picked.map((k) => STATE.statusByKey.get(k)).filter(Boolean);
  const picksHtml = chosen.length
    ? chosen.map((s) => {
      const k = kinds[s.kind] ?? { label: s.kind, color: '#7a7f8a' };
      return `<div class="st-card" data-st-key="${s.key}">
        <div class="st-card-main">
          <span class="st-tag" style="--c:${k.color}">${esc(k.label)}</span>
          <b>${esc(s.name)}</b>
          <button type="button" class="st-drop" data-st-drop="${side}:${s.key}" title="移除">×</button>
        </div>
        <div class="desc">${esc(s.desc)}</div>
        ${s.n ? `<div class="desc st-used">被 ${s.n} 个技能引用：${s.usedBy.slice(0, 6).map(esc).join('、')}${s.usedBy.length > 6 ? '…' : ''}</div>` : ''}
      </div>`;
    }).join('')
    : '<div class="st-empty">还没有选状态 —— 从下面按分类挑</div>';

  // 可选状态：按分类分组，只保留前四类（印记 / 天气 / 状态 / 增益减益）——
  // 应对、离场、机制属于"规则说明"，更适合放在「？异常与印记」里看
  const PICKER_KINDS = ['mark', 'weather', 'status', 'buff'];
  const pickHtml = Object.keys(kinds).length
    ? PICKER_KINDS.filter((kind) => kinds[kind] && STATE.statuses.some((s) => s.kind === kind)).map((kind) => {
      const meta = kinds[kind];
      const list = STATE.statuses.filter((s) => s.kind === kind);
      return `<div class="st-group">
        <div class="st-group-head"><span class="st-tag" style="--c:${meta.color}">${esc(meta.label)}</span>
          <span class="desc">${esc(meta.desc)}</span></div>
        <div class="st-chips">${list.map((s) => `<button type="button" class="st-chip${picked.includes(s.key) ? ' on' : ''}"
          data-st-pick="${side}:${s.key}" title="${esc(s.desc)}">${esc(s.name)}</button>`).join('')}</div>
      </div>`;
    }).join('')
    : '';

  // 攻击因子（真正进伤害计算）——顺序与参考图一致：
  // 物攻 / 魔攻 / 物防 / 魔防 / 速度 / 技能威力+值 / 技能威力% / 独立乘区%
  const MOD_FIELDS = [
    ['patkPct', '物攻', '%'], ['satkPct', '魔攻', '%'],
    ['pdefPct', '物防', '%'], ['sdefPct', '魔防', '%'],
    ['spdAdd', '速度', '+'],
    ['powerAdd', '技能威力', '+'], ['powerPct', '技能威力', '%'],
    ['finalPct', '独立乘区', '%'],
  ];
  const modHtml = MOD_FIELDS.map(([key, label, unit]) => {
    const v = mods[key] ?? (key === 'finalPct' ? 100 : 0);
    return `<label class="st-mod" title="会进入伤害计算">
      <span class="st-mod-k">${label}</span>
      <input type="number" step="5" value="${v}" data-st-mod="${side}:${key}" aria-label="${label}${unit === '%' ? '百分比' : '加点'}">
      <span class="st-mod-u">${unit === '%' ? '%' : ''}</span>
    </label>`;
  }).join('');

  return `<div class="st-side" data-st-side="${side}">
    <div class="st-side-head">
      <span class="cn">${esc(sp.name)}</span>
      <span class="desc">${isA ? '我方' : '对方'}</span>
    </div>

    <div class="st-picks">${picksHtml}</div>

    <div class="st-mods">${modHtml}</div>

    <div class="st-hp">
      <div class="st-hp-head">
        <span>${isA ? '我方' : '对方'}当前血量</span>
        <b><span class="st-hp-pct">${hpPct}%</span> <span class="desc st-hp-max">${cur}/${hpMax}</span></b>
      </div>
      <div class="st-hp-track">
        <div class="st-hp-bar"><i style="width:${hpPct}%"></i></div>
        <input type="range" min="0" max="100" step="1" value="${hpPct}" data-st-hp="${side}"
               aria-label="${isA ? '我方' : '对方'}当前血量百分比" title="左右拖动调整血量">
      </div>
    </div>

    <div class="st-star">
      <div class="st-hp-head">
        <span>${isA ? '我方' : '对方'}被附加星陨 <b>${st.star ?? 0}</b> 层</span>
        <input type="number" min="0" max="99" value="${st.star ?? 0}" data-st-star="${side}" aria-label="星陨层数">
      </div>
      <div class="desc">使用非幻系技能攻击持有该印记的精灵时，消耗全部层数造成额外幻系伤害（幻系精灵不会获得）</div>
    </div>

    ${statusDamageBlock(side, sp, otherSp)}

    <div class="st-picker">${pickHtml}</div>
  </div>`;
}

/**
 * 「状态造成的伤害」区块：把该侧已选状态里**会造成伤害**的那些列出来。
 *   · 百分比类（灼烧/中毒/冻结/寄生/棘刺/引电/中毒印记）：按面板生命 × 百分比 × 元素克制
 *   · 威力类（星陨印记）：显示威力 = 层数² − 24×层数 + 24，再走标准伤害公式，
 *     物理/魔法跟随触发它的那个技能，系别固定为幻系（所以吃系别克制）
 */
function statusDamageBlock(side, sp, otherSp = null) {
  // 触发这一侧状态的那次攻击：一定是**对面**打过来的
  const atkSide = side === 'a' ? 'b' : 'a';
  const attacker = otherSp ?? STATE.bySpirit.get(STATE.calc[atkSide]);
  const atkSkillId = atkSide === 'a' ? STATE.calc.skillA : STATE.calc.skillB;
  const skill = atkSkillId ? STATE.bySkill.get(atkSkillId) : null;
  const d = statusDamageOf(side, sp, { attacker, skill });
  if (!d.rows.length) {
    return `<div class="st-dmg st-dmg-empty">
      <div class="st-dmg-head"><span>状态造成的伤害</span></div>
      <div class="desc">选中「中毒 / 灼烧 / 冻结 / 寄生 / 引电 / 中毒印记 / 棘刺印记 / 星陨印记」这类会造成伤害的状态后，
        这里会按层数与元素克制算出实际掉血（冻结与寄生不受克制关系影响）。</div>
    </div>`;
  }
  const pcts = side === 'a' ? STATE.calc.statusPctA : STATE.calc.statusPctB;
  const rows = d.rows.map((r) => {
    const layers = side === 'a' ? STATE.calc.statusA.layers : STATE.calc.statusB.layers;
    // 星陨层数的真值是 st.star（面板上的「星陨层数」共用它）
    const curLayers = r.key === 'starfall-mark'
      ? ((side === 'a' ? STATE.calc.statusA.star : STATE.calc.statusB.star) ?? 0)
      : (layers?.[r.key] ?? r.layers);
    const pctVal = pcts?.[r.key] ?? r.pct;
    // element 为 null 的状态（冻结 / 寄生 / 棘刺）不吃克制，明确标出来
    const effTxt = !r.effective
      ? '<span class="desc">不受克制</span>'
      : r.eff === 3 ? '<span class="mx2">×3 双克制</span>'
        : r.eff === 2 ? '<span class="mx2">×2 克制</span>'
          : r.eff === 0.5 ? '<span class="mxh">×½ 抵抗</span>'
            : r.eff === 0.25 ? '<span class="mxh">×¼ 双抵抗</span>' : '<span class="desc">×1</span>';
    // 星陨这类"按威力走公式"的状态：显示威力曲线值 + 实际伤害 + 物理/魔法归属
    const isPower = r.mode === 'power';
    const detail = r.detail;
    const atkTxt = isPower
      ? (detail ? `${detail.isPhysical ? '物理' : '魔法'} ${detail.isPhysical ? '物攻' : '魔攻'}${detail.atkStat} vs ${detail.isPhysical ? '物防' : '魔防'}${detail.defStat}` : '需先选一个触发它的技能')
      : '';
    return `<div class="st-dmg-row${isPower ? ' st-dmg-power' : ''}">
      <div class="st-dmg-name">
        <b>${esc(r.name)}</b>
        <span class="desc">${r.element ? `${esc(r.element)} · ` : ''}${esc(r.when)}${r.immune && r.immune !== '—' ? ` · ${esc(r.immune)}免疫` : ''}</span>
      </div>
      ${r.per === 'stack' ? `<label class="st-dmg-in">层
        <input type="number" min="0" max="99" value="${curLayers}" data-st-layers="${side}:${r.key}" aria-label="${esc(r.name)}层数">
      </label>` : '<span class="desc st-dmg-once">一次性</span>'}
      ${isPower
        ? `<span class="st-dmg-in">显示威力 <b class="st-pow">${r.power}</b></span>`
        : `<label class="st-dmg-in">${r.per === 'stack' ? '每层' : '扣血'}
        <input type="number" min="0" max="100" step="0.5" value="${pctVal}" data-st-pct="${side}:${r.key}" aria-label="${esc(r.name)}百分比">
        <span class="st-mod-u">%</span>
      </label>`}
      <div class="st-dmg-out">
        ${effTxt}
        <b>${isPower ? (r.raw > 0 ? r.raw : '—') : r.raw}</b>
        <span class="desc">${isPower
          ? `${r.layers} 层 → 威力 ${r.power}${detail ? `（${detail.shown} × ${detail.typeEff}）` : ''}`
          : r.per === 'stack'
            ? `${r.pct}% × ${r.layers} 层 = ${r.pctSum}% 生命`
            : `${r.pct}% 生命`}</span>
      </div>
      ${atkTxt ? `<div class="desc st-dmg-note">${esc(atkTxt)}</div>` : ''}
      ${r.note ? `<div class="desc st-dmg-note">${esc(r.note)}</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="st-dmg">
    <div class="st-dmg-head">
      <span>状态造成的伤害</span>
      <b class="st-dmg-total">合计 ${d.total}
        <span class="desc">/ 当前生命 ${d.curHp}${d.lethal ? ' · 会力竭' : ''}</span>
      </b>
    </div>
    ${rows}
    <div class="desc">按面板生命 × 百分比 × 元素克制计算；掉血不会超过当前生命。</div>
  </div>`;
}

/** 给精灵选择下拉里的每一项绑事件（输入过滤后会重建列表，所以单独抽出来重绑） */
function bindSpiritPickerItems() {
  for (const item of document.querySelectorAll('[data-calc-pick-spirit]')) {
    if (item.dataset.bound === '1') continue;
    item.dataset.bound = '1';
    item.addEventListener('click', () => {
      // 属性值是 "side:formId:form"，精灵键本身含冒号，所以只切第一段
      const raw = item.dataset.calcPickSpirit;
      const sep = raw.indexOf(':');
      const side = raw.slice(0, sep);
      const key = raw.slice(sep + 1);
      STATE.calc[side] = key;
      STATE.calc.skillA = null; STATE.calc.skillB = null;
      resetLoadoutInit(side);
      STATE.calc.spOpen = null;
      STATE.calc.spQuery[side] = '';
      render();
    });
  }
}

/** 状态面板（伤害计算页）。两侧互相传入，因为星陨那段伤害要知道"对面用哪招触发" */
function statusPanel(a, b) {
  return `<section class="calc-status" aria-label="状态">
    <div class="calc-status-head">
      <h3>状态</h3>
      <div class="calc-status-actions">
        <button type="button" class="chip" data-st-reset="1">重置</button>
        <button type="button" class="chip" data-st-help="1" title="各状态与印记的含义">？异常与印记</button>
      </div>
    </div>
    <div class="calc-status-body">
      ${sideStatusPanel('a', a, b)}
      ${sideStatusPanel('b', b, a)}
    </div>
  </section>`;
}

/**
 * 四技能槽 + 伤害占比（参考图那一栏）。
 * 每行：序号 / 图标 / 名字 / 属性 / 耗能 / 威力（可改）/ 连击（可改）/ 移除 / 总伤害 + 占比条。
 * 耗能与威力取自技能数据；连击数据里没有，默认 1，可手动改。
 */
function skillLoadout(side, sp, otherSp) {
  const { rows, sum } = loadoutDamage(side, sp, otherSp);

  const body = rows.map(({ i, sk, pow, hit, dmg, total, killN }) => {
    if (!sk) {
      return `<tr class="lo-empty"><td class="mid">${i + 1}</td>
        <td colspan="10" class="desc">空位 —— 点下面「伤害最高的技能」里的一行放进来</td></tr>`;
    }
    const pct = sum > 0 ? (total / sum) * 100 : 0;
    return `<tr data-lo-row="${side}:${i}">
      <td class="mid">${i + 1}</td>
      <td class="mid">${skillIconTag(sk.id)}</td>
      <td class="skill-name">${esc(sk.name)}</td>
      <td class="mid">${sk.typeId ? badge(sk.typeId) : ''}</td>
      <td class="mid">${sk.energy ?? '—'}</td>
      <td class="mid"><input type="number" class="lo-pow" min="0" max="999" value="${pow}"
        data-lo-pow="${side}:${i}" aria-label="威力"></td>
      <td class="mid"><input type="number" class="lo-hit" min="1" max="9" value="${hit}"
        data-lo-hit="${side}:${i}" aria-label="连击"></td>
      <td class="mid"><button type="button" class="lo-del" data-lo-del="${side}:${i}"
        title="移出这个技能">×</button></td>
      <td class="num lo-dmg">
        ${total > 0
          ? `<b>${total}</b>${hit > 1 ? `<span class="desc">（${dmg}×${hit}）</span>` : ''}
             <span class="lo-bar"><i style="width:${pct.toFixed(1)}%"></i></span>
             <span class="lo-pct">${pct.toFixed(1)}%</span>`
          : '<span class="desc">—</span>'}
      </td>
      <td class="num lo-kill" title="这一招打完再触发这么多层星陨，正好能一轮打死对面（对面上要有星陨印记）">${killLayerCell(killN)}</td>
    </tr>`;
  }).join('');

  // 对面没挂星陨印记时这一列全是「—」，给一句解释免得看着像坏了
  const marked = STATE.calc.statusB.picks.includes('starfall-mark');
  return `<div class="calc-loadout" data-loadout="${side}">
    <div class="lo-head">
      <h3>四技能槽 <span class="n">${esc(sp.name)}</span></h3>
      <span class="desc">改威力 / 连击会立刻重算${sum > 0 ? `　合计 <b>${sum}</b>` : ''}　（含上方的固定加威力 ${STATE.calc.flatAdd} 与本次技能威力 ${(STATE.calc.skillPct * 100).toFixed(0)}%；下方排序表是不含这两项的裸威力值）</span>
    </div>
    <div class="table-wrap"><table class="lo-table">
      <thead><tr>
        <th class="mid">#</th><th class="mid">图标</th><th>技能</th><th class="mid">属性</th>
        <th class="mid">耗能</th><th class="mid">威力</th><th class="mid">连击</th><th class="mid">移除</th>
        <th class="num">总伤害 / 占比</th><th class="num">星陨斩杀</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    <div class="desc" style="margin-top:6px;font-size:12px">
      ${marked
        ? '「星陨斩杀」= 这一招打完后再触发多少层星陨印记，刚好一轮打死对面当前血量（含技能自身伤害）；「不需要」表示不用星陨就打得死。'
        : '「星陨斩杀」要在下面对手那侧勾上<b>星陨印记</b>并填好层数才会出数（幻系技能不触发星陨）。'}
    </div>
  </div>`;
}

/**
 * 血量只有一个真值：百分比（hpPctA / hpPctB，0~100），
 * 而"总量"就是**面板生命值**（卡片区显示的那个数，含种族/个体/性格）。
 *
 * 先前这里用 sp.stats.hp（种族基础值，比如 90）当总量，卡片却显示面板值 323，
 * 于是出现"卡片 323 / 血量条 100/90"这种对不上的情况。
 * 现在统一走 calcStatsOf：血量条、四技能槽的目标血量、卡片三者同一个数。
 */
function hpMaxOf(side, sp) {
  if (!sp) return 0;
  const cfg = withCalcSide(side, () => spiritCalcOf(sp));
  return calcStatsOf(sp, cfg).hp ?? 0;
}
/** 当前血量 = round(面板生命 × 百分比)，夹在 [0, 面板生命] */
function hpNowOf(side, sp) {
  const pct = (side === 'a' ? STATE.calc.hpPctA : STATE.calc.hpPctB) ?? 100;
  const max = hpMaxOf(side, sp);
  return Math.max(0, Math.min(max, Math.round((max * pct) / 100)));
}
/** 目标血量（打这一侧时按当前血量算）：为 0 时退回满血，避免除零 */
function targetHpOf(side, sp) {
  const max = hpMaxOf(side, sp);
  const now = hpNowOf(side, sp);
  return now > 0 ? now : max;
}

/**
 * 状态伤害表：给「会造成伤害的状态」配上元素、每层百分比、结算方式。
 * 挂在既有的状态集（STATE.statuses，来自本项目的术语库）上，不另造一份数据 ——
 * 只补上"程序要用、词条描述里是自然语言"的那几个字段。
 *
 *   element   用于克制计算（与本项目 types 匹配）；为 null 表示**不受克制关系影响**
 *   pct       伤害百分比（默认值取自词条描述，用户可改）
 *   per       按什么算：'stack' 百分比 × 层数；'once' 只看是否生效
 *   when      结算时机（只作展示）
 *   immune    谁免疫（照描述）
 */
const STATUS_EFFECTS = {
  burn: { element: '火系', pct: 2, per: 'stack', when: '回合结束', immune: '火系精灵' },
  poison: { element: '毒系', pct: 3, per: 'stack', when: '回合结束', immune: '毒系精灵' },
  'poison-mark': { element: '毒系', pct: 3, per: 'once', when: '回合结束', immune: '—' },
  // 冻结与寄生按规则**不吃克制关系**（element: null）
  freeze: { element: null, pct: 5, per: 'stack', when: '从左侧开始扣', immune: '冰系精灵', note: '按最大生命的比例从左侧扣除，不受克制关系影响；当前生命低于该比例时力竭' },
  parasite: { element: null, pct: 6, per: 'once', when: '回合结束', immune: '草系精灵', note: '按最大生命的 6% 扣除，不受克制关系影响；这部分由寄生来源回复' },
  'conductive-charge': { element: '电系', pct: 25, per: 'once', when: '每攒满 2 层立即', immune: '电系精灵' },
  'thorn-mark': { element: null, pct: 6, per: 'once', when: '离场换人时', immune: '—' },
  /**
   * 星陨印记不吃"百分比掉血"，而是给一段**额外伤害**：
   *   显示威力 = 层数² − 24 × 层数 + 24
   * 也就是 0~1 层几乎没威力（1 层只有 1），层数高了才猛涨（20 层 ≈ 224）。
   * 这段伤害走标准伤害公式，系别是幻系、攻防属性跟随**触发的那个技能**是物理还是魔法，
   * 所以照样吃系别克制；触发条件是"用非幻系技能攻击持有该印记的精灵"。
   */
  /**
   * 星陨印记不吃"百分比掉血"，而是给一段**额外伤害**：
   *   显示威力 = 层数² + 24 × 层数 − 24
   * 这条曲线单调递增：0 层按 0 算、1 层 = 1、2 层 = 28、10 层 = 316、20 层 = 856。
   * 这段伤害走标准伤害公式，系别固定幻系、攻防属性跟随**触发的那个技能**是物理还是魔法，
   * 所以照样吃系别克制；触发条件是"用非幻系技能攻击持有该印记的精灵"。
   * ⚠ powerOf 必须走 starfallPower（它夹了 0）—— 早先这里写裸公式，负值会漏出去。
   */
  'starfall-mark': {
    element: '幻系',
    powerOf: (layers) => starfallPower(layers),
    per: 'stack', when: '被非幻系技能攻击时', immune: '幻系精灵',
    note: '显示威力 = 层数² + 24 × 层数 − 24（负值按 0 算）；按幻系走标准伤害公式，物理/魔法跟随触发它的那个技能，吃系别克制',
  },
};

/** 星陨印记的显示威力 = 层数² + 24 × 层数 − 24，负数夹到 0（0 层算 0、1 层算 1） */
function starfallPower(layers) {
  const n = Math.max(0, Number(layers) || 0);
  return Math.max(0, n * n + 24 * n - 24);
}

/** 星陨威力公式的反解：给一个需要的威力，估出大概要几层 */
function layersForPower(power) {
  if (!(power > 0)) return 0;
  const c = 24 - power;               // n² + 24n + (24 − power) = 0
  const disc = 576 - 4 * c;
  if (disc < 0) return 0;
  return Math.max(0, Math.ceil((-24 + Math.sqrt(disc)) / 2));
}

/**
 * 「这一招 + 星陨 N 层」要几层才能斩杀对面的当前血量。
 *
 * opts.sendGlobal = true  与四技能槽同口径（含全局的固定加威力 / 本次技能威力%）
 * opts.sendGlobal = false 与排序表同口径（裸威力，不含这两项）
 * —— 两张表基准不同，斩杀线也得各算各的，否则自相矛盾。
 *
 * 返回 null 表示不适用（对面没挂星陨印记 / 这一招是幻系不触发 / 没填层数）。
 * 返回 0 表示不用星陨就已经打得死。
 * 触发技能与星陨那段额外伤害**加在一起**看（同一轮打出去）：
 *   baseDmg + N 层星陨伤害 ≥ 目标当前血量
 */
function starfallKillLayers(atkSp, defSp, sk, opts = {}) {
  if (!atkSp || !defSp || !sk) return null;
  // 只有"对面身上有星陨印记"时才谈得上触发
  if (!STATE.calc.statusB.picks.includes('starfall-mark')) return null;
  // 幻系技能不触发（描述原文：用**非幻系**技能攻击才触发）
  const phantomId = STATE.typeByName.get('幻系')?.id;
  if (phantomId == null) return null;
  if (sk.typeId === phantomId || !sk.typeId) return null;

  const targetHp = targetHpOf('b', defSp);
  const baseDmg = damageWithPower(atkSp, defSp, sk, sk.dmgMax ?? 0, opts);
  const at = (n) => baseDmg + damageWithPower(atkSp, defSp, sk, starfallPower(n), { ...opts, phantom: true });
  if (at(0) >= targetHp) return 0;

  // 先按公式估一个"够用"的层数。估算偏大是常态（威力是二次增长、还叠了取整），
  // 所以拿到一个够用的 n 之后必须**往下收敛**，找到真正最小的层数。
  // ⚠ 早先只从估算值往上扫，估算偏大时会返回偏大的层数（17 估出 13，实际 11）—— 已修。
  let n = layersForPower(Math.ceil(Math.max(0, targetHp - baseDmg) * 2 + 24));
  n = Math.max(0, Math.min(99, Math.round(n)));
  if (at(n) >= targetHp) {
    while (n > 0 && at(n - 1) >= targetHp) n--;
    return n;
  }
  // 估算偏小就没得收敛了，老老实实往上找第一个够用的
  while (n <= 99 && at(n) < targetHp) n++;
  return n <= 99 ? n : null;
}

/**
 * 某个技能在给定"基础威力"下的实际伤害。
 * 供斩杀线复用与主计算完全同一套参数（等级 / 个体 / 性格 / 乘区 / 状态因子）。
 */
function damageWithPower(atkSp, defSp, sk, power, o = {}) {
  const c = STATE.calc;
  const isPhysical = (sk.cat ?? '') === '物理';
  const atkKey = isPhysical ? 'patk' : 'satk';
  const defKey = isPhysical ? 'pdef' : 'sdef';
  const phantomId = STATE.typeByName.get('幻系')?.id;
  return calcDamage(atkSp, defSp, sk, {
    level: c.level,
    atkIV: withCalcSide('a', () => spiritCalcOf(atkSp).stats[atkKey].iv),
    atkNature: withCalcSide('a', () => spiritCalcOf(atkSp).stats[atkKey].nature),
    defIV: withCalcSide('b', () => spiritCalcOf(defSp).stats[defKey].iv),
    defNature: withCalcSide('b', () => spiritCalcOf(defSp).stats[defKey].nature),
    power,
    flatAdd: o.sendGlobal ? c.flatAdd : 0,
    skillPct: o.sendGlobal ? c.skillPct : 0,
    atkStage: c.atkStage, defStage: c.defStage,
    powerMul: c.powerMul, finalMul: c.finalMul,
    targetHp: targetHpOf('b', defSp),
    mods: c.modsA, defMods: c.modsB,
    // 星陨那段是幻系（与触发它的技能系别无关），所以覆盖参与计算的系别
    ...(o.phantom && phantomId != null ? { typeOverrideId: phantomId } : {}),
  }).dmg;
}

/** 斩杀线那一列的文案：不适用给「—」，本身就能打死给「不需要」 */
function killLayerCell(n) {
  if (n === null) return '<span class="desc">—</span>';
  if (n === 0) return '<span class="desc">不需要</span>';
  return `<b>${n}</b><span class="desc"> 层</span>`;
}

/**
 * 某一条状态伤害的计算模式：
 *   'pct'   按最大生命的百分比掉血（灼烧/中毒/冻结/寄生/棘刺/引电/中毒印记）
 *   'power' 按显示威力走标准伤害公式（星陨印记）
 */
function statusModeOf(key) {
  return typeof STATUS_EFFECTS[key]?.powerOf === 'function' ? 'power' : 'pct';
}

/**
 * 「会造成伤害的状态」在某个精灵身上能打出多少。
 * 两种模式：
 *   pct     有元素的按元素克制算；element 为 null 的（冻结/寄生/棘刺）不受克制
 *   power   按显示威力走标准伤害公式（星陨印记）—— 需要知道"谁在用哪种技能触发它"
 *
 * opts.attacker / opts.skill：触发这一侧状态的那次攻击（用于星陨的攻防与克制）
 */
function statusDamageOf(side, sp, opts = {}) {
  const st = side === 'a' ? STATE.calc.statusA : STATE.calc.statusB;
  const pcts = side === 'a' ? STATE.calc.statusPctA : STATE.calc.statusPctB;
  const maxHp = hpMaxOf(side, sp);
  const curHp = hpNowOf(side, sp);
  const rows = [];
  for (const key of st.picks ?? []) {
    const meta = STATUS_EFFECTS[key];
    if (!meta) continue;
    const def = STATE.statusByKey.get(key);
    // 星陨层数只有一份真值 st.star（面板上的「星陨层数」与这一行的层数共用它）
    const layers = key === 'starfall-mark' ? (st.star ?? 0) : (st.layers?.[key] ?? 1);
    // element 为 null -> 不受克制；有元素才去查克制表
    const typeId = meta.element ? STATE.typeByName.get(meta.element)?.id : null;
    const eff = typeId != null ? typeEffect(typeId, sp.types ?? []) : 1;
    const mode = statusModeOf(key);

    if (mode === 'power') {
      // 按威力走标准公式：需要触发它的攻击方与技能（决定物理/魔法、攻防面板）
      const power = meta.powerOf(layers);
      const atkSp = opts.attacker ?? null;
      const sk = opts.skill ?? null;
      let dmg = null;
      if (atkSp && sk && power > 0) {
        dmg = calcDamage(atkSp, sp, sk, {
          level: STATE.calc.level,
          atkIV: withCalcSide(side === 'a' ? 'b' : 'a', () => spiritCalcOf(atkSp).stats[sk.cat === '魔法' ? 'satk' : 'patk'].iv),
          atkNature: withCalcSide(side === 'a' ? 'b' : 'a', () => spiritCalcOf(atkSp).stats[sk.cat === '魔法' ? 'satk' : 'patk'].nature),
          defIV: withCalcSide(side, () => spiritCalcOf(sp).stats[sk.cat === '魔法' ? 'sdef' : 'pdef'].iv),
          defNature: withCalcSide(side, () => spiritCalcOf(sp).stats[sk.cat === '魔法' ? 'sdef' : 'pdef'].nature),
          power,
          // 幻系是这段额外伤害的系别，本系加成按攻击方自己算
          typeOverrideId: typeId,
          flatAdd: STATE.calc.flatAdd, skillPct: STATE.calc.skillPct,
          atkStage: STATE.calc.atkStage, defStage: STATE.calc.defStage,
          powerMul: STATE.calc.powerMul, finalMul: STATE.calc.finalMul,
          targetHp: curHp || maxHp,
        });
      }
      rows.push({
        key, name: def?.name ?? key, element: meta.element, layers,
        mode, power, per: meta.per, when: meta.when, immune: meta.immune, note: meta.note,
        eff, effective: true, pctSum: 0, raw: dmg ? dmg.dmg : 0, detail: dmg,
      });
      continue;
    }

    // 百分比掉血
    const pct = Number(pcts?.[key] ?? meta.pct) || 0;
    const perTurnPct = meta.per === 'stack' ? pct * layers : pct;
    const raw = Math.floor((maxHp * perTurnPct) / 100 * eff);
    rows.push({
      key, name: def?.name ?? key, element: meta.element, layers,
      mode: 'pct', pct, per: meta.per, when: meta.when, immune: meta.immune, note: meta.note,
      eff, effective: typeId != null, pctSum: perTurnPct, raw,
    });
  }
  const total = rows.reduce((a, r) => a + r.raw, 0);
  return {
    rows, total, maxHp, curHp,
    // 掉血不会超过当前生命（最多力竭）
    capped: Math.min(total, curHp),
    lethal: total >= curHp && curHp > 0,
  };
}

/** 一侧的面板 + 技能选择。加点用与详情页同一套组件（个体按钮 + 性格逐项开关）
 *  opts.atkKey：这一侧出招用的攻击项（没选技能时传 null，就不画攻击高亮）
 *  opts.defKey：这一侧挨打看的防御项（对面没选技能时传 null） */
function calcSide(side, sp, otherSp, opts = {}) {
  const c = STATE.calc;
  const isA = side === 'a';
  const skills = usableSkillsOf(sp);
  const curSkillId = isA ? c.skillA : c.skillB;
  const curSkill = curSkillId ? STATE.bySkill.get(curSkillId) : null;
  // 当前血量统一放在下方「状态」面板里调（百分比滑块），这里不再单独放输入框
  // 这一侧自己的加点配置（与详情页、与另一侧都独立）
  const cfg = withCalcSide(side, () => spiritCalcOf(sp));
  // 面板上画的攻/防项由外面算好（要看两侧的技能才知道）
  const atkKey = opts.atkKey ?? null;
  const defKey = opts.defKey ?? null;
  const ivOf1 = (k) => cfg.stats[k].iv;
  const natOf1 = (k) => cfg.stats[k].nature;

  const skillOpts = skills.map((s) => {
    const tag = s.src === 'blood' ? '血脉' : s.src === 'legendary' ? '传说' : s.src === 'machine' ? '技能石' : '';
    return `<option value="${s.id}"${s.id === curSkillId ? ' selected' : ''}>${esc(s.name)}${s.cat ? ` · ${esc(s.cat)}` : ''}${s.dmgMax ? ` · 威力${s.dmgMax}` : ''}${tag ? ` · ${tag}` : ''}</option>`;
  }).join('');

  // 实时结果（这一侧打对面）。atkKey/defKey 都可能为 null（没选技能）——
  // 此时对面也还没出招，本来就没有"挨打项"可用
  let result = '';
  if (curSkill && atkKey && defKey) {
    const r = calcDamage(sp, otherSp, curSkill, {
      level: c.level,
      atkIV: ivOf1(atkKey), atkNature: natOf1(atkKey),
      // 对面的"挨打那一项"用对面自己的配置
      defIV: withCalcSide(isA ? 'b' : 'a', () => spiritCalcOf(otherSp).stats[defKey].iv),
      defNature: withCalcSide(isA ? 'b' : 'a', () => spiritCalcOf(otherSp).stats[defKey].nature),
      flatAdd: c.flatAdd, skillPct: c.skillPct,
      atkStage: c.atkStage, defStage: c.defStage,
      powerMul: c.powerMul, finalMul: c.finalMul,
      targetHp: targetHpOf(isA ? 'b' : 'a', otherSp),
      // 状态面板里的攻击因子：出招这一侧的加成 + 挨打那一侧的防加成
      mods: isA ? c.modsA : c.modsB,
      defMods: isA ? c.modsB : c.modsA,
    });
    result = calcResultBlock(side, sp, otherSp, curSkill, r);
  }

  return `
  <div class="calc-side">
    <div class="calc-head">
      ${spiritPicker(side, isA ? c.a : c.b)}
      <div class="calc-spirit">
        ${imgTag(sp.head, sp.headOnline, sp.name, 'calc-head')}
        <div>
          <div class="cn">${esc(sp.name)}</div>
          <div class="trow">${badges(sp.types)}</div>
        </div>
      </div>
    </div>

    <label class="calc-skill-label">技能
      <select class="calc-select" id="cskill-${side}" data-calc="skill" data-side="${side}">
        <option value="">— 请选择技能 —</option>${skillOpts}
      </select>
    </label>

    <div class="calc-toolbar">
      <span class="desc">个体上限 <b>${IV_MAX}</b>　最多投 <b>3 项</b></span>
      <span class="desc">每张卡片右上角的 <b>+</b> / <b>−</b> 就是性格的加成 / 削弱（各至多一项）</span>
      <button class="chip natal-reset" data-calc-reset="${side}">清空</button>
    </div>

    ${statCards(sp, cfg, { side })}

    ${result}
  </div>`;
}

/** 临时把"当前配置源"切到某一侧，跑完恢复（供复用它处读取对面配置） */
function withCalcSide(side, fn) {
  const prev = STATE.calcSide;
  STATE.calcSide = side;
  try { return fn(); } finally { STATE.calcSide = prev; }
}

/** 计算过程逐步展开 */
function calcResultBlock(side, atkSp, defSp, sk, r) {
  // 克制文案：双克制是 ×3（不是 ×4），双抵抗是 ×¼
  const zone = r.typeEff === 3 ? '×3 双克制'
    : r.typeEff === 2 ? '×2 克制'
      : r.typeEff === 1 ? '×1 普通'
        : r.typeEff === 0.5 ? '×½ 抵抗'
          : r.typeEff === 0.25 ? '×¼ 双抵抗' : `×${r.typeEff}`;
  const stabTxt = r.stab > 1 ? '×1.25（本系）' : '×1';
  const hits = r.dmg <= 0 ? '—' : (Number.isFinite(r.hits) ? `${r.hits} 下` : '—');
  return `
  <div class="calc-result${r.dmg <= 0 ? ' zero' : ''}">
    <div class="calc-flow">
      <div class="cf"><span>①有效威力</span><b>(${r.basePower} + ${r.flatAdd}) × (1 + ${(r.skillPct * 100).toFixed(0)}%) = ${fmt(r.effective)}</b></div>
      <div class="cf"><span>②显示威力</span><b>round(${fmt(r.effective)} × 本系${r.stab} × 克制${r.typeEff} × 等级${fmt(r.atkZone)}) = ${r.shown}</b></div>
      <div class="cf"><span>③等级系数</span><b>(${r.level} × 45/100 + 10) / 41 = ${r.lvCoef.toFixed(4)}</b></div>
      <div class="cf"><span>④预计伤害</span><b>floor(round(${r.atkStat} × ${r.shown} × ${r.lvCoef.toFixed(4)}) / ${r.defStat}) = ${r.dmg}</b></div>
    </div>
    <div class="calc-tags">
      <span class="pill">${r.isPhysical ? '物理' : r.isStatus ? '状态' : '魔法'}</span>
      <span class="pill">${esc(sk.type ?? '')}</span>
      <span class="pill">${zone}</span>
      <span class="pill">本系 ${stabTxt}</span>
      <span class="pill">${r.atkKey === 'patk' ? '物攻' : '魔攻'} ${r.atkStat} vs ${r.defKey === 'pdef' ? '物防' : '魔防'} ${r.defStat}</span>
    </div>
    <div class="calc-out">
      <div class="big"><span>预计伤害</span><b>${r.dmg}</b></div>
      <div class="big"><span>对方血量</span><b>${r.targetHp}</b></div>
      <div class="big"><span>占比</span><b>${(r.pct * 100).toFixed(1)}%</b></div>
      <div class="big"><span>需要</span><b>${hits}</b></div>
    </div>
    ${r.isStatus ? '<div class="desc">状态技能不造成伤害（公式里按 0 处理）</div>' : ''}
  </div>`;
}

function viewCalc() {
  const c = STATE.calc;
  const a = STATE.bySpirit.get(c.a) ?? STATE.data.spirits[0];
  const b = STATE.bySpirit.get(c.b) ?? STATE.data.spirits[0];

  // 四技能槽：第一次渲染时把两侧"伤害最高的 4 个技能"填进去，省得防守方一片空白。
  // 只在【还没自动填过】时填 —— 用户手动删空后不能再给填回来（那会让人删不掉）。
  // 换精灵时由下方 change 处理重置标记，从而对新精灵重新自动填。
  if (!loadoutInited('a') && loadoutIsEmpty('a')) { fillLoadoutWithTop('a', a, b, 4); markLoadoutInited('a'); }
  if (!loadoutInited('b') && loadoutIsEmpty('b')) { fillLoadoutWithTop('b', b, a, 4); markLoadoutInited('b'); }

  // 这一次参与计算的两项。没选技能就是 null（不高亮）——
  // 不要 fallback 成物攻，否则会误导成"这一项在参与计算"。
  const skA = c.skillA ? STATE.bySkill.get(c.skillA) : null;
  const skB = c.skillB ? STATE.bySkill.get(c.skillB) : null;
  const atkOf = (sk) => (sk ? ((sk.cat ?? '') === '魔法' ? 'satk' : 'patk') : null);
  // 攻防对应：物攻打物防、魔攻打魔防。所以"我方出招用的攻"决定"对方挨打看的防"
  const defAgainst = (atk) => (atk === null ? null : atk === 'satk' ? 'sdef' : 'pdef');
  const aAtk = atkOf(skA);
  const bAtk = atkOf(skB);
  const bDef = defAgainst(aAtk);   // A 出招 -> 打的是 B 的这个防
  const aDef = defAgainst(bAtk);   // B 出招 -> 打的是 A 的这个防

  // 排序模式：把攻击方(a)的全部技能按伤害从高到低排出来（用攻击方自己的加点配置）
  let rankBlock = '';
  if (c.sortByDamage) {
    const list = topSkillsOf('a', a, b, 12);
    const markedRank = STATE.calc.statusB.picks.includes('starfall-mark');
    rankBlock = `<div class="section"><h3>${esc(a.name)} 打 ${esc(b.name)}：伤害最高的技能 <span class="n">前 ${list.length}</span></h3>
      <div class="table-wrap"><table>
        <thead><tr><th class="mid">图标</th><th>技能</th><th class="num">威力</th><th class="mid">系别</th>
          <th class="num">显示威力</th><th class="num">预计伤害</th><th class="num">需要几下</th>
          <th class="num">星陨斩杀</th></tr></thead>
        <tbody>${list.map(({ s, r }) => `
          <tr class="clickable" data-calc-pick="${s.id}">
            <td class="mid">${skillIconTag(s.id)}</td>
            <td class="skill-name">${esc(s.name)}</td>
            <td class="num">${powerCell(s)}</td>
            <td class="mid">${s.typeId ? badge(s.typeId) : ''}</td>
            <td class="num">${r.shown}</td>
            <td class="num"><b>${r.dmg}</b></td>
            <td class="num">${r.dmg > 0 ? r.hits : '—'}</td>
            <td class="num lo-kill" title="这一招打完再触发这么多层星陨，正好能一轮打死对面">${killLayerCell(starfallKillLayers(a, b, s, { sendGlobal: false }))}</td>
          </tr>`).join('')}</tbody>
      </table></div>
      <div class="desc" style="margin-top:6px;font-size:12px">
        ${markedRank
          ? '「星陨斩杀」= 这一招 + 这么多层星陨，刚好一轮打死对面当前血量。本表用<b>裸威力</b>口径（不含固定加威力与本次技能威力%），所以和上方四技能槽那列可能不同。'
          : '「星陨斩杀」要在下面对方那侧勾上<b>星陨印记</b>并填好层数才会出数（幻系技能不触发星陨）。'}
      </div></div>`;
  }

  return `
  <div class="page-head">
    <h1>伤害计算</h1>
    <span class="sub">按官方结算顺序逐步计算：有效威力 → 显示威力 → 等级系数 → 预计伤害</span>
  </div>

  <div class="calc-panel">
    <div class="calc-global">
      <label>等级 <input type="number" id="c-level" min="1" max="100" value="${c.level}" data-calc="level"></label>
      <label>固定加威力 <input type="number" id="c-flatAdd" value="${c.flatAdd}" data-calc="flatAdd"></label>
      <label>本次技能威力% <input type="number" id="c-skillPct" value="${c.skillPct * 100}" data-calc="skillPct"></label>
      <label>攻击等级 <input type="number" id="c-atkStage" step="0.1" value="${c.atkStage}" data-calc="atkStage"></label>
      <label>对方防御等级 <input type="number" id="c-defStage" step="0.1" value="${c.defStage}" data-calc="defStage"></label>
      <label>威力乘区 <input type="number" id="c-powerMul" step="0.05" value="${c.powerMul}" data-calc="powerMul"></label>
      <label>最终乘区 <input type="number" id="c-finalMul" step="0.05" value="${c.finalMul}" data-calc="finalMul"></label>
      <label class="cb"><input type="checkbox" data-calc="sortByDamage"${c.sortByDamage ? ' checked' : ''}> 显示伤害排序</label>
    </div>

    <div class="calc-two">
      <div class="calc-col">
        <div class="calc-who atk">攻击方 A</div>
        ${calcSide('a', a, b, { atkKey: aAtk, defKey: bDef })}
      </div>
      <div class="calc-col">
        <div class="calc-who def">防御方 B</div>
        ${calcSide('b', b, a, { atkKey: bAtk, defKey: aDef })}
      </div>
    </div>

    <div class="calc-loadouts">
      ${skillLoadout('a', a, b)}
      ${skillLoadout('b', b, a)}
    </div>

    ${statusPanel(a, b)}

    <div class="desc" style="margin-top:10px;font-size:12px">
      说明：① 有效威力 = (基础威力 + 固定加威力) × (1 + 本次技能威力%)；
      ② 显示威力 = round(有效威力 × 本系 × 克制 × 攻防等级 × 威力乘区)；
      ③ 等级系数 = (等级 × 45 / 100 + 10) / 41；
      ④ 预计伤害 = floor(round(攻击 × 显示威力 × 等级系数) ÷ 防御 × 最终乘区)。
      面板值由「种族值 + 个体 + 性格」换算，血量不走这条公式。公式未含连击/减伤等进阶项。
    </div>
  </div>

  ${rankBlock}`;
}

/* ============================================================
   视图：术语
   ============================================================ */
function viewGlossary() {
  const g = STATE.data.glossary;
  const f = STATE.filters.glossary ??= { q: '' };
  const q = f.q.trim().toLowerCase();
  const list = q ? g.filter((x) => `${x.name} ${plainDesc(x.desc)} ${x.skills.join(' ')}`.toLowerCase().includes(q)) : g;
  return `
  <div class="page-head">
    <h1>术语 / 状态词条</h1>
    <span class="sub">共 ${g.length} 条 · 当前 ${list.length} 条</span>
  </div>
  <div class="panel filters"><div class="frow">
    <span class="label">搜索</span>
    <input type="search" id="glossaryQ" placeholder="中毒 / 灼烧 / 先手 …" value="${esc(f.q)}">
  </div></div>
  ${list.length ? `<div class="glossary">${list.map((x) => `
    <div class="gitem">
      <h4>${esc(x.name)}</h4>
      <p>${glossaryTag(x.desc)}</p>
      ${x.n ? `<div class="used">被 ${x.n} 个技能引用${x.skills.length ? '：' + x.skills.slice(0, 6).map(esc).join('、') + (x.skills.length > 6 ? '…' : '') : ''}</div>` : ''}
    </div>`).join('')}</div>` : '<div class="empty">没有匹配的词条</div>'}

  <div class="section"><h3>性格速查 <span class="n">30 种 · 每种提升 1 项、降低 1 项</span></h3>
    <div class="table-wrap"><table>
      <thead><tr><th>性格</th><th class="mid">加成</th><th class="mid">削弱</th><th>性格描述</th></tr></thead>
      <tbody>${NATURES.map(([n, up, down, desc]) => `
        <tr>
          <td><b>${esc(n)}</b></td>
          <td class="mid"><span class="nv-up">${STAT_LABEL6[up]} ▲</span></td>
          <td class="mid"><span class="nv-down">${STAT_LABEL6[down]} ▼</span></td>
          <td class="desc">${esc(desc)}</td>
        </tr>`).join('')}</tbody>
    </table></div>
    <div class="desc" style="margin-top:6px;font-size:12px">
      加成 ×${NATURE_MULT.up}、削弱 ×${NATURE_MULT.down}；本作生命也受性格影响。
      在精灵详情里可以逐项开关（「性格+」整列至多一项、「性格−」整列至多一项，同一项不能既加又减）。
    </div>
  </div>`;
}

/* ============================================================
   详情弹窗
   ============================================================ */
function openModal(html) {
  $('#modalBody').innerHTML = html;
  $('#modal').hidden = false;
  $('.modal-panel').scrollTop = 0;
  document.body.style.overflow = 'hidden';
  // 弹窗内容不会走 bindView()，所以这里给弹窗内的控件绑事件
  // （详情页的加点面板就靠这一步，否则按钮点了没反应）
  bindNatalBlock();
}
function closeModal() {
  $('#modal').hidden = true;
  document.body.style.overflow = '';
}
$('#modal').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });

/* ---------------------------------------------------------- 六维雷达图
   用固定上限缩放（和横条图一致），所以不同精灵之间可以横向比较形状；
   若改用"该精灵自身最大值"归一化，形状会好看但失去可比性。
   数值为 0 时给一点最小半径，否则顶点会塌到圆心看不出是哪一项。
   ------------------------------------------------------------------ */
function radarChart(stats) {
  const SIZE = 240, C = SIZE / 2, R = 78;      // 半径留出标签空间
  const n = STAT_KEYS.length;
  const ang = (i) => (-90 + i * (360 / n)) * Math.PI / 180;   // 从正上方开始，顺时针
  const pt = (i, r) => [C + Math.cos(ang(i)) * r, C + Math.sin(ang(i)) * r];
  const f = (x) => x.toFixed(1);

  // 网格：25% 一档，共 4 圈
  const rings = [0.25, 0.5, 0.75, 1].map((k) => {
    const d = Array.from({ length: n }, (_, i) => pt(i, R * k)).map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join(' ') + ' Z';
    return `<path class="radar-ring" d="${d}"/>`;
  }).join('');

  // 六条轴线
  const spokes = Array.from({ length: n }, (_, i) => {
    const [x, y] = pt(i, R);
    return `<line class="radar-spoke" x1="${C}" y1="${C}" x2="${f(x)}" y2="${f(y)}"/>`;
  }).join('');

  // 数据多边形：每项按自己的参考上限缩放
  const points = STAT_KEYS.map(({ stat }, i) => {
    const v = Math.max(0, stats[stat] ?? 0);
    const ratio = Math.min(1, v / (STAT_MAX[stat] ?? 250));
    return pt(i, R * Math.max(0.09, ratio));
  });
  const poly = points.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join(' ') + ' Z';
  const dots = points.map(([x, y], i) =>
    `<circle class="radar-dot s-${STAT_KEYS[i].stat}" cx="${f(x)}" cy="${f(y)}" r="3"/>`).join('');

  // 外侧标签：图标（当 CSS mask 用，按数值染色）+ 数值
  // 图标来自 stat_icons 表，键名是上游完整名，靠 ICON_KEY 映射。
  const labels = STAT_KEYS.map(({ stat, label }, i) => {
    const [x, y] = pt(i, R + 24);
    const v = stats[stat] ?? 0;
    const ratio = Math.min(1, Math.max(0, v / (STAT_MAX[stat] ?? 250)));
    const icon = STATE.statIconByStat.get(ICON_KEY[stat] ?? stat);
    const anchor = Math.abs(x - C) < 8 ? 'middle' : (x > C ? 'start' : 'end');
    // 染色的比例：数值越低越淡（对应原站的 --stat-tint-high/low）
    const tint = `--tint:${(ratio * 100).toFixed(0)}%`;
    if (icon) {
      const maskUrl = esc(icon.icon || icon.iconOnline);
      return `<g class="radar-node" style="${tint}">
        <rect class="radar-icon" x="${f(x - 12)}" y="${f(y - 21)}" width="24" height="24"
              style="-webkit-mask-image:url('${maskUrl}');mask-image:url('${maskUrl}')"/>
        <text class="radar-val" x="${f(x)}" y="${f(y + 13)}" text-anchor="${anchor}" dominant-baseline="middle">${v}</text>
      </g>`;
    }
    return `<text class="radar-label" x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" dominant-baseline="middle">${label} <tspan class="radar-val">${v}</tspan></text>`;
  }).join('');

  // 每根轴上的"参考上限"虚线圈：直观看出哪项接近上限、哪项还差得远
  const capMarks = STAT_KEYS.map(({ stat }, i) => {
    const [x, y] = pt(i, R);
    return `<circle class="radar-cap" cx="${f(x)}" cy="${f(y)}" r="2.5"><title>${STAT_LABEL6[stat] ?? stat} 参考上限 ${STAT_MAX[stat] ?? 250}</title></circle>`;
  }).join('');

  return `<svg class="radar" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="六维面板雷达图：${STAT_KEYS.map(({ stat, label }) => `${label} ${stats[stat] ?? 0}`).join('，')}">
    ${rings}${spokes}
    <path class="radar-area" d="${poly}"/>
    ${dots}${capMarks}${labels}
  </svg>`;
}

/**
 * 血脉技能区块：每只精灵可选 18 种血脉，每种血脉给 1 个专属技能。
 * 数据不在 spirit_skill 里（那里的 source_type 只有 level/machine/passive/legendary），
 * 而是来自 spirit_bloodlines（源数据是详情 JSON 的 bloodline_options）。
 * 默认只显示前 6 种，其余点「展开」看 —— 18 行会让弹窗太长。
 */
const BLOODLINE_PREVIEW = 6;

function bloodlineSection(sp) {
  const list = STATE.data.spiritBloodlines?.[`${sp.id}:${sp.formId}`] ?? [];
  if (!list.length) return '';
  const expanded = !!STATE.expandedBloodlines;
  const shown = expanded ? list : list.slice(0, BLOODLINE_PREVIEW);
  const meta = STATE.data.meta.bloodlines ?? {};
  const skillIcons = STATE.data.meta.bloodlineSkillIcons ?? {};
  // 行的图标/名称/秘药都从 meta 按 bloodline_id 查（导出时做了去重，省 2 MB+）
  const rows = shown.map((b) => {
    const m = meta[b.id] ?? {};
    const icon = m.icon, itemIcon = m.itemIcon, item = m.item;
    const sIcon = b.skillId ? skillIcons[b.skillId] : null;
    return `
    <tr>
      <td class="mid">${icon ? `<span class="bl-icon">${imgTag(icon, null, m.name ?? '')}</span>` : ''}</td>
      <td>${esc(m.name ?? '')}</td>
      <td class="mid">${sIcon ? imgTag(sIcon, null, b.skill ?? '', 'skill-icon') : ''}</td>
      <td class="skill-name">${b.skillId ? `<span class="clickable-inline" data-skill="${b.skillId}">${esc(b.skill)}</span>` : '<span class="desc">—</span>'}</td>
      <td class="num">${b.lv ?? '—'}</td>
      <td class="mid">${b.skillId ? badge(STATE.bySkill.get(b.skillId)?.typeId) : ''}</td>
      <td class="mid">${itemIcon ? `<span class="bl-item" title="${esc(item ?? '')}">${imgTag(itemIcon, null, item ?? '')}</span>` : esc(item ?? '')}</td>
    </tr>`;
  }).join('');

  const withSkill = list.filter((b) => b.skillId).length;
  return `<div class="section">
    <h3>血脉技能 <span class="n">${list.length} 种血脉${withSkill ? `，其中 ${withSkill} 种各给 1 个专属技能` : ''}</span>
      ${list.length > BLOODLINE_PREVIEW ? `<button class="link-btn" id="toggleBloodline">${expanded ? '收起' : `展开全部 ${list.length} 种`}</button>` : ''}
    </h3>
    <div class="table-wrap"><table>
      <thead><tr><th class="mid">血脉</th><th>名称</th><th class="mid">技能图标</th><th>给予技能</th><th class="num">解锁</th><th class="mid">系别</th><th class="mid">秘药</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="desc" style="margin-top:6px;font-size:12px">
      血脉会替换技能栏中的一个技能为对应血脉技能；显示的是每只精灵各自的专属搭配（不同精灵同一种血脉给的技能可能不同）。
    </div>
  </div>`;
}

function spiritDetail(key, lvFromSkillId = null) {
  const sp = STATE.bySpirit.get(key);
  if (!sp) return toast('找不到这只精灵');
  STATE.currentSpirit = key;          // 供「展开血脉」重画时定位当前精灵
  const skills = spiritSkillsOf(sp);
  // 雷达图 + 数值条 + 加点控件：按这只精灵自己的配置实时重算
  const statBlock = natalBlock(sp, spiritCalcOf(sp));

  const skillTable = (arr, withLv) => arr.length ? `
    <div class="table-wrap"><table>
      <thead><tr><th class="mid">图标</th>${withLv ? '<th class="num">Lv</th>' : ''}<th>技能</th><th class="num">威力</th>
        <th class="num">能耗</th><th class="mid">分类</th><th class="mid">系别</th><th>效果</th></tr></thead>
      <tbody>${arr.map((s) => `
        <tr class="clickable" data-skill="${s.id}">
          <td class="mid">${skillIconTag(s.id)}</td>
          ${withLv ? `<td class="num">${s.lv ?? '—'}</td>` : ''}
          <td class="skill-name">${esc(s.name)}${lvFromSkillId === s.id ? ' <span class="pill">当前</span>' : ''}</td>
          <td class="num">${powerCell(s)}</td><td class="num">${s.energy ?? ''}</td>
          <td class="mid">${catPill(s.cat)}</td><td class="mid">${s.typeId ? badge(s.typeId) : ''}</td>
          <td class="desc">${glossaryTag(s.desc)}</td></tr>`).join('')}</tbody>
    </table></div>` : '<div class="desc">无</div>';

  const evo = evoChain(sp);
  const family = (sp.family ?? []).filter(Boolean);

  openModal(`
    <div class="detail-head">
      <div class="art">${imgTag(sp.img, sp.imgOnline, sp.name)}</div>
      <div class="info">
        <h2>${esc(sp.name)}${sp.form ? ` <span class="pill">${esc(sp.form)}</span>` : ''}</h2>
        <div class="id">图鉴编号 #${sp.id} · 形态 ${sp.formId}${sp.stage ? ` · 进化阶段 ${sp.stage}` : ''}</div>
        <div class="trow" style="margin:8px 0">${badges(sp.types)}</div>
        <div class="meta">
          <span>种族值总和 <b>${sp.bst}</b></span>
          <span>技能 ${sp.skills} 个</span>
          ${sp.eggs.length ? `<span>蛋组 ${esc(sp.eggs.join('、'))}</span>` : ''}
        </div>
        ${statBlock}
      </div>
    </div>

    ${sp.passive ? `<div class="section"><h3>被动技能（特性）</h3>
      <div class="passive">
        ${sp.passive.icon ? `<span class="passive-icon">${imgTag(sp.passive.icon, null, sp.passive.name)}</span>` : ''}
        <span><b>${esc(sp.passive.name)}</b> — ${glossaryTag(sp.passive.desc)}</span>
      </div></div>` : ''}

    ${evo ? `<div class="section"><h3>进化链</h3><div class="evo">${evo}</div></div>` : ''}

    <div class="section"><h3>升级学会 <span class="n">${skills.level.length}</span></h3>${skillTable(skills.level, true)}</div>
    ${skills.legendary.length ? `<div class="section"><h3>传说技能 <span class="n">${skills.legendary.length}</span></h3>${skillTable(skills.legendary, false)}</div>` : ''}
    ${skills.machine.length ? `<div class="section"><h3>技能石 <span class="n">${skills.machine.length}</span></h3>${skillTable(skills.machine, false)}</div>` : ''}

    ${bloodlineSection(sp)}

    ${family.length > 1 ? `<div class="section"><h3>同族</h3><div class="evo">${family.map((f) => {
      const m = /^#(\d+)(.*)$/.exec(f);
      if (!m) return `<span class="pill">${esc(f)}</span>`;
      const other = STATE.bySpirit.get(`${m[1]}:1`);
      return `<div class="node${String(other?.id) === String(sp.id) && sp.formId === 1 ? ' cur' : ''}" data-spirit="${m[1]}:1">
        ${other ? imgTag(other.head, other.headOnline, other.name) : ''}<span>${esc(m[2] || ('#' + m[1]))}</span></div>`;
    }).join('<span class="arrow">·</span>')}</div></div>` : ''}

    <div class="section"><h3>快捷链接</h3>
      <div class="frow">
        <button class="chip" data-copy="${esc(sp.name)}">复制名称</button>
      </div>
    </div>
  `);
}

// 进化链：用「同族成员的进化路线」拼不出完整链，这里退化为同编号各形态 + 同族
function evoChain(sp) {
  const forms = STATE.data.spirits.filter((x) => x.id === sp.id);
  if (forms.length <= 1) return '';
  return forms.map((f) => `
    <div class="node${f.formId === sp.formId ? ' cur' : ''}" data-spirit="${f.id}:${f.formId}">
      ${imgTag(f.head, f.headOnline, f.name)}<span>${esc(f.form || '默认')}</span></div>`).join('');
}

/** 术语词条弹窗（点描述里的术语标签时弹出，不会丢掉当前详情） */
function glossaryDetail(noteId) {
  const g = STATE.glossaryById.get(Number(noteId));
  if (!g) return;
  const related = (g.skills ?? []).slice(0, 40);
  openModal(`
    <div class="detail-head">
      <div class="info">
        <h2>${esc(g.name)} <span class="pill">术语 #${g.id}</span></h2>
        <div class="desc" style="margin-top:8px;font-size:14px">${glossaryTag(g.desc)}</div>
      </div>
    </div>
    ${g.n ? `<div class="section"><h3>引用它的技能 <span class="n">${g.n}</span></h3>
      <div class="frow">${related.map((n) => `<span class="pill">${esc(n)}</span>`).join('')}${g.n > related.length ? `<span class="pill">…等 ${g.n} 个</span>` : ''}</div>
    </div>` : ''}
    <div class="section"><h3>快捷链接</h3><div class="frow">
      <button class="chip" id="gotoGlossary">在术语页查看全部</button>
    </div></div>
  `);
  $('#gotoGlossary')?.addEventListener('click', () => {
    closeModal();
    STATE.filters.glossary = { q: g.name };
    location.hash = '#/glossary';
    render();
  });
}

function skillDetail(skillId, ownerKey = null) {
  const sk = STATE.bySkill.get(skillId);
  if (!sk) return toast('找不到这个技能');
  const learners = learnersOf(skillId);
  const groups = { level_up: [], spirit_stone: [], bloodline_elixir: [] };
  for (const l of learners) (groups[l.group] ??= []).push(l);
  const owner = ownerKey ? STATE.bySpirit.get(ownerKey) : null;

  const groupBlock = (key) => {
    const arr = groups[key] ?? [];
    if (!arr.length) return '';
    const sorted = arr.slice().sort((a, b) => (a.lv ?? 999) - (b.lv ?? 999) || a.name.localeCompare(b.name, 'zh'));
    return `<div class="section"><h3>${GROUP_LABEL[key]} <span class="n">${arr.length}</span></h3>
      <div class="table-wrap"><table>
        <thead><tr><th class="mid">头像</th><th>精灵</th><th class="num">解锁等级</th><th class="mid">形态</th><th class="mid">系别</th></tr></thead>
        <tbody>${sorted.map((l) => {
          const sp = l.sp;
          // 头像从精灵表查（导出时不再给每条学习者记录重复存路径，省 2 MB）
          const head = sp?.head, headOnline = sp?.headOnline;
          return `<tr class="clickable" data-spirit="${l.id}:${l.formId}">
            <td class="mid">${head || headOnline ? imgTag(head, headOnline, l.name, 'spirit-head') : ''}</td>
            <td class="skill-name">${esc(l.name)}${owner && l.id === owner.id ? ' <span class="pill">当前</span>' : ''}</td>
            <td class="num">${l.lv ?? '—'}</td>
            <td class="mid">${esc(l.form || '默认')}</td>
            <td class="mid">${sp ? badges(sp.types) : ''}</td></tr>`;
        }).join('')}</tbody></table></div></div>`;
  };

  openModal(`
    <div class="detail-head">
      <div class="art" style="width:120px;height:120px">${imgTag(sk.img, sk.imgOnline, sk.name)}</div>
      <div class="info">
        <h2>${esc(sk.name)}</h2>
        <div class="trow" style="margin:8px 0">${sk.typeId ? badge(sk.typeId) : ''}${catPill(sk.cat)}</div>
        <div class="kv" style="margin-top:10px">
          <span class="k">威力</span><span class="v">${sk.dmgMax ?? '—'}${sk.powerIsVariable ? ' <span class="pill">可变</span>（基础威力，实际随效果变化）' : ''}</span>
          <span class="k">能耗</span><span class="v">${sk.energy ?? '—'}</span>
          <span class="k">冷却</span><span class="v">${sk.cdMin === sk.cdMax ? (sk.cdMin ?? '—') : `${sk.cdMin} ~ ${sk.cdMax}`}</span>
          <span class="k">学习途径</span><span class="v">${esc((sk.src || '').split(' / ').map((x) => SRC_LABEL[x] ?? x).join('、') || '—')}</span>
          <span class="k">可学精灵</span><span class="v">${sk.n} 只（${sk.uses ?? 0} 个编号）</span>
        </div>
      </div>
    </div>
    <div class="section"><h3>效果</h3><div class="passive">${glossaryTag(sk.desc)}</div></div>
    ${groupBlock('level_up')}${groupBlock('spirit_stone')}${groupBlock('bloodline_elixir')}
    <div class="section"><h3>快捷链接</h3><div class="frow">
      <button class="chip" data-copy="${esc(sk.name)}">复制名称</button>
    </div></div>
  `);
}

/* ============================================================
   全局搜索
   ============================================================ */
function runSearch(q) {
  const kw = q.trim().toLowerCase();
  if (kw.length < 1) return [];
  const out = [];
  for (const s of STATE.data.spirits) {
    if (s.formId !== 1) continue;
    if (`${s.id} ${s.name}`.toLowerCase().includes(kw)) out.push({ kind: 'spirit', ...s });
    if (out.length > 8) break;
  }
  for (const s of STATE.data.skills) {
    if (s.name.toLowerCase().includes(kw)) out.push({ kind: 'skill', ...s });
    if (out.filter((x) => x.kind === 'skill').length > 8) break;
  }
  const gl = STATE.data.glossary.filter((g) => `${g.name} ${plainDesc(g.desc)}`.toLowerCase().includes(kw)).slice(0, 3);
  return { out, gl };
}

function renderSearch(q) {
  const box = $('#searchSuggest');
  const { out, gl } = runSearch(q);
  if (!q.trim() || (!out.length && !gl.length)) { box.hidden = true; STATE.searchItems = []; return; }
  const items = [];
  const html = [];
  const spirits = out.filter((x) => x.kind === 'spirit');
  const skills = out.filter((x) => x.kind === 'skill');
  if (spirits.length) {
    html.push('<div class="grp">精灵</div>');
    for (const s of spirits) {
      items.push({ type: 'spirit', key: `${s.id}:1` });
      html.push(`<div class="item" data-i="${items.length - 1}">
        ${imgTag(s.head, s.headOnline, s.name)}
        <span><b>${esc(s.name)}</b> <span class="desc">#${s.id}</span></span>
        <span style="margin-left:auto">${badges(s.types)}</span></div>`);
    }
  }
  if (skills.length) {
    html.push('<div class="grp">技能</div>');
    for (const s of skills) {
      items.push({ type: 'skill', key: s.id });
      html.push(`<div class="item" data-i="${items.length - 1}">
        ${imgTag(s.img, s.imgOnline, s.name)}
        <span><b>${esc(s.name)}</b> <span class="desc">${esc(s.cat || '')}</span></span>
        <span style="margin-left:auto">${s.typeId ? badge(s.typeId) : ''}</span></div>`);
    }
  }
  if (gl.length) {
    html.push('<div class="grp">术语</div>');
    for (const g of gl) {
      items.push({ type: 'glossary', key: g.name });
      html.push(`<div class="item" data-i="${items.length - 1}"><span><b>${esc(g.name)}</b>
        <span class="desc">${esc(plainDesc(g.desc).slice(0, 40))}…</span></span></div>`);
    }
  }
  STATE.searchItems = items;
  STATE.searchSel = -1;
  box.innerHTML = html.join('');
  box.hidden = false;
}

function selectSearch(i) {
  const it = STATE.searchItems[i];
  if (!it) return;
  $('#searchSuggest').hidden = true;
  if (it.type === 'spirit') spiritDetail(it.key);
  else if (it.type === 'skill') skillDetail(it.key);
  else {
    location.hash = '#/glossary';
    STATE.filters.glossary = { q: it.key };
    render();
  }
}

/* ============================================================
   渲染 & 事件
   ============================================================ */
function render() {
  const app = $('#app');
  if (!STATE.data) return;
  const fns = { spirits: viewSpirits, skills: viewSkills, types: viewTypes, calc: viewCalc, glossary: viewGlossary };
  app.innerHTML = (fns[STATE.view] ?? viewSpirits)();
  bindView();
}

function bindView() {
  const app = $('#app');

  // 伤害计算器：改任一项就重算（只重画计算区，不整页刷新）
  const calcEl = $('#app .calc-panel');
  if (calcEl) {
    const refresh = () => { render(); };
    for (const el of document.querySelectorAll('[data-calc]')) {
      const key = el.dataset.calc;
      if (el.type === 'checkbox') {
        el.addEventListener('change', () => {
          STATE.calc[key] = el.checked;
          if (key === 'sortByDamage') refresh(); else render();
        });
      } else if (el.tagName === 'SELECT') {
        el.addEventListener('change', () => {
          const v = el.value;
          if (key === 'spirit') {
            const side = el.dataset.side;
            STATE.calc[side] = v;
            STATE.calc.skillA = null; STATE.calc.skillB = null;
            // 换了精灵：清掉该侧四技能槽并允许重新自动填（否则会留着上一只的技能）
            resetLoadoutInit(side);
          }
          else if (key === 'skill') STATE.calc[el.dataset.side === 'a' ? 'skillA' : 'skillB'] = v ? Number(v) : null;
          // 注意：性格/个体不在下拉里了 —— 改成和详情页同一套「个体按钮 + 性格逐项开关」，
          // 由 bindNatalBlock() 负责绑定（见下方 bindNatalBlock()）
          refresh();
        });
      } else {
        el.addEventListener('input', debounce(() => {
          const raw = el.value === '' ? '' : Number(el.value);
          // 血量已统一到状态面板的百分比滑块，这里不再处理 data-calc="hp"
          if (key === 'skillPct') STATE.calc.skillPct = (raw === '' ? 0 : raw) / 100;
          else if (raw !== '') STATE.calc[key] = raw;
          // 只重画结果区，避免输入框失焦
          softRerender('calc');
        }, 200));
      }
    }
    // 两侧的六维卡片区（与详情页同一套交互）
    bindStatCards();
    // 「清空」按钮：把该侧六项都清回初始
    for (const btn of document.querySelectorAll('[data-calc-reset]')) {
      btn.addEventListener('click', () => {
        const side = btn.dataset.calcReset;
        const sp = STATE.bySpirit.get(STATE.calc[side]);
        if (!sp) return;
        const c = withCalcSide(side, () => spiritCalcOf(sp));
        for (const k of STAT_ORDER) c.stats[k] = { iv: 0, nature: 'neutral' };
        render();
      });
    }
    // 伤害排序表里点一行 = 用那个技能（同时放进 A 侧第一个空位）
    for (const tr of document.querySelectorAll('[data-calc-pick]')) {
      tr.addEventListener('click', () => {
        const id = Number(tr.dataset.calcPick);
        STATE.calc.skillA = id;
        pushLoadout('a', id);
        render();
      });
    }
    // 四技能槽：改威力 / 连击
    const loCommit = (el, arrName) => {
      el.addEventListener('change', () => {
        const [side, i] = el.dataset[arrName === 'pow' ? 'loPow' : 'loHit'].split(':');
        const arr = (side === 'a' ? (arrName === 'pow' ? STATE.calc.powA : STATE.calc.hitA)
          : (arrName === 'pow' ? STATE.calc.powB : STATE.calc.hitB));
        let v = Number(el.value);
        if (!Number.isFinite(v)) v = arrName === 'pow' ? null : 1;
        arr[Number(i)] = arrName === 'pow' ? (v === null ? null : Math.max(0, Math.round(v))) : Math.max(1, Math.min(9, Math.round(v)));
        render();
      });
    };
    for (const el of document.querySelectorAll('[data-lo-pow]')) loCommit(el, 'pow');
    for (const el of document.querySelectorAll('[data-lo-hit]')) loCommit(el, 'hit');
    // 四技能槽：移除
    for (const btn of document.querySelectorAll('[data-lo-del]')) {
      btn.addEventListener('click', () => {
        const [side, i] = btn.dataset.loDel.split(':');
        const idx = Number(i);
        const load = side === 'a' ? STATE.calc.loadA : STATE.calc.loadB;
        const pows = side === 'a' ? STATE.calc.powA : STATE.calc.powB;
        const hits = side === 'a' ? STATE.calc.hitA : STATE.calc.hitB;
        load[idx] = null; pows[idx] = null; hits[idx] = 1;
        render();
      });
    }

    // 状态面板：选中 / 移除状态
    for (const btn of document.querySelectorAll('[data-st-pick]')) {
      btn.addEventListener('click', () => {
        const [side, key] = btn.dataset.stPick.split(':');
        const st = side === 'a' ? STATE.calc.statusA : STATE.calc.statusB;
        st.picks = st.picks.includes(key) ? st.picks.filter((x) => x !== key) : [...st.picks, key];
        render();
      });
    }
    for (const btn of document.querySelectorAll('[data-st-drop]')) {
      btn.addEventListener('click', () => {
        const [side, key] = btn.dataset.stDrop.split(':');
        const st = side === 'a' ? STATE.calc.statusA : STATE.calc.statusB;
        st.picks = st.picks.filter((x) => x !== key);
        render();
      });
    }
    // 状态面板：攻击因子（会进伤害计算，所以改完要重算）
    for (const el of document.querySelectorAll('[data-st-mod]')) {
      el.addEventListener('change', () => {
        const [side, key] = el.dataset.stMod.split(':');
        const mods = side === 'a' ? STATE.calc.modsA : STATE.calc.modsB;
        let v = Number(el.value);
        if (!Number.isFinite(v)) v = key === 'finalPct' ? 100 : 0;
        if (key === 'finalPct') v = Math.max(0, v);
        mods[key] = Math.round(v);
        render();
      });
    }
    // 状态面板：血量百分比。
    // ⚠ 拖动过程中**只改数据 + 就地更新几个 DOM 节点，绝不重渲染** ——
    //   重渲染会把正在拖的那个 range 换成新节点，浏览器随即丢失拖动状态，
    //   表现就是"拖两下就断"，非常卡手（踩过）。
    for (const el of document.querySelectorAll('[data-st-hp]')) {
      el.addEventListener('input', () => {
        const side = el.dataset.stHp;
        const v = Math.max(0, Math.min(100, Number(el.value) || 0));
        if (side === 'a') STATE.calc.hpPctA = v; else STATE.calc.hpPctB = v;
        // 就地刷新：百分比、当前/总量、进度条宽度
        const box = el.closest('.st-hp');
        if (box) {
          const sp = STATE.bySpirit.get(STATE.calc[side]);
          const max = hpMaxOf(side, sp);
          const cur = Math.round((max * v) / 100);
          const pctEl = box.querySelector('.st-hp-pct');
          const maxEl = box.querySelector('.st-hp-max');
          const fillEl = box.querySelector('.st-hp-bar i');
          if (pctEl) pctEl.textContent = `${v}%`;
          if (maxEl) maxEl.textContent = `${cur}/${max}`;
          if (fillEl) fillEl.style.width = `${v}%`;
        }
      });
      // 松手后再整体重算（让伤害结果跟上），此时拖动已结束，重渲染不影响手感
      el.addEventListener('change', () => { softRerender('calc'); });
    }
    // 状态面板：星陨层数（上限 99；与「状态造成的伤害」里那行共用同一份数据）
    for (const el of document.querySelectorAll('[data-st-star]')) {
      el.addEventListener('change', () => {
        const side = el.dataset.stStar;
        const v = Math.max(0, Math.min(99, Math.round(Number(el.value) || 0)));
        const st = side === 'a' ? STATE.calc.statusA : STATE.calc.statusB;
        st.star = v;
        // 星陨印记那行的层数跟着同步，免得同一件事出现两个数
        st.layers ??= {};
        st.layers['starfall-mark'] = v;
        render();
      });
    }
    // 状态伤害：层数（上限 99）
    for (const el of document.querySelectorAll('[data-st-layers]')) {
      el.addEventListener('change', () => {
        const [side, key] = el.dataset.stLayers.split(':');
        const st = side === 'a' ? STATE.calc.statusA : STATE.calc.statusB;
        const v = Math.max(0, Math.min(99, Math.round(Number(el.value) || 0)));
        // 星陨层数统一写在 st.star（面板上那个输入框也读它）
        if (key === 'starfall-mark') st.star = v;
        st.layers ??= {};
        st.layers[key] = v;
        render();
      });
    }
    // 状态伤害：每层百分比（可改，默认取词条描述里的数）
    for (const el of document.querySelectorAll('[data-st-pct]')) {
      el.addEventListener('change', () => {
        const [side, key] = el.dataset.stPct.split(':');
        const pcts = side === 'a' ? STATE.calc.statusPctA : STATE.calc.statusPctB;
        let v = Number(el.value);
        if (!Number.isFinite(v)) v = STATUS_EFFECTS[key]?.pct ?? 0;
        pcts[key] = Math.max(0, v);
        render();
      });
    }
    // 状态面板：重置（清掉两侧选中的状态、层数、攻击因子、血量、百分比覆盖）
    document.querySelector('[data-st-reset]')?.addEventListener('click', () => {
      STATE.calc.statusA = { picks: [], star: 0, layers: {} };
      STATE.calc.statusB = { picks: [], star: 0, layers: {} };
      STATE.calc.statusPctA = {}; STATE.calc.statusPctB = {};
      STATE.calc.modsA = { patkPct: 0, satkPct: 0, pdefPct: 0, sdefPct: 0, spdAdd: 0, powerPct: 0, powerAdd: 0, finalPct: 100 };
      STATE.calc.modsB = { patkPct: 0, satkPct: 0, pdefPct: 0, sdefPct: 0, spdAdd: 0, powerPct: 0, powerAdd: 0, finalPct: 100 };
      STATE.calc.hpPctA = 100; STATE.calc.hpPctB = 100;
      render();
    });
    // 状态面板：「？异常与印记」说明
    document.querySelector('[data-st-help]')?.addEventListener('click', () => statusHelpDialog());

    // 精灵选择：展开/收起
    for (const btn of document.querySelectorAll('[data-calc-picker]')) {
      btn.addEventListener('click', () => {
        const side = btn.dataset.calcPicker;
        STATE.calc.spOpen = STATE.calc.spOpen === side ? null : side;
        render();
      });
    }
    // 精灵选择：搜索框（输入后只重画下拉，避免整页刷新丢焦点）
    for (const el of document.querySelectorAll('[data-calc-picker-q]')) {
      el.addEventListener('input', debounce(() => {
        const side = el.dataset.calcPickerQ;
        STATE.calc.spQuery[side] = el.value;
        const panel = el.parentNode;
        // 只换列表部分，输入框保持焦点
        const box = document.querySelector('.calc-picker-panel');
        if (panel && box) {
          const q = el.value.trim().toLowerCase();
          const cur = STATE.calc[side];
          const all = STATE.data.spirits
            .filter((s) => (!q ? true : `${s.id} ${s.name}${s.form ? '·' + s.form : ''}`.toLowerCase().includes(q)))
            .slice(0, 60);
          const listEl = panel.querySelector('.calc-picker-list');
          if (listEl) {
            listEl.innerHTML = all.length ? all.map((s) => {
              const key = `${s.id}:${s.formId}`;
              const nm = `#${s.id} ${s.name}${s.form ? '·' + s.form : ''}`;
              return `<button type="button" class="calc-picker-item${key === cur ? ' on' : ''}"
                data-calc-pick-spirit="${side}:${key}">${esc(nm)}</button>`;
            }).join('') : '<div class="desc" style="padding:6px">没有匹配的精灵</div>';
            bindSpiritPickerItems();
          }
        }
      }, 120));
    }
    bindSpiritPickerItems();
  }

  // 详情弹窗里的加点面板：改完只重画面板本身（不重画整个弹窗，避免滚动位置丢失）
  bindNatalBlock();


  // 精灵筛选
  const sq = $('#spiritQ');
  if (sq) {
    sq.addEventListener('input', debounce(() => { STATE.filters.spirits.q = sq.value; softRerender('spirits'); }));
    $('#spiritSort')?.addEventListener('change', (e) => { STATE.filters.spirits.sort = e.target.value; render(); });
    $('#spiritDir')?.addEventListener('change', (e) => { STATE.filters.spirits.dir = Number(e.target.value); render(); });
    $('#showForms')?.addEventListener('change', (e) => { STATE.filters.spirits.forms = e.target.checked; render(); });
    $('#resetSpirits')?.addEventListener('click', () => {
      STATE.filters.spirits = { q: '', types: new Set(), sort: 'id', dir: 1, forms: false };
      $('#spiritQ').value = '';
      render();
    });
  }
  // 技能筛选
  const kq = $('#skillQ');
  if (kq) {
    kq.addEventListener('input', debounce(() => { STATE.filters.skills.q = kq.value; softRerender('skills'); }));
    $('#minDmg')?.addEventListener('input', debounce((e) => { STATE.filters.skills.minDmg = e.target.value; softRerender('skills'); }));
    $('#maxEnergy')?.addEventListener('input', debounce((e) => { STATE.filters.skills.maxEnergy = e.target.value; softRerender('skills'); }));
    $('#resetSkills')?.addEventListener('click', () => {
      STATE.filters.skills = { q: '', types: new Set(), cats: new Set(), sort: 'id', dir: 1, minDmg: '', maxEnergy: '' };
      render();
    });
  }
  const gq = $('#glossaryQ');
  if (gq) gq.addEventListener('input', debounce(() => { STATE.filters.glossary.q = gq.value; softRerender('glossary'); }));
}

// 输入时只重画列表，避免输入框失焦
function softRerender(view) {
  const active = document.activeElement;
  const selStart = active?.selectionStart;
  const id = active?.id;
  render();
  if (id) {
    const el = document.getElementById(id);
    if (el) { el.focus(); if (selStart != null && el.setSelectionRange) { try { el.setSelectionRange(selStart, selStart); } catch {} } }
  }
}

function debounce(fn, ms = 160) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// 事件委托
document.addEventListener('click', (e) => {
  const chipType = e.target.closest('[data-type]');
  if (chipType) {
    const id = Number(chipType.dataset.type);
    const set = STATE.filters.spirits.types;
    set.has(id) ? set.delete(id) : set.add(id);
    return render();
  }
  const chipSType = e.target.closest('[data-stype]');
  if (chipSType) {
    const id = Number(chipSType.dataset.stype);
    const set = STATE.filters.skills.types;
    set.has(id) ? set.delete(id) : set.add(id);
    return render();
  }
  const chipCat = e.target.closest('[data-cat]');
  if (chipCat) {
    const c = chipCat.dataset.cat;
    const set = STATE.filters.skills.cats;
    set.has(c) ? set.delete(c) : set.add(c);
    return render();
  }
  const sortTh = e.target.closest('th[data-sort]');
  if (sortTh) {
    const f = STATE.filters.skills;
    const key = sortTh.dataset.sort;
    if (f.sort === key) f.dir = -f.dir; else { f.sort = key; f.dir = key === 'name' ? 1 : -1; }
    return render();
  }
  const spiritEl = e.target.closest('[data-spirit]');
  if (spiritEl) return spiritDetail(spiritEl.dataset.spirit);
  const skillEl = e.target.closest('[data-skill]');
  if (skillEl) {
    const ownerEl = e.target.closest('[data-spirit]');
    return skillDetail(Number(skillEl.dataset.skill));
  }
  const copyEl = e.target.closest('[data-copy]');
  if (copyEl) {
    navigator.clipboard?.writeText(copyEl.dataset.copy)
      .then(() => toast(`已复制：${copyEl.dataset.copy}`))
      .catch(() => toast('复制失败，请手动选择'));
    return;
  }
  const termEl = e.target.closest('[data-glossary]');
  if (termEl) return glossaryDetail(termEl.dataset.glossary);
  const sug = e.target.closest('#searchSuggest .item');
  if (sug) return selectSearch(Number(sug.dataset.i));
  if (!e.target.closest('#globalSearch')) $('#searchSuggest').hidden = true;
});

/* ---------------------------------------------------------- 加点面板（详情弹窗 & 伤害计算两侧共用） */
/**
 * 找加点面板。scope：
 *   undefined  -> 弹窗里那一个（#modalBody 内部）
 *   'a' / 'b'  -> 伤害计算对应那一侧的那个（容器在 #app 内，带 data-calc-side）
 * ⚠ 必须从容器往下找，不能用 document.getElementById：这些面板都在别的容器内部，
 *   getElementById 只认文档里"注册过"的 id，拿不到 —— 会静默跳过整个绑定（踩过）。
 */
function natalBoxEl(scope) {
  if (scope) return $(`.natal-block[data-calc-side="${scope}"]`);
  return $('#modalBody')?.querySelector('.natal-block') ?? null;
}

/** 重画弹窗里的加点面板（雷达图会跟着变）。key 是 "id:form" */
function redrawNatalBlock(key) {
  const box = natalBoxEl();
  if (!box) return;
  const sp = STATE.bySpirit.get(key);
  if (!sp) return;
  box.outerHTML = natalBlock(sp, spiritCalcOf(sp));
  const fresh = natalBoxEl();
  if (fresh) { delete fresh.dataset.bound; bindOneNatalBlock(fresh, undefined); }
}

/** 绑所有（弹窗 + 伤害计算两侧都可能存在）*/
function bindNatalBlock() {
  const modalBox = natalBoxEl();
  if (modalBox) bindOneNatalBlock(modalBox, undefined);
  for (const side of ['a', 'b']) {
    const el = natalBoxEl(side);
    if (el) bindOneNatalBlock(el, side);
  }
}

/** 给单个面板绑事件 */
function bindOneNatalBlock(box, scope) {
  if (!box || box.dataset.bound === '1') return;
  box.dataset.bound = '1';
  const key = box.dataset.calcSpirit;
  const sp = STATE.bySpirit.get(key);
  if (!sp) return;
  const c = withCalcSide(scope ?? null, () => spiritCalcOf(sp));
  const redraw = () => redrawNatalBlock(key);

  // 性格开关：每项独立，但「性格+」整列最多一项、「性格−」整列最多一项
  // （一个性格 = 一项加成 + 一项削弱）。再点自己 = 取消。
  for (const btn of box.querySelectorAll('[data-nat-btn]')) {
    btn.addEventListener('click', () => {
      const k = btn.dataset.natBtn;
      const kind = btn.dataset.natKind;
      const st = c.stats[k];
      if (st.nature === kind) {                      // 取消
        st.nature = 'neutral';
      } else {
        const taken = STAT_ORDER.some((x) => x !== k && c.stats[x].nature === kind);
        if (taken) {
          toast(kind === 'up' ? '加成已经给了别的属性，请先取消那一项' : '削弱已经给了别的属性，请先取消那一项');
          return;
        }
        // 同一项不能既加成又削弱
        if (st.nature === (kind === 'up' ? 'down' : 'up')) st.nature = 'neutral';
        st.nature = kind;
      }
      redraw();
    });
  }
  // 「清空」= 六项都不投（初始状态）
  box.querySelector('.natal-reset')?.addEventListener('click', () => {
    for (const k of STAT_ORDER) c.stats[k] = { iv: 0, nature: 'neutral' };
    redraw();
  });
  // 「个体」按钮：点一下投满该项（高亮），再点取消。最多 3 项
  for (const btn of box.querySelectorAll('[data-nat-ivbtn]')) {
    btn.addEventListener('click', () => {
      const k = btn.dataset.natIvbtn;
      const st = c.stats[k];
      if (st.iv > 0) {
        st.iv = 0;                                  // 取消
      } else {
        const others = STAT_ORDER.filter((x) => x !== k && c.stats[x].iv > 0).length;
        if (others >= 3) { toast('最多只能投入 3 项，请先取消一项'); return; }
        st.iv = IV_MAX;                             // 投满
      }
      redraw();
    });
  }
}

// 详情弹窗里点精灵/技能时要切换内容，需要单独处理（避免被上面的 data-skill 干扰）
$('#modalBody').addEventListener('click', (e) => {
  const termEl = e.target.closest('[data-glossary]');
  if (termEl) return glossaryDetail(termEl.dataset.glossary);
  if (e.target.closest('#toggleBloodline')) {
    STATE.expandedBloodlines = !STATE.expandedBloodlines;
    // 重画当前精灵详情，保留滚动位置
    const panel = $('.modal-panel');
    const top = panel.scrollTop;
    const cur = STATE.currentSpirit;
    if (cur) spiritDetail(cur);
    panel.scrollTop = top;
    return;
  }
  const skillEl = e.target.closest('[data-skill]');
  if (skillEl) {
    const owner = e.target.closest('.modal-body')?.dataset.owner;
    return skillDetail(Number(skillEl.dataset.skill), owner ?? null);
  }
  const spiritEl = e.target.closest('[data-spirit]');
  if (spiritEl) return spiritDetail(spiritEl.dataset.spirit);
  const copyEl = e.target.closest('[data-copy]');
  if (copyEl) navigator.clipboard?.writeText(copyEl.dataset.copy).then(() => toast('已复制')).catch(() => {});
});

// 快捷键
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
    e.preventDefault();
    $('#globalSearch').focus();
  } else if (e.key === 'Escape') {
    if (!$('#modal').hidden) closeModal();
    else $('#searchSuggest').hidden = true;
  } else if (!$('#searchSuggest').hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    const items = $$('#searchSuggest .item');
    STATE.searchSel = Math.max(0, Math.min(items.length - 1, STATE.searchSel + (e.key === 'ArrowDown' ? 1 : -1)));
    items.forEach((el, i) => el.classList.toggle('sel', i === STATE.searchSel));
  } else if (e.key === 'Enter' && !$('#searchSuggest').hidden && STATE.searchSel >= 0) {
    e.preventDefault();
    selectSearch(STATE.searchSel);
  }
});

const searchInput = $('#globalSearch');
searchInput.addEventListener('input', debounce(() => renderSearch(searchInput.value), 120));
searchInput.addEventListener('focus', () => { if (searchInput.value) renderSearch(searchInput.value); });

// 主题
const savedTheme = localStorage.getItem('roco-theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
$('#themeBtn').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = cur;
  localStorage.setItem('roco-theme', cur);
});

/* ============================================================
   启动
   ============================================================ */
(async function boot() {
  try {
    const data = await loadData();
    index(data);
    const c = data.meta.counts;
    // 只展示数据版本号（上游的 catalog_version）—— 它是"数据是否更新"的唯一可靠标志。
    // 不再显示生成时间：那个值每次构建都不同，会让产物永远"有变化"，
    // 导致 CI 每次都提交一个空改动（见 export-data.mjs 里的说明）。
    $('#statLine').textContent =
      `数据版本 ${data.meta.catalogVersion} · ${data.meta.locale}`;
    $('#app').innerHTML = '';
    route();
    console.log('[roco] 数据就绪', c);
    // 给自动化测试用的只读钩子（浏览器里也可以 console 里手动查）
    window.__roco = {
      STATE, filterSpirits, filterSkills, spiritSkillsOf, learnersOf, spiritDetail, skillDetail,
      glossaryDetail, render, index, calcDamage, panelStat, levelCoef, typeEffect, usableSkillsOf,
      NATURES, natureByName, panelValue, panelInt, ivOf, defaultNat, stateIcon, withCalcSide, bindNatalBlock,
      loadoutDamage, skillLoadout, pushLoadout, statCards, topSkillsOf, fillLoadoutWithTop,
      STATUS_EFFECTS, statusDamageOf, statusModeOf, starfallPower, starfallKillLayers, damageWithPower, layersForPower, killLayerCell, hpMaxOf, hpNowOf, targetHpOf, typeEffect,
      spiritCalcOf, calcStatsOf, natalBlock, bindNatalBlock, redrawNatalBlock, statBreakdown, natalBoxEl, defaultInvestSet,
    };
  } catch (err) {
    $('#app').innerHTML = `
      <div class="empty">
        <p>数据加载失败：${esc(err.message)}</p>
        <p class="desc">如果是双击打开（file://），请确认同目录下存在 <code>data-bundle.js</code>：<br>
        先在项目根目录跑 <code>node web/export-data.mjs</code> 生成它。</p>
      </div>`;
    console.error(err);
  }
})();
