#!/usr/bin/env node
/**
 * 把 out/roco.sqlite 导出成网页用的 JSON（读到 web/data/ 下）。
 *
 * 用法：
 *   node web/export-data.mjs                 # 默认读 out/roco.sqlite
 *   node web/export-data.mjs --db out-py/roco.sqlite --out web/data
 *   node web/export-data.mjs --locale en-US
 *
 * 图片路径会统一扁平化成 "assets/<把斜杠换成下划线>.webp"，
 * 与 web/fetch-assets.mjs 下载后的文件名一一对应，方便离线引用。
 * 若本地没有下载图片，页面会自动回退到 roco.world 的在线地址。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';

const ORIGIN = 'https://roco.world';

function parseArgs(argv) {
  const o = { db: 'out/roco.sqlite', out: 'web/data', assetsDir: 'web', locale: 'zh-Hans' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') o.db = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--assets-dir') o.assetsDir = argv[++i];
    else if (a === '--locale' || a === '--lang') o.locale = argv[++i];
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error('未知参数: ' + a);
  }
  return o;
}

/** 在线地址 -> 本地扁平文件名 */
function assetName(url) {
  if (!url) return null;
  const rel = String(url).replace(ORIGIN, '').replace(/^\/assets\//, '');
  return 'assets/' + rel.replace(/[/\\]/g, '_');
}

/**
 * 站点描述里的富文本标记（实测只有两类）：
 *   1) <desc_id=1015>应对状态</>     —— 术语链接，1015 指向 glossary.note_id
 *   2) <span fork_road="or">或</>    —— 分支选择里的连接词（如"威力+10 或 连击+1"）
 * 导出时额外给一份纯文本（去标记）供前端搜索/复制；
 * 给用户看的版本由前端 glossaryTag() 渲染成可点词条。
 */
function plainText(s) {
  return String(s ?? '')
    .replace(/<desc_id=\d+>/g, '')
    .replace(/<span\s+fork_road="[^"]*">/g, '')
    .replace(/<\/>/g, '');
}

function writeJson(file, data, pretty = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, pretty ? 1 : 0));
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`  ${file.padEnd(28)} ${String(kb).padStart(6)} KB`);
}

const t0 = Date.now();
const cfg = parseArgs(process.argv.slice(2));
if (cfg.help) {
  console.log('用法: node web/export-data.mjs [--db <sqlite>] [--out <dir>] [--locale zh-Hans]');
  process.exit(0);
}
if (!fs.existsSync(cfg.db)) {
  console.error(`✗ 找不到数据库 ${cfg.db}\n  请先跑 node node/scrape.mjs --all（或 python python/scrape.py --all）`);
  process.exit(1);
}

const db = new DatabaseSync(cfg.db);
const rows = (sql, ...p) => db.prepare(sql).all(...p).map((r) => Object.assign({}, r));
const L = cfg.locale;
const SRC = path.join('out', L);
const localeOf = (extra = '') => `locale = '${L.replace(/'/g, "''")}'${extra ? ' AND ' + extra : ''}`;

const dbLocale = rows(`SELECT DISTINCT locale FROM spirit`).map((r) => r.locale);
if (!dbLocale.includes(L)) {
  console.error(`✗ 数据库里没有 locale='${L}' 的数据，现有: ${dbLocale.join(', ')}`);
  process.exit(1);
}

console.log(`· 从 ${cfg.db} 导出 locale=${L} 的数据`);

/* ---------------------------------------------------------------- 系别 */
const types = rows('SELECT * FROM type WHERE locale = ? ORDER BY id', L).map((t) => ({
  id: t.id,
  name: t.name,
  short: t.short_name ?? t.name,
  color: (t.color ?? '#888888FF').slice(0, 7),
  immunities: t.status_immunities ? t.status_immunities.split(' / ') : [],
}));
const typeById = new Map(types.map((t) => [t.id, t]));

