#!/usr/bin/env node
/**
 * roco.world 爬虫 (Node.js, 零第三方依赖)
 * ------------------------------------------------------------------
 * 数据来源（站点 SPA 自己用的接口，都是公开静态 JSON）：
 *   1) /static/manifest.json                              —— 目录版本 / 文件清单
 *   2) /static/<ver>/<locale>/spirits.json                —— 全部精灵列表(466)
 *   3) /static/<ver>/<locale>/spirit/<id>.json            —— 精灵详情(种族值/技能/进化/获得)
 *   4) /static/<ver>/<locale>/skill-list/<sort>/all/<n>.json —— 技能 id 分页(579 个技能)
 *   5) /static/<ver>/<locale>/skill/<id>.json             —— 技能详情 + 可学习精灵
 *   6) /static/<ver>/<locale>/types.json                  —— 系别 + 克制表
 *   7) /static/<ver>/<locale>/teams.json                  —— 推荐队伍
 *   8) /static/<ver>/<locale>/description_notes.json      —— 术语/状态词条
 *
 * 用法：
 *   node scrape.mjs                      # 抓 精灵+技能+系别+队伍+术语
 *   node scrape.mjs spirits skills       # 只抓指定部分
 *   node scrape.mjs --locale en-US       # 抓英文（站点支持 zh-Hans/en-US/vi-VN/pt-BR/ja-JP）
 *   node scrape.mjs --assets             # 额外下载图片（约 4500 个文件，会慢很多）
 *   node scrape.mjs --offline            # 只用缓存，不联网（验证解析逻辑）
 *
 * 产出：out/<locale>/ 下 spirits.csv/jsonl、skills.csv/jsonl、teams.json…
 *       out/roco.sqlite（多语言按 locale 列区分）
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ORIGIN = 'https://roco.world';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const PARTS = ['spirits', 'skills', 'types', 'teams', 'glossary'];

// ---------------------------------------------------------------- CLI
function parseArgs(argv) {
  const o = {
    parts: [],
    locale: 'zh-Hans',
    out: 'out',
    concurrency: 6,
    rate: 120, // 每个请求之间最小间隔(ms)，礼貌抓取
    retries: 3,
    timeout: 20000,
    assets: false,
    offline: false,
    fresh: false,
    sqlite: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--locale' || a === '--lang' || a === '-l') o.locale = next();
    else if (a === '--out' || a === '-o') o.out = next();
    else if (a === '--concurrency' || a === '-c') o.concurrency = Number(next());
    else if (a === '--rate') o.rate = Number(next());
    else if (a === '--timeout') o.timeout = Number(next());
    else if (a === '--assets') o.assets = true;
    else if (a === '--offline') o.offline = true;
    else if (a === '--fresh') o.fresh = true;
    else if (a === '--no-sqlite') o.sqlite = false;
    else if (a === '--all') o.parts = [...PARTS];
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a.startsWith('-')) throw new Error('未知参数: ' + a);
    else o.parts.push(a);
  }
  if (!o.parts.length) o.parts = [...PARTS];
  for (const p of o.parts)
    if (!PARTS.includes(p)) throw new Error(`未知部分 "${p}"，可选: ${PARTS.join(', ')}`);
  return o;
}

const HELP = `roco.world 爬虫

  node scrape.mjs [部分...] [选项]

部分: ${PARTS.join(' | ')}  (默认全部)

选项:
  -l, --locale <tag>    语言: zh-Hans | en-US | vi-VN | pt-BR | ja-JP  (默认 zh-Hans，同 --lang)
  -o, --out <dir>       输出目录 (默认 out)
  -c, --concurrency <n> 并发请求数 (默认 6)
      --rate <ms>       同域请求最小间隔 (默认 120)
      --timeout <ms>    单请求超时 (默认 20000)
      --assets          下载图片资源（只下数据里引用到的，约数千个 webp，耗时较长）
      --offline         只读缓存，不联网
      --fresh           忽略缓存重新下载
      --no-sqlite       不生成 sqlite 数据库
  -h, --help            显示帮助
`;

// ---------------------------------------------------------------- 工具
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows, columns) {
  const head = columns.map(csvCell).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(',')).join('\n');
  return '\ufeff' + head + '\n' + body + (rows.length ? '\n' : '');
}
/**
 * 清理文本：去掉 &nbsp; 与首尾空白、压缩连续空白。
 * 注意：这里**不能**用 NFKC/NFKD 归一化 —— 那会把中文全角标点（，。：（））
 * 压成半角（,.()），改动站点原文。
 */
