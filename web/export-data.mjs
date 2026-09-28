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
const spiritRows = rows('SELECT * FROM spirit WHERE locale = ? ORDER BY handbook_id, form_id', L);
const spirits = spiritRows.map((s) => {
  const image = s.image_url ? s.image_url.replace(ORIGIN, '') : null;
  const head = s.head_image_url ? s.head_image_url.replace(ORIGIN, '') : null;
  const portrait = s.portrait_small_url ? s.portrait_small_url.replace(ORIGIN, '') : null;
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
    passive: s.passive_skill_name ? { name: s.passive_skill_name, desc: s.passive_skill_desc, descPlain: plainText(s.passive_skill_desc) } : null,
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

/* ---------------------------------------------------------------- 技能 */
const skillRows = rows('SELECT * FROM skill WHERE locale = ? ORDER BY id', L);
const learnerRows = rows('SELECT * FROM skill_learner WHERE locale = ?', L);
const learners = new Map();
for (const r of learnerRows) {
  if (!learners.has(r.skill_id)) learners.set(r.skill_id, []);
  learners.get(r.skill_id).push({
    id: r.handbook_id, formId: r.form_id, name: r.spirit_name,
    form: r.form || null, group: r.source_group, lv: r.unlock_level,
  });
}
const skillByName = new Map(types.map((t) => [t.name, t.id]));
const skills = skillRows.map((s) => ({
  id: s.id,
  name: s.name,
  cat: s.category,
  type: s.damage_type || null,
  typeId: skillByName.get(s.damage_type) ?? null,
  energy: s.energy_cost,
  dmgMin: s.damage_min,
  dmgMax: s.damage_max,
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
}));

db.close();

/* ---------------------------------------------------------------- 写出 */
const meta = {
  locale: L,
  catalogVersion: manifest.catalog_version,
  generatedAt: new Date().toISOString(),
  counts: {
    spirits: spirits.length, skills: skills.length, spiritSkills: ssRows.length,
    learners: learnerRows.length, types: types.length, matchups: matchups.length,
    teams: teams.length, glossary: glossary.length,
  },
  origin: ORIGIN,
  types,
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
writeJson(path.join(cfg.out, 'spirit-skills.json'), spiritSkillMap);
writeJson(path.join(cfg.out, 'skill-learners.json'), learnerMap);

// 单文件包：给 file:// 直接双击打开用（浏览器不允许 file:// 下 fetch 本地 JSON）
const bundle = {
  meta, spirits, skills, matchups, teams, glossary,
  spiritSkills: spiritSkillMap, skillLearners: learnerMap,
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
writeJson(path.join(cfg.out, 'assets.json'), [...urls].sort());

console.log(`\n✓ 完成（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
console.log(`  图片 ${urls.size} 个 -> 跑 node web/fetch-assets.mjs 下载到 web/assets/`);
console.log('  数据概览: ' + JSON.stringify(meta.counts));