// 系别图标：数据库没存这一列，从抓取缓存里的 types.json 补
const manifest = JSON.parse(fs.readFileSync('out/.cache/static_manifest.json', 'utf8'));
const typesJsonPath = `out/.cache/static_${manifest.catalog_version}_${L}_types.json`;
const typeIcons = new Map();
if (fs.existsSync(typesJsonPath)) {
  const raw = JSON.parse(fs.readFileSync(typesJsonPath, 'utf8'));
  for (const t of raw.types ?? []) typeIcons.set(t.id, t.type_icon_image_url ?? '');
}
for (const t of types) {
  const online = typeIcons.get(t.id) ? ORIGIN + typeIcons.get(t.id) : null;
  t.iconOnline = online;
  t.icon = assetName(online);
}

/* ---------------------------------------------------------------- 精灵 */
// 被动技能（特性）的图标单独存在 passive_skill 表里
const passiveIcons = new Map();
const passiveIconUrls = [];          // 原站 URL，给图片清单用
for (const p of rows('SELECT * FROM passive_skill WHERE locale = ?', L)) {
  if (!p.image_url) continue;
  passiveIcons.set(`${p.handbook_id}:${p.form_id}`, assetName(p.image_url));
  passiveIconUrls.push(p.image_url);
}

const spiritRows = rows('SELECT * FROM spirit WHERE locale = ? ORDER BY handbook_id, form_id', L);
const spirits = spiritRows.map((s) => {
  const image = s.image_url ? s.image_url.replace(ORIGIN, '') : null;
  const head = s.head_image_url ? s.head_image_url.replace(ORIGIN, '') : null;
  const portrait = s.portrait_small_url ? s.portrait_small_url.replace(ORIGIN, '') : null;
  const passiveIcon = passiveIcons.get(`${s.handbook_id}:${s.form_id}`) ?? null;
  return {
    id: s.handbook_id,
    formId: s.form_id,
    name: s.name,
    form: s.form || null,
    petbaseId: s.petbase_id,
    types: JSON.parse(s.type_ids || '[]'),
    stage: s.evolution_stage,
    stats: {
      hp: s.stat_hp, patk: s.stat_physical_attack, satk: s.stat_special_attack,
      pdef: s.stat_physical_defense, sdef: s.stat_special_defense, spd: s.stat_speed,
    },
    bst: s.base_stat_total,
    passive: s.passive_skill_name
      ? { name: s.passive_skill_name, desc: s.passive_skill_desc, descPlain: plainText(s.passive_skill_desc), icon: passiveIcon }
      : null,
    eggs: s.egg_groups ? s.egg_groups.split(' / ').filter(Boolean) : [],
    family: s.family ? s.family.split(' / ').filter(Boolean) : [],
    skills: s.skill_count,
    img: assetName(image ? ORIGIN + image : null),
    imgOnline: image ? ORIGIN + image : null,
    head: assetName(head ? ORIGIN + head : null),
    headOnline: head ? ORIGIN + head : null,
    portrait: assetName(portrait ? ORIGIN + portrait : null),
    portraitOnline: portrait ? ORIGIN + portrait : null,
    url: `${ORIGIN}/zh/jini/${s.handbook_id}`,
  };
});

/* ------------------------------------------------------------ 技能关系 */
const ssRows = rows('SELECT * FROM spirit_skill WHERE locale = ?', L);
const spiritSkills = new Map(); // "handbook:form" -> [ {id, type, order, lv} ]
for (const r of ssRows) {
  const key = `${r.handbook_id}:${r.form_id}`;
  if (!spiritSkills.has(key)) spiritSkills.set(key, []);
  spiritSkills.get(key).push({
    id: r.skill_id,
    src: r.source_type,
    ord: r.source_order,
    lv: r.unlock_level,
  });
}

// 技能图标索引：给精灵详情的技能表用（技能库里本来就有图标）
// 用数组而不是对象：id 都是数字，数组序列化更紧凑（579 条省下大量引号与键名）
const skillIcons = [];
for (const s of rows('SELECT id, image_url FROM skill WHERE locale = ? ORDER BY id', L)) {
  if (s.image_url) skillIcons.push([s.id, assetName(s.image_url)]);
}

/* ---------------------------------------------------------------- 血脉
   每只精灵 18 种血脉，每种给 1 个专属技能。这些技能不在 spirit_skill 里，
   只在详情 JSON 的 bloodline_options 中，单独存在 spirit_bloodline 表。

   体积优化：血脉种类只有 18 种，图标/秘药名/秘药图标对同一种血脉是重复的。
   早期版本每条都塞 icon/item/itemIcon（每条 319 字符 × 11238 条 = 3.38 MB），
   现在把它们提到按 bloodline_id 索引的 meta 里，每行只留 (id, skillId, skill, lv)。
   实测 bundle 从 6.1 MB 降到约 1.2 MB。 */