const norm = (s) => String(s ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- HTTP
class Fetcher {
  constructor(cfg) {
    this.cfg = cfg;
    this.cacheDir = path.join(cfg.out, '.cache');
    this.lastRequest = 0;
    this.stats = { hit: 0, net: 0, miss: 0, bytes: 0 };
  }
  cachePath(url) {
    const u = new URL(url);
    const name = (u.pathname + u.search).replace(/^\/+/, '').replace(/[^\w.\-]+/g, '_');
    return path.join(this.cacheDir, name);
  }
  async getText(url) {
    const cp = this.cachePath(url);
    if (!this.cfg.fresh && fs.existsSync(cp) && fs.statSync(cp).size > 0) {
      this.stats.hit++;
      return fsp.readFile(cp, 'utf8');
    }
    if (this.cfg.offline) throw new Error('离线模式下缓存缺失: ' + url);

    let err;
    for (let attempt = 1; attempt <= this.cfg.retries; attempt++) {
      const wait = this.cfg.rate - (Date.now() - this.lastRequest);
      if (wait > 0) await sleep(wait);
      this.lastRequest = Date.now();
      try {
        const ctl = AbortSignal.timeout(this.cfg.timeout);
        const res = await fetch(url, {
          headers: { 'user-agent': UA, accept: 'application/json,text/html;q=0.9,*/*;q=0.8' },
          signal: ctl,
        });
        if (res.status === 404) {
          this.stats.miss++;
          const e = new Error('404 ' + url);
          e.status = 404;
          throw e;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
        const text = await res.text();
        this.stats.net++;
        this.stats.bytes += Buffer.byteLength(text);
        await fsp.mkdir(path.dirname(cp), { recursive: true });
        await fsp.writeFile(cp, text);
        return text;
      } catch (e) {
        if (e.status === 404) throw e;
        err = e;
        if (attempt < this.cfg.retries) await sleep(400 * attempt);
      }
    }
    throw err;
  }
  async getJson(url) {
    return JSON.parse(await this.getText(url));
  }
  async getBinary(url, dest) {
    const cp = this.cachePath(url);
    if (!this.cfg.fresh && fs.existsSync(cp)) {
      this.stats.hit++;
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.copyFile(cp, dest);
      return;
    }
    if (this.cfg.offline) throw new Error('离线模式下缓存缺失: ' + url);
    for (let attempt = 1; attempt <= this.cfg.retries; attempt++) {
      const wait = this.cfg.rate - (Date.now() - this.lastRequest);
      if (wait > 0) await sleep(wait);
      this.lastRequest = Date.now();
      try {
        const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(this.cfg.timeout) });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
        const buf = Buffer.from(await res.arrayBuffer());
        this.stats.net++;
        this.stats.bytes += buf.length;
        await fsp.mkdir(path.dirname(cp), { recursive: true });
        await fsp.writeFile(cp, buf);
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, buf);
        return;
      } catch (e) {
        if (attempt === this.cfg.retries) throw e;
        await sleep(400 * attempt);
      }
    }
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0,
    done = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
      if (++done % 50 === 0) process.stderr.write(`\r  进度 ${done}/${items.length}   `);
    }
  });
  await Promise.all(workers);
  if (items.length >= 50) process.stderr.write('\r');
  return out;
}

// ---------------------------------------------------------------- 取值助手
const STAT_KEYS = [
  ['hp', '生命'],
  ['physical_attack', '物攻'],
  ['special_attack', '魔攻'],
  ['physical_defense', '物防'],
  ['special_defense', '魔防'],
  ['speed', '速度'],
];

function makeTypeIndex(catalog) {
  const byId = new Map();
  for (const t of catalog?.types?.types ?? []) byId.set(t.id, t);
  return byId;
}

function typeNames(ids, typeById) {
  return (ids ?? []).map((id) => typeById.get(id)?.name ?? `#${id}`);
}
function typeShort(ids, typeById) {
  return (ids ?? []).map((id) => typeById.get(id)?.short_name ?? `#${id}`);
}

// 精灵详情 -> 扁平记录
function spiritRow(d, typeById) {
  const stats = d.stats ?? {};
  const row = {
    handbook_id: d.handbook_id,
    petbase_id: d.petbase_id,
    form_id: d.form_id,
    name: norm(d.name),
    form: d.form ?? '',
    is_display_petbase: d.is_display_petbase,
    evolution_stage: d.evolution_stage,
    type_ids: d.unit_types ?? [],
    types: typeNames(d.unit_types, typeById).join(' / '),
    types_short: typeShort(d.unit_types, typeById).join(' '),
    type_count: (d.unit_types ?? []).length,
    base_stat_total: STAT_KEYS.reduce((s, [k]) => s + (stats[k] ?? 0), 0),
    height_min: d.physical_profile?.height_m?.min ?? '',
    height_max: d.physical_profile?.height_m?.max ?? '',
    weight_min: d.physical_profile?.weight_kg?.min ?? '',
    weight_max: d.physical_profile?.weight_kg?.max ?? '',
    passive_skill_id: d.passive_skill_id ?? '',
    passive_skill_name: d.passive_skills?.[0]?.name ?? '',
    passive_skill_desc: d.passive_skills?.[0]?.description ?? '',
    egg_groups: (d.egg_groups ?? []).map((g) => g.name).join(' / '),
    is_breedable: (d.egg_groups ?? []).some((g) => g.is_breedable) ? 1 : 0,
    family: (d.family_members ?? []).map((m) => `#${m.handbook_id}${m.name}`).join(' / '),
    family_count: (d.family_members ?? []).length,
    evolution_routes: (d.family_members ?? []).flatMap((m) =>
      (m.evolution_routes ?? []).map((r) => ({
        from: m.name,
        method: r.method ?? r.kind ?? null,
        to: r.to?.name ?? r.target?.name ?? null,
        level: r.level ?? null,
      })),
    ),
    skill_count: (d.skills ?? []).length,
    bloodline_options: (d.bloodline_options ?? []).map((b) => b.bloodline?.name ?? b.name ?? '').filter(Boolean),
    source_eggs: (d.sources?.spirit_eggs ?? []).length,
    source_fruits: (d.sources?.spirit_fruits ?? []).length,
    image_url: d.image_url ? ORIGIN + d.image_url : '',
    head_image_url: d.head_image_url ? ORIGIN + d.head_image_url : '',
    portrait_small_url: d.portrait_small_url ? ORIGIN + d.portrait_small_url : '',
    detail_url: `${ORIGIN}/zh/jini/${d.handbook_id}`,
  };
  for (const [k, zh] of STAT_KEYS) row[`stat_${k}`] = stats[k] ?? '';
  return row;
}