const bloodlineRows = rows('SELECT * FROM spirit_bloodline WHERE locale = ? ORDER BY handbook_id, form_id, bloodline_id', L);
const spiritBloodlines = new Map();
const bloodlineMeta = new Map();     // bloodline_id -> { name, short, icon, item, itemIcon }
const skillMetaExtra = new Map();    // skill_id -> 图标本地路径（血脉技能也有图标）
for (const r of bloodlineRows) {
  const key = `${r.handbook_id}:${r.form_id}`;
  if (!spiritBloodlines.has(key)) spiritBloodlines.set(key, []);
  spiritBloodlines.get(key).push({
    id: r.bloodline_id,
    skillId: r.skill_id,
    skill: r.skill_name || null,
    lv: r.unlock_level,
  });
  if (!bloodlineMeta.has(r.bloodline_id)) {
    bloodlineMeta.set(r.bloodline_id, {
      name: r.bloodline_name,
      short: r.bloodline_short || null,
      icon: assetName(r.bloodline_icon),
      item: r.grant_item || null,
      itemIcon: assetName(r.grant_item_icon),
    });
  }
  if (r.skill_id && r.skill_icon && !skillMetaExtra.has(r.skill_id)) {
    skillMetaExtra.set(r.skill_id, assetName(r.skill_icon));
  }
}

/* ---------------------------------------------------------------- 技能 */
const skillRows = rows('SELECT * FROM skill WHERE locale = ? ORDER BY id', L);
const learnerRows = rows('SELECT * FROM skill_learner WHERE locale = ?', L);
const learners = new Map();
for (const r of learnerRows) {
  if (!learners.has(r.skill_id)) learners.set(r.skill_id, []);
  // 不给每条记录重复存头像路径：前端用 id:formId 从精灵表查即可
  // （实测把 head 塞进来会让 skill-learners.json 从 1.1 MB 涨到 3.0 MB）
  learners.get(r.skill_id).push({
    id: r.handbook_id, formId: r.form_id, name: r.spirit_name,
    form: r.form || null, group: r.source_group, lv: r.unlock_level,
  });
}
const skillByName = new Map(types.map((t) => [t.name, t.id]));

// 原始 damage 数组：数据库只存了 damage_min/max（基础威力），
// 完整数组在抓取产物 out/<locale>/skills.jsonl 里 —— 从那里读，避免再改库结构。
// 注意变量名是 L（= cfg.locale）。这里踩过一次：写成不存在的 locale，
// path.join 得到 undefined，existsSync 直接返回 false，整段静默跳过、damage 全空。
const damageById = new Map();
{
  const p = path.join(path.dirname(cfg.db), L, 'skills.jsonl');
  if (fs.existsSync(p)) {
    let n = 0;
    for (const line of fs.readFileSync(p, 'utf8').trim().split('\n')) {
      if (!line) continue;
      try {
        const r = JSON.parse(line);
        if (Array.isArray(r.damage)) { damageById.set(r.id, r.damage); n++; }
      } catch { /* 跳过坏行 */ }
    }
    if (!n) console.warn(`  ⚠ ${p} 里没有可用的 damage 数组`);
  } else {
    console.warn(`  ⚠ 找不到 ${p}，技能原始 damage 数组将为空（先跑 node node/scrape.mjs）`);
  }
}

const skills = skillRows.map((s) => ({
  id: s.id,
  name: s.name,
  cat: s.category,
  type: s.damage_type || null,
  typeId: skillByName.get(s.damage_type) ?? null,
  energy: s.energy_cost,
  // damage_min/damage_max 现在都是"基础威力"（= damage[0]）。
  // 早先版本对 damage 数组取 min/max，把 [105,1,20580010,...] 里的上限哨兵
  // 当成威力显示成 0~20580010 —— 已修。powerIsVariable 为真时页面加「可变」标记。
  dmgMin: s.damage_min,
  dmgMax: s.damage_max,
  powerIsVariable: s.power_is_variable ? 1 : 0,
  // 原始 damage 数组也导出：可变威力技能的 [1..] 存着阈值/状态信息，界面暂不显示，
  // 但留在数据里方便以后做"威力成长曲线"之类的功能，也便于核对上游。
  damage: damageById.get(s.id) ?? [],
  cdMin: s.cooldown_min,
  cdMax: s.cooldown_max,
  src: s.source_types,
  uses: s.used_by_petbase_count,
  n: s.learner_count,
  desc: s.description,
  descPlain: plainText(s.description),
  img: assetName(s.image_url),
  imgOnline: s.image_url || null,
}));

/* ---------------------------------------------------------------- 克制 */
const matchups = rows('SELECT * FROM type_matchup WHERE locale = ?', L)
  .map((m) => [m.attacking_type_id, m.defending_type_id, m.effect]);

/* ------------------------------------------------------------ 队伍/术语 */
const teams = rows('SELECT * FROM team WHERE locale = ? ORDER BY id', L).map((t) => ({
  id: t.id, name: t.name, author: t.author, date: t.created_date,
  item: t.battle_item, url: t.url,
}));
const teamMembers = new Map();
for (const m of rows('SELECT * FROM team_member WHERE locale = ? ORDER BY team_id, seat', L)) {
  if (!teamMembers.has(m.team_id)) teamMembers.set(m.team_id, []);
  teamMembers.get(m.team_id).push({
    id: m.handbook_id, seat: m.seat, name: m.name, form: m.form || null,
    types: m.types ? m.types.split(' ').filter(Boolean) : [],
    bloodline: m.bloodline, item: m.item, variant: m.variant,
  });
}
for (const t of teams) t.members = teamMembers.get(t.id) ?? [];

const glossary = rows('SELECT * FROM glossary WHERE locale = ? ORDER BY note_id', L).map((g) => ({
  id: g.note_id, name: g.note, desc: g.description, descPlain: plainText(g.description),
  skills: g.used_by_skills ? g.used_by_skills.split(' / ').filter(Boolean) : [],
  n: g.used_by_skill_count,
  // icon_key 是上游给这批词条的稳定标识（如 poison / starfall-mark）。
  // 上游的 picture 字段全是 null，所以没有图标图可下载 —— 前端用分类色标区分。
  key: g.icon_key || '',
}));

/**
 * 状态与印记数据集（out/<locale>/status.jsonl）。
 * 由 tools/build-status-data.mjs 从【本项目的术语库】生成 —— 不引用任何第三方整理的数据。
 * 文件不存在时不报错，只是不导出（老数据/新克隆也能跑通）。
 */
let statuses = [];
{
  const p = path.join(SRC, 'status.jsonl');
  if (fs.existsSync(p)) {
    statuses = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } else {
    console.warn('⚠ 没有 out/<locale>/status.jsonl —— 先跑 node tools/build-status-data.mjs');
  }
}

// 六维图标：站点把它当 CSS mask 用（透明底 + 白色字形），颜色由页面自己染，
// 所以这里只传 URL 与顺序，前端用 mask-image 渲染。
const statIcons = rows('SELECT * FROM stat_icons WHERE locale = ? ORDER BY display_order', L).map((x) => {
  const online = x.image_url || null;
  return { stat: x.stat, label: x.label, order: x.display_order, icon: assetName(online), iconOnline: online };
});

/**
 * 状态分类的中文名 + 配色。分类由 tools/build-status-data.mjs 按词条语义判定。
 * 颜色只是界面辅助，与数据本身无关。
 */
const STATUS_KINDS = {
  mark: { label: '印记', color: '#8a5fd0', desc: '下场不消失，新入场的精灵继承' },
  weather: { label: '天气', color: '#3f8fbf', desc: '影响双方' },
  status: { label: '状态', color: '#c05a4a', desc: '回合结算或限制行动' },
  buff: { label: '增益 / 减益', color: '#4a9a5f', desc: '属性与效果的统称' },
  counter: { label: '应对', color: '#c97917', desc: '条件触发，必定先手' },
  leave: { label: '离场', color: '#6d7f95', desc: '更换入场精灵' },
  mechanic: { label: '机制', color: '#7a7f8a', desc: '通用规则与术语' },
};

db.close();