// 技能 -> 扁平记录
function skillRow(s, typeById) {
  const dmg = Array.isArray(s.damage) ? s.damage : [];
  return {
    id: s.id,
    name: norm(s.name),
    category: s.skill_category?.label ?? s.skill_category?.key ?? '',
    damage_type_id: s.skill_damage_type,
    damage_type: s.skill_damage_type != null ? typeById.get(s.skill_damage_type)?.name ?? '' : '',
    battle_type_id: s.battle_type_id ?? '',
    battle_type: s.battle_type_id != null ? typeById.get(s.battle_type_id)?.name ?? '' : '',
    energy_cost: s.energy_cost ?? '',
    damage_min: dmg.length ? Math.min(...dmg) : '',
    damage_max: dmg.length ? Math.max(...dmg) : '',
    damage: dmg,
    power_is_variable: s.power_is_variable,
    energy_is_variable: s.energy_is_variable,
    cooldown_min: Array.isArray(s.cooldown) ? s.cooldown[0] : '',
    cooldown_max: Array.isArray(s.cooldown) ? s.cooldown[1] : '',
    target_type: s.target_type ?? '',
    target_count: s.target_count ?? '',
    source_types: (s.source_types ?? []).join(' / '),
    is_passive: s.is_passive ? 1 : 0,
    used_by_petbase_count: s.used_by_petbase_count ?? '',
    learner_count:
      (s.learn_source_spirits?.level_up?.length ?? 0) +
      (s.learn_source_spirits?.spirit_stone?.length ?? 0) +
      (s.learn_source_spirits?.bloodline_elixir?.length ?? 0),
    description: norm(s.description),
    image_url: s.image_url ? ORIGIN + s.image_url : '',
    detail_url: `${ORIGIN}/zh/skills/${s.id}`,
  };
}

// 精灵-技能 关系（来自精灵详情）
function spiritSkillRows(d, typeById) {
  const rows = [];
  for (const sk of d.skills ?? []) {
    rows.push({
      handbook_id: d.handbook_id,
      form_id: d.form_id,
      petbase_id: d.petbase_id,
      spirit_name: norm(d.name),
      skill_id: sk.id,
      skill_name: norm(sk.name),
      source_type: sk.source_type ?? '',
      source_order: sk.source_order ?? '',
      unlock_level: sk.unlock_level ?? '',
      blood_type: sk.blood_type ?? '',
      energy_cost: sk.energy_cost ?? '',
      category: sk.skill_category?.label ?? '',
      damage_type: sk.skill_damage_type != null ? typeById.get(sk.skill_damage_type)?.name ?? '' : '',
      damage_min: Array.isArray(sk.damage) && sk.damage.length ? Math.min(...sk.damage) : '',
      description: norm(sk.description),
    });
  }
  for (const pk of d.passive_skills ?? []) {
    rows.push({
      handbook_id: d.handbook_id,
      form_id: d.form_id,
      petbase_id: d.petbase_id,
      spirit_name: norm(d.name),
      skill_id: pk.id,
      skill_name: norm(pk.name),
      source_type: 'passive',
      source_order: pk.source_order ?? '',
      unlock_level: '',
      blood_type: '',
      energy_cost: pk.energy_cost ?? '',
      category: pk.skill_category?.label ?? '',
      damage_type: '',
      damage_min: '',
      description: norm(pk.description),
    });
  }
  return rows;
}