/* ---------------------------------------------------------------- 写出 */
// 注意：这里【不能】放 generatedAt 这类每次都变的时间戳。
// 否则 meta.json 与 data-bundle.js 永远"有变化"，CI 每次运行都会提交一个
// 空改动并重新发布一次。实测踩过：连续两次运行的差异只有时间戳。
// 网页要显示"数据版本"用 catalogVersion 就够了 —— 那是上游给的版本号，
// 只有它的变化才代表数据真的更新了。
const meta = {
  locale: L,
  catalogVersion: manifest.catalog_version,
  counts: {
    spirits: spirits.length, skills: skills.length, spiritSkills: ssRows.length,
    learners: learnerRows.length, types: types.length, matchups: matchups.length,
    teams: teams.length, glossary: glossary.length, statuses: statuses.length,
  },
  origin: ORIGIN,
  types,
  statIcons,
  skillIcons,
  // 状态分类的中文名与配色（前端用来分组与上色）
  statusKinds: STATUS_KINDS,
  // 血脉元数据（按 bloodline_id 索引）：名称/图标/秘药；避免每行重复存
  bloodlines: Object.fromEntries(bloodlineMeta),
  // 血脉技能的图标（按 skill_id 索引）
  bloodlineSkillIcons: Object.fromEntries(skillMetaExtra),
};

// 精灵 -> 技能 / 技能 -> 可学精灵（都是对象映射，按需要查）
const spiritSkillMap = {};
for (const [k, v] of spiritSkills) spiritSkillMap[k] = v;
const learnerMap = {};
for (const [k, v] of learners) learnerMap[k] = v;

console.log('· 写出数据');
writeJson(path.join(cfg.out, 'meta.json'), meta, true);
writeJson(path.join(cfg.out, 'spirits.json'), spirits);
writeJson(path.join(cfg.out, 'skills.json'), skills);
writeJson(path.join(cfg.out, 'matchups.json'), matchups);
writeJson(path.join(cfg.out, 'teams.json'), teams);
writeJson(path.join(cfg.out, 'glossary.json'), glossary);
writeJson(path.join(cfg.out, 'statuses.json'), statuses);
writeJson(path.join(cfg.out, 'spirit-skills.json'), spiritSkillMap);
writeJson(path.join(cfg.out, 'skill-learners.json'), learnerMap);
const bloodlineMap = {};
for (const [k, v] of spiritBloodlines) bloodlineMap[k] = v;
writeJson(path.join(cfg.out, 'spirit-bloodlines.json'), bloodlineMap);

// 单文件包：给 file:// 直接双击打开用（浏览器不允许 file:// 下 fetch 本地 JSON）
const bundle = {
  meta, spirits, skills, matchups, teams, glossary, statuses,
  spiritSkills: spiritSkillMap, skillLearners: learnerMap, spiritBloodlines: bloodlineMap,
};
const bundlePath = path.join(cfg.assetsDir, 'data-bundle.js');
fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
fs.writeFileSync(bundlePath, 'window.ROCO_DATA=' + JSON.stringify(bundle) + ';\n');
console.log(`  ${path.normalize(bundlePath).padEnd(30)} ${(fs.statSync(bundlePath).size / 1048576).toFixed(1)} MB（单文件包，file:// 可直接读）`);

// 图片清单（给 fetch-assets.mjs 用）
const urls = new Set();
const addUrl = (u) => { if (u) urls.add(u); };
for (const s of spirits) { addUrl(s.imgOnline); addUrl(s.headOnline); addUrl(s.portraitOnline); }
for (const s of skills) addUrl(s.imgOnline);
for (const t of types) addUrl(t.iconOnline);
for (const x of statIcons) addUrl(x.iconOnline);
for (const u of passiveIconUrls) addUrl(u);
// 血脉相关的图片：从表里取原站 URL（导出结构里已不再逐条保存路径）
for (const r of bloodlineRows) {
  for (const u of [r.bloodline_icon, r.grant_item_icon, r.skill_icon]) if (u) addUrl(u);
}
writeJson(path.join(cfg.out, 'assets.json'), [...urls].sort());

console.log(`\n✓ 完成（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
console.log(`  图片 ${urls.size} 个 -> 跑 node web/fetch-assets.mjs 下载到 web/assets/`);
console.log('  数据概览: ' + JSON.stringify(meta.counts));