// 技能 -> 可学习精灵 关系（来自技能详情）
function skillLearnerRows(s) {
  const rows = [];
  const groups = {
    level_up: 'level',
    spirit_stone: 'machine',
    bloodline_elixir: 'blood',
  };
  for (const [key, arr] of Object.entries(s.learn_source_spirits ?? {})) {
    for (const sp of arr ?? []) {
      rows.push({
        skill_id: s.id,
        skill_name: norm(s.name),
        handbook_id: sp.handbook_id ?? '',
        petbase_id: sp.petbase_id ?? '',
        form_id: sp.form_id ?? '',
        spirit_name: norm(sp.name),
        form: sp.form ?? '',
        group: key,
        source_type: sp.source_type ?? groups[key] ?? '',
        unlock_level: sp.unlock_level ?? '',
      });
    }
  }
  return rows;
}

function teamRows(t, typeById) {
  // 注意：站点的队伍数据只给「成员精灵 + 血脉 + 队伍道具」，没有每只精灵的技能配置
  const members = (t.members ?? []).map((m) => ({
    handbook_id: m.spirit?.handbook_id ?? '',
    petbase_id: m.spirit?.petbase_id ?? '',
    name: norm(m.spirit?.name),
    form: m.spirit?.form ?? '',
    types: typeShort(m.spirit?.unit_types, typeById).join(' '),
    variant: m.variant ?? '',
    bloodline: m.bloodline?.name ?? '',
    item: t.battle_item?.name ?? '',
  }));
  return {
    team: {
      id: t.id,
      name: norm(t.name),
      author: norm(t.author_credit),
      created_date: t.created_date ?? '',
      battle_item: t.battle_item?.name ?? '',
      member_count: members.length,
      members: members.map((m) => m.name).join(' / '),
      url: `${ORIGIN}/zh/teams`,
    },
    members,
  };
}

// ---------------------------------------------------------------- 主流程
async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) {
    process.stdout.write(HELP);
    return;
  }
  const t0 = Date.now();
  const fetcher = new Fetcher(cfg);
  await fsp.mkdir(cfg.out, { recursive: true });

  // 1) manifest
  process.stderr.write('· 读取 manifest.json\n');
  const manifest = await fetcher.getJson(`${ORIGIN}/static/manifest.json`);
  const ver = manifest.catalog_version;
  const locale = cfg.locale;
  if (!(manifest.locales ?? []).includes(locale))
    throw new Error(`站点不支持 locale "${locale}"，可用: ${(manifest.locales ?? []).join(', ')}`);
  const S = `${ORIGIN}/static/${ver}/${encodeURIComponent(locale)}`;
  process.stderr.write(`  catalog_version=${ver}  locale=${locale}  项目=${cfg.parts.join(',')}\n`);

  const outDir = path.join(cfg.out, locale);
  await fsp.mkdir(outDir, { recursive: true });

  const result = { locale, catalog_version: ver, fetched_at: nowIso(), parts: {} };
  let spiritsRows = [];
  let spiritsDetail = [];
  let spiritSkillLinks = [];
  let skillsRows = [];
  let skillLearnerLinks = [];
  let typesData = null;
  let teamsData = null;
  let glossaryData = null;
  let teamList = [];
  let teamMemberList = [];
  let glossaryList = [];
  const typeById = makeTypeIndex({ types: await fetcher.getJson(`${S}/types.json`) });
  typesData = await fetcher.getJson(`${S}/types.json`);

  // 2) 精灵
  if (cfg.parts.includes('spirits')) {
    process.stderr.write('· 精灵列表\n');
    const list = await fetcher.getJson(`${S}/spirits.json`);
    const forms = (manifest.spirit_forms ?? []).filter((f) => list.results.some((r) => r.handbook_id === f.handbook_id));
    const targets = list.results.filter((r) => r.is_display_petbase !== false);
    process.stderr.write(`  ${list.total} 只（详情文件 ${manifest.counts?.[locale]?.spirit_details ?? '?'}，含形态）\n`);

    process.stderr.write('· 精灵详情\n');
    const details = await mapLimit(targets, cfg.concurrency, async (r) => {
      const url = `${S}/spirit/${r.handbook_id}.json`;
      try {
        return await fetcher.getJson(url);
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    });
    spiritsDetail = details.filter(Boolean);
    spiritsRows = spiritsDetail.map((d) => spiritRow(d, typeById));
    spiritSkillLinks = spiritsDetail.flatMap((d) => spiritSkillRows(d, typeById));

    // 形态（同一 handbook_id 的其它 form）
    const extras = (manifest.spirit_forms ?? []).filter((f) => !f.is_default);
    if (extras.length) {
      process.stderr.write(`· 精灵形态 ${extras.length} 个\n`);
      const fdetails = await mapLimit(extras, cfg.concurrency, async (f) => {
        try {
          return await fetcher.getJson(`${S}/spirit/${f.handbook_id}/form/${f.form_id}.json`);
        } catch (e) {
          if (e.status === 404) return null;
          throw e;
        }
      });
      const formsRows = fdetails.filter(Boolean).map((d) => spiritRow(d, typeById));
      spiritsRows = spiritsRows.concat(formsRows);
      spiritSkillLinks = spiritSkillLinks.concat(
        fdetails.filter(Boolean).flatMap((d) => spiritSkillRows(d, typeById)),
      );
    }

    writeTable(outDir, 'spirits', spiritsRows);
    writeTable(outDir, 'spirit_skills', spiritSkillLinks);
    result.parts.spirits = { count: spiritsRows.length, with_detail: spiritsDetail.length };
  }

  // 3) 技能
  if (cfg.parts.includes('skills')) {
    process.stderr.write('· 技能 id 列表\n');
    const ids = new Set();
    const SORTS = ['energy_desc', 'damage_desc', 'name_asc'];
    // 主排序就能覆盖全部 id，其余排序作为兜底
    for (const sort of SORTS) {
      for (let page = 0; ; page++) {
        let d;
        try {
          d = await fetcher.getJson(`${S}/skill-list/${sort}/all/${page}.json`);
        } catch (e) {
          if (e.status === 404) break;
          throw e;
        }
        const before = ids.size;
        for (const id of d.ids ?? []) ids.add(id);
        if (!d.ids?.length || page > 60 || (sort !== SORTS[0] && ids.size === before)) break;
        if (sort === SORTS[0] && ids.size >= (d.total ?? 0)) break;
      }
      if (ids.size >= (manifest.counts?.[locale]?.skills ?? Infinity)) break;
    }
    process.stderr.write(`  ${ids.size} 个技能 id\n· 技能详情\n`);
    const skills = await mapLimit([...ids], cfg.concurrency, async (id) => {
      try {
        return await fetcher.getJson(`${S}/skill/${id}.json`);
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    });
    const ok = skills.filter(Boolean);
    skillsRows = ok.map((s) => skillRow(s, typeById));
    skillLearnerLinks = ok.flatMap((s) => skillLearnerRows(s));
    writeTable(outDir, 'skills', skillsRows);
    writeTable(outDir, 'skill_learners', skillLearnerLinks);
    result.parts.skills = { count: skillsRows.length };
  }

  // 4) 系别 / 克制表
  if (cfg.parts.includes('types')) {
    process.stderr.write('· 系别 + 克制表\n');
    const t = typesData ?? (await fetcher.getJson(`${S}/types.json`));
    const rows = (t.types ?? []).map((x) => ({
      id: x.id,
      name: norm(x.name),
      short_name: x.short_name,
      color: x.color,
      display_order: x.display_order,
      status_immunities: (x.status_immunities ?? []).map((s) => s.name).join(' / '),
      icon_url: x.type_icon_image_url ? ORIGIN + x.type_icon_image_url : '',
    }));
    const effectName = t.effect_values ?? {};
    const matchups = (t.matchups ?? []).map((m) => ({
      attacking_type_id: m.attacking_type_id,
      attacking_type: typeById.get(m.attacking_type_id)?.name ?? '',
      defending_type_id: m.defending_type_id,
      defending_type: typeById.get(m.defending_type_id)?.name ?? '',
      effect: m.effect,
      effect_label:
        Object.entries(effectName).find(([, v]) => v === m.effect)?.[0] ??
        (m.effect === 0 ? 'neutral' : m.effect > 0 ? 'counter' : 'resisted'),
    }));
    writeTable(outDir, 'types', rows);
    writeTable(outDir, 'type_matchups', matchups);
    typesData = t;
    result.parts.types = { types: rows.length, matchups: matchups.length };
  }

  // 5) 队伍
  if (cfg.parts.includes('teams')) {
    process.stderr.write('· 推荐队伍\n');
    const t = await fetcher.getJson(`${S}/teams.json`);
    const teams = [];
    const members = [];
    for (const raw of t.results ?? []) {
      const { team, members: ms } = teamRows(raw, typeById);
      teams.push(team);
      ms.forEach((m, seat) => members.push({ team_id: team.id, team_name: team.name, seat: seat + 1, ...m }));
    }
    writeTable(outDir, 'teams', teams);
    writeTable(outDir, 'team_members', members);
    await fsp.writeFile(path.join(outDir, 'teams.json'), JSON.stringify(t.results ?? [], null, 1));
    teamsData = t;
    teamList = teams;
    teamMemberList = members;
    result.parts.teams = { count: teams.length };
  }

  // 6) 术语 / 状态词条
  if (cfg.parts.includes('glossary')) {
    process.stderr.write('· 术语词条\n');
    const g = await fetcher.getJson(`${S}/description_notes.json`);
    const rows = (g.results ?? []).map((n) => ({
      note_id: n.note_id ?? n.id,
      note: norm(n.note),
      description: norm(n.description),
      used_by_skill_count: (n.used_by_skills ?? []).length,
      used_by_skills: (n.used_by_skills ?? []).map((s) => s.name).join(' / '),
      icon_key: n.icon_key ?? '',
    }));
    writeTable(outDir, 'glossary', rows);
    glossaryData = g;
    glossaryList = rows;
    result.parts.glossary = { count: rows.length };
  }

  // 7) 图片资源
  if (cfg.assets) {
    process.stderr.write('· 图片资源（约 ' + (manifest.image_files ?? 0) + " 个，耗时较长）\n");
    const assetDir = path.join(outDir, 'assets');
    // 从已抓到的数据里汇总图片路径
    const urls = new Set();
    const add = (u) => {
      if (!u) return;
      const p = String(u).replace(ORIGIN, '');
      if (p.startsWith('/assets/')) urls.add(ORIGIN + p);
    };
    for (const r of spiritsRows) {
      add(r.image_url);
      add(r.head_image_url);
      add(r.portrait_small_url);
    }
    for (const r of skillsRows) add(r.image_url);
    for (const t of typesData?.types ?? []) add(t.type_icon_image_url && ORIGIN + t.type_icon_image_url);
    const list = [...urls];
    process.stderr.write(`  ${list.length} 个文件\n`);
    await mapLimit(list, cfg.concurrency, async (u) => {
      const rel = decodeURIComponent(new URL(u).pathname.replace(/^\/assets\//, ''));
      try {
        await fetcher.getBinary(u, path.join(assetDir, rel));
      } catch (e) {
        if (e.message?.includes('404')) return;
        throw e;
      }
    });
    result.parts.assets = { count: list.length };
  }

  // 8) SQLite
  if (cfg.sqlite) {
    try {
      await buildSqlite(path.join(cfg.out, 'roco.sqlite'), locale, {
        spiritsRows,
        spiritSkillLinks,
        skillsRows,
        skillLearnerLinks,
        typeById,
        typesPayload: typesData,
        teamList,
        teamMemberList,
        glossaryList,
      });
      process.stderr.write('· 已写入 out/roco.sqlite\n');
    } catch (e) {
      process.stderr.write(`· 写入 sqlite 失败（${e.message}）\n`);
      if (cfg.verbose) process.stderr.write(String(e.stack) + '\n');
    }
  }

  // 9) 汇总
  result.fetched_at = nowIso();
  result.duration_ms = Date.now() - t0;
  result.http = fetcher.stats;
  await fsp.writeFile(path.join(cfg.out, `summary-${locale}.json`), JSON.stringify(result, null, 1));

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  process.stderr.write(
    `✓ 完成 ${secs}s  网络请求 ${fetcher.stats.net} 次 / 缓存命中 ${fetcher.stats.hit} 次 / 404 ${fetcher.stats.miss} 次 / 下载 ${(
      fetcher.stats.bytes / 1048576
    ).toFixed(1)} MB\n  输出目录: ${path.resolve(cfg.out)}\n`,
  );
  process.stdout.write(JSON.stringify(result, null, 1) + '\n');
}

function writeTable(dir, name, rows) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name + '.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  const cols = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  fs.writeFileSync(path.join(dir, name + '.csv'), toCsv(rows, cols));
}

// ---------------------------------------------------------------- SQLite
/** 每张表的建表语句，单独放一份，供首次创建和「结构漂移重建」共用 */
const CREATE_SQL = {
  spirit: `CREATE TABLE IF NOT EXISTS spirit (
      locale TEXT, handbook_id INTEGER, petbase_id INTEGER, form_id INTEGER,
      name TEXT, form TEXT, evolution_stage INTEGER, type_ids TEXT, types TEXT, type_count INT,
      stat_hp INT, stat_physical_attack INT, stat_special_attack INT,
      stat_physical_defense INT, stat_special_defense INT, stat_speed INT,
      base_stat_total INT, passive_skill_name TEXT, passive_skill_desc TEXT,
      egg_groups TEXT, family TEXT, skill_count INT, image_url TEXT, head_image_url TEXT,
      portrait_small_url TEXT, detail_url TEXT,
      PRIMARY KEY (locale, handbook_id, form_id))`,
  skill: `CREATE TABLE IF NOT EXISTS skill (
      locale TEXT, id INTEGER, name TEXT, category TEXT, damage_type TEXT,
      battle_type TEXT, energy_cost INT, damage_min INT, damage_max INT,
      cooldown_min INT, cooldown_max INT, is_passive INT,
      used_by_petbase_count INT, learner_count INT, description TEXT, image_url TEXT,
      PRIMARY KEY (locale, id))`,
  spirit_skill: `CREATE TABLE IF NOT EXISTS spirit_skill (
      locale TEXT, handbook_id INT, form_id INT, spirit_name TEXT,
      skill_id INT, skill_name TEXT, source_type TEXT, source_order INT, unlock_level INT,
      category TEXT, damage_type TEXT, description TEXT,
      PRIMARY KEY (locale, handbook_id, form_id, skill_id, source_type, source_order))`,
  skill_learner: `CREATE TABLE IF NOT EXISTS skill_learner (
      locale TEXT, skill_id INT, skill_name TEXT, handbook_id INT, form_id INT,
      spirit_name TEXT, form TEXT, source_group TEXT, unlock_level INT)`,
  type: `CREATE TABLE IF NOT EXISTS type (locale TEXT, id INTEGER, name TEXT, short_name TEXT, color TEXT, status_immunities TEXT, PRIMARY KEY (locale, id))`,
  type_matchup: `CREATE TABLE IF NOT EXISTS type_matchup (locale TEXT, attacking_type_id INT, defending_type_id INT, effect INT, PRIMARY KEY (locale, attacking_type_id, defending_type_id))`,
  team: `CREATE TABLE IF NOT EXISTS team (
      locale TEXT, id TEXT, name TEXT, author TEXT, created_date TEXT,
      battle_item TEXT, member_count INT, members TEXT, url TEXT,
      PRIMARY KEY (locale, id))`,
  team_member: `CREATE TABLE IF NOT EXISTS team_member (
      locale TEXT, team_id TEXT, team_name TEXT, seat INT, handbook_id INT, petbase_id INT,
      name TEXT, form TEXT, types TEXT, variant TEXT, bloodline TEXT, item TEXT)`,
  glossary: `CREATE TABLE IF NOT EXISTS glossary (
      locale TEXT, note_id INT, note TEXT, description TEXT,
      used_by_skill_count INT, used_by_skills TEXT, icon_key TEXT,
      PRIMARY KEY (locale, note_id))`,
};
const COLUMN_TYPE = {
  type_count: 'INT', types: 'TEXT', seat: 'INT', skills: 'TEXT', note_id: 'INT',
  used_by_skill_count: 'INT', used_by_skills: 'TEXT', icon_key: 'TEXT',
  source_order: 'INT',
};
/** 各表期望的主键，用于检测需要重建的旧结构 */
const PK = {
  spirit: ['locale', 'handbook_id', 'form_id'],
  skill: ['locale', 'id'],
  spirit_skill: ['locale', 'handbook_id', 'form_id', 'skill_id', 'source_type', 'source_order'],
  skill_learner: [],
  team: ['locale', 'id'],
  team_member: [],
  glossary: ['locale', 'note_id'],
  type: ['locale', 'id'],
  type_matchup: ['locale', 'attacking_type_id', 'defending_type_id'],
};

async function buildSqlite(file, locale, data) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    return;
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  for (const sql of Object.values(CREATE_SQL)) db.exec(sql + ';');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ss ON spirit_skill(locale, handbook_id);
    CREATE INDEX IF NOT EXISTS idx_sl ON skill_learner(locale, skill_id);
    CREATE INDEX IF NOT EXISTS idx_tm ON team_member(locale, team_id);
  `);

  const tables = {
    spirit: [
      'locale', 'handbook_id', 'petbase_id', 'form_id', 'name', 'form', 'evolution_stage', 'type_ids', 'types',
      'type_count',
      'stat_hp', 'stat_physical_attack', 'stat_special_attack', 'stat_physical_defense', 'stat_special_defense',
      'stat_speed', 'base_stat_total', 'passive_skill_name', 'passive_skill_desc', 'egg_groups', 'family',
      'skill_count', 'image_url', 'head_image_url', 'portrait_small_url', 'detail_url',
    ],
    skill: [
      'locale', 'id', 'name', 'category', 'damage_type', 'battle_type', 'energy_cost', 'damage_min', 'damage_max',
      'cooldown_min', 'cooldown_max', 'is_passive', 'used_by_petbase_count', 'learner_count', 'description', 'image_url',
    ],
    spirit_skill: [
      'locale', 'handbook_id', 'form_id', 'spirit_name', 'skill_id', 'skill_name', 'source_type',
      'source_order', 'unlock_level', 'category', 'damage_type', 'description',
    ],
    skill_learner: [
      'locale', 'skill_id', 'skill_name', 'handbook_id', 'form_id', 'spirit_name', 'form', 'source_group', 'unlock_level',
    ],
    team: ['locale', 'id', 'name', 'author', 'created_date', 'battle_item', 'member_count', 'members', 'url'],
    team_member: [
      'locale', 'team_id', 'team_name', 'seat', 'handbook_id', 'petbase_id', 'name', 'form', 'types',
      'variant', 'bloodline', 'item',
    ],
    glossary: [
      'locale', 'note_id', 'note', 'description', 'used_by_skill_count', 'used_by_skills', 'icon_key',
    ],
  };

  // 表结构漂移处理：CREATE TABLE IF NOT EXISTS 不会改已存在的表，
  // 所以这里对每张表做一次「缺列补齐 / 结构不符则重建」，避免写入时报
  // "table X has no column named Y"（这种失败会先删掉旧数据，更难发现）。
  const expected = {
    spirit: tables.spirit, skill: tables.skill, spirit_skill: tables.spirit_skill,
    skill_learner: tables.skill_learner, team: tables.team, team_member: tables.team_member,
    glossary: tables.glossary,
    type: ['locale', 'id', 'name', 'short_name', 'color', 'status_immunities'],
    type_matchup: ['locale', 'attacking_type_id', 'defending_type_id', 'effect'],
  };
  for (const [table, want] of Object.entries(expected)) {
    const info = db.prepare(`PRAGMA table_info(${table})`).all();
    const cur = info.map((c) => c.name);
    const missing = want.filter((c) => !cur.includes(c));
    const extra = cur.filter((c) => !want.includes(c));
    // 主键也要核对：老库少了主键列（例如 source_order），只补列仍会把重复行吞掉
    const pkNow = info.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    const pkWant = PK[table] ?? [];
    const pkChanged = pkNow.join(',') !== pkWant.join(',');
    if (!missing.length && !pkChanged) continue;
    if (extra.length || pkChanged) {
      // 结构不符：重建（数据可以重抓，不值得写迁移）
      db.exec(`DROP TABLE ${table}`);
      db.exec(CREATE_SQL[table]);
      process.stderr.write(`  · ${table} 结构变了，已重建${pkChanged ? `（主键 ${pkNow.join('+') || '无'} → ${pkWant.join('+')}）` : ''}\n`);
    } else {
      for (const c of missing) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${c} ${COLUMN_TYPE[c] ?? 'TEXT'}`);
        process.stderr.write(`  · ${table} 补列 ${c}\n`);
      }
    }
  }

  const bind = (dbh, table, cols) =>
    dbh.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
  /** 只替换本次真正抓到的表 + 当前 locale，避免部分抓取把其它表清空 */
  const replaceLocale = (table, cols) => {
    // sqlite 里双引号是标识符，字符串必须用单引号或参数绑定
    db.prepare(`DELETE FROM ${table} WHERE locale = ?`).run(locale);
    return bind(db, table, cols);
  };

  const stSpirit = data.spiritsRows?.length ? replaceLocale('spirit', tables.spirit) : null;
  for (const r of data.spiritsRows ?? []) {
    const vals = tables.spirit.map((c) => {
      if (c === 'locale') return locale;
      const v = r[c];
      return v === undefined ? null : Array.isArray(v) || typeof v === 'object' ? JSON.stringify(v) : v;
    });
    stSpirit.run(...vals);
  }
  const stSkill = data.skillsRows?.length ? replaceLocale('skill', tables.skill) : null;
  for (const r of data.skillsRows ?? []) {
    stSkill.run(...tables.skill.map((c) => (c === 'locale' ? locale : r[c] === undefined ? null : r[c])));
  }

  // spirit_skill 直接用行里自带的 form_id（不能用 handbook_id 反查，
  // 同一个图鉴编号有多个形态，反查会把所有形态都写成同一个 form_id）
  const stSS = data.spiritSkillLinks?.length ? replaceLocale('spirit_skill', tables.spirit_skill) : null;
  for (const r of data.spiritSkillLinks ?? []) {
    stSS.run(
      locale, r.handbook_id, r.form_id, r.spirit_name, r.skill_id, r.skill_name,
      r.source_type, r.source_order === '' ? null : r.source_order,
      r.unlock_level === '' ? null : r.unlock_level, r.category, r.damage_type, r.description,
    );
  }
  const stSL = data.skillLearnerLinks?.length ? replaceLocale('skill_learner', tables.skill_learner) : null;
  for (const r of data.skillLearnerLinks ?? []) {
    stSL.run(
      locale, r.skill_id, r.skill_name, r.handbook_id === '' ? null : r.handbook_id,
      r.form_id === '' ? null : r.form_id, r.spirit_name, r.form, r.group,
      r.unlock_level === '' ? null : r.unlock_level,
    );
  }

  // 队伍 / 术语
  if (data.teamList?.length) {
    const stTeam = replaceLocale('team', tables.team);
    for (const r of data.teamList) stTeam.run(...tables.team.map((c) => (c === 'locale' ? locale : r[c] ?? null)));
  }
  if (data.teamMemberList?.length) {
    const stTM = replaceLocale('team_member', tables.team_member);
    for (const r of data.teamMemberList) stTM.run(...tables.team_member.map((c) => (c === 'locale' ? locale : r[c] ?? null)));
  }
  if (data.glossaryList?.length) {
    const stG = replaceLocale('glossary', tables.glossary);
    for (const r of data.glossaryList) stG.run(...tables.glossary.map((c) => (c === 'locale' ? locale : r[c] ?? null)));
  }

  // 系别与克制表：用 types.json 直接写，保证任何部分抓取后都可用
  const tp = data.typesPayload;
  if (tp) {
    db.prepare('DELETE FROM type WHERE locale = ?').run(locale);
    const stType = bind(db, 'type', ['locale', 'id', 'name', 'short_name', 'color', 'status_immunities']);
    for (const t of tp.types ?? []) {
      stType.run(locale, t.id, norm(t.name), t.short_name ?? null, t.color ?? null,
        (t.status_immunities ?? []).map((s) => s.name).join(' / '));
    }
    db.prepare('DELETE FROM type_matchup WHERE locale = ?').run(locale);
    const stM = bind(db, 'type_matchup', ['locale', 'attacking_type_id', 'defending_type_id', 'effect']);
    for (const m of tp.matchups ?? []) stM.run(locale, m.attacking_type_id, m.defending_type_id, m.effect);
  }
  db.close();
}

main().catch((e) => {
  process.stderr.write('\n✗ 失败: ' + (e?.stack ?? e) + '\n');
  process.exit(1);
});
