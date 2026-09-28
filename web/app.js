/* ============================================================
   洛克王国：世界 图鉴浏览器
   ------------------------------------------------------------
   数据来源：同目录 data-bundle.js（单文件包，file:// 直接可用）
             或 data/*.json（部署到静态托管时更省流量）
   无任何第三方依赖，纯原生 DOM
   ============================================================ */
'use strict';

/* ---------------------------------------------------------- 常量 */
const STAT_KEYS = [
  { k: 'hp', label: '生命', icon: 'hp' },
  { k: 'patk', label: '物攻', icon: 'physical_attack' },
  { k: 'satk', label: '魔攻', icon: 'special_attack' },
  { k: 'pdef', label: '物防', icon: 'physical_defense' },
  { k: 'sdef', label: '魔防', icon: 'special_defense' },
  { k: 'spd', label: '速度', icon: 'speed' },
];
const STAT_MAX = { hp: 200, patk: 180, satk: 180, pdef: 180, sdef: 180, spd: 180 };
const SRC_LABEL = { level: '升级学会', machine: '技能石', blood: '血脉', passive: '被动' };
const GROUP_LABEL = { level_up: '升级学会', spirit_stone: '技能石', bloodline_elixir: '血脉' };
const EFFECT_LABEL = { 2: '双重克制', 1: '克制', 0: '普通', '-1': '被抵抗', '-2': '双重抵抗' };

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
  // 没有单文件包时（例如托管环境只上传了 data/），退回逐文件 fetch
  const names = ['meta', 'spirits', 'skills', 'matchups', 'teams', 'glossary', 'spirit-skills', 'skill-learners'];
  const loaded = await Promise.all(names.map((n) => fetch(`data/${n}.json`).then((r) => {
    if (!r.ok) throw new Error(`${n}.json HTTP ${r.status}`);
    return r.json();
  })));
  const [meta, spirits, skills, matchups, teams, glossary, spiritSkills, skillLearners] = loaded;
  return { meta, spirits, skills, matchups, teams, glossary, spiritSkills, skillLearners };
}

function index(data) {
  STATE.data = data;
  for (const s of data.spirits) STATE.bySpirit.set(`${s.id}:${s.formId}`, s);
  for (const s of data.skills) STATE.bySkill.set(s.id, s);
  for (const t of data.meta.types) STATE.typeById.set(t.id, t);
  STATE.glossaryById = new Map((data.glossary ?? []).map((g) => [g.id, g]));
  STATE.statIconByStat = new Map((data.meta.statIcons ?? []).map((x) => [x.stat, x]));
}

/* ------------------------------------------------------ 展示辅助 */
const typeName = (id) => STATE.typeById.get(id)?.name ?? '';
const typeShort = (id) => STATE.typeById.get(id)?.short ?? typeName(id);
const typeColor = (id) => STATE.typeById.get(id)?.color ?? '#7a8699';

function badge(id, ghost = false) {
  const t = STATE.typeById.get(id);
  if (!t) return '';
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

// 精灵的技能：level 按解锁等级，machine/blood 按名字；被动单列
function spiritSkillsOf(sp) {
  const raw = STATE.data.spiritSkills[`${sp.id}:${sp.formId}`] ?? [];
  const out = { level: [], machine: [], blood: [], passive: [] };
  for (const r of raw) {
    const sk = STATE.bySkill.get(r.id);
    if (!sk) continue;
    const bucket = out[r.src] ?? (out[r.src] = []);
    bucket.push({ ...sk, lv: r.lv, ord: r.ord, src: r.src });
  }
  out.level.sort((a, b) => (a.lv ?? 999) - (b.lv ?? 999) || (a.name > b.name ? 1 : -1));
  out.machine.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  out.blood.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
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
const VIEWS = ['spirits', 'skills', 'types', 'teams', 'glossary'];
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
          <td class="num">${s.dmgMax ?? ''}${s.dmgMin !== s.dmgMax && s.dmgMin != null ? `<span class="desc"> (${s.dmgMin}~)</span>` : ''}</td>
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
  const cellCls = (e) => (e === 2 ? 'mx-2' : e === 1 ? 'mx-1' : e === 0 ? 'mx0' : e === -1 ? 'mx-n1' : e === -2 ? 'mx-n2' : 'mx-na');
  const cellText = (e) => (e === 2 ? '×2' : e === 1 ? '×1' : e === 0 ? '1' : e === -1 ? '½' : e === -2 ? '¼' : '');

  const header = tlist.map((t) => `<th title="${esc(t.name)}">${badge(t.id)}</th>`).join('');
  const rows = tlist.map((atk) => `
    <tr>
      <th class="rowhead">${badge(atk.id)}</th>
      ${tlist.map((def) => {
        const e = ef.get(`${atk.id}:${def.id}`) ?? 0;
        return `<td class="${cellCls(e)}" title="${esc(atk.name)} → ${esc(def.name)}：${EFFECT_LABEL[e] ?? e}">${cellText(e)}</td>`;
      }).join('')}
    </tr>`).join('');

  const immun = tlist.filter((t) => t.immunities?.length).map((t) => `
    <tr><td class="mid">${badge(t.id)}</td><td>${t.immunities.map(esc).join('、')}</td></tr>`).join('');

  return `
  <div class="page-head">
    <h1>系别克制</h1>
    <span class="sub">${tlist.length} 个系别 · ${STATE.data.matchups.length} 条克制关系</span>
  </div>
  <div class="panel">
    <div class="frow" style="gap:14px;color:var(--text-dim);font-size:12px">
      <span><b class="mx-1" style="padding:1px 6px;border-radius:4px">×1</b> 克制</span>
      <span><b class="mx-2" style="padding:1px 6px;border-radius:4px">×2</b> 双重克制</span>
      <span><b class="mx0" style="padding:1px 6px;border-radius:4px">1</b> 普通</span>
      <span><b class="mx-n1" style="padding:1px 6px;border-radius:4px">½</b> 被抵抗</span>
      <span><b class="mx-n2" style="padding:1px 6px;border-radius:4px">¼</b> 双重抵抗</span>
      <span>读法：<b>行</b>=攻击方系别，<b>列</b>=防守方系别</span>
    </div>
  </div>
  <div class="panel matchup-wrap"><table class="matrix">
    <thead><tr><th></th>${header}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  ${immun ? `<div class="panel"><h3 style="margin:0 0 8px;font-size:15px">状态免疫</h3>
    <table><tbody>${immun}</tbody></table></div>` : ''}`;
}

/* ============================================================
   视图：推荐队伍
   ============================================================ */
function viewTeams() {
  const teams = STATE.data.teams;
  return `
  <div class="page-head">
    <h1>推荐队伍</h1>
    <span class="sub">共 ${teams.length} 支（来自站点整理的玩家配队）</span>
  </div>
  ${teams.length ? `<div class="teams">${teams.map(teamCard).join('')}</div>` : '<div class="empty">暂无队伍数据</div>'}`;
}

function teamCard(t) {
  const members = (t.members ?? []).map((m) => {
    const sp = STATE.bySpirit.get(`${m.id}:1`) ?? STATE.bySpirit.get(`${m.id}:${m.formId ?? 1}`);
    const head = sp?.head, online = sp?.headOnline;
    return `
    <div class="member" data-spirit="${m.id}:1" title="${esc(m.name)}${m.bloodline ? ' · ' + esc(m.bloodline) : ''}">
      ${head || online ? imgTag(head, online, m.name) : '<div style="height:56px"></div>'}
      <div class="mn">${esc(m.name)}</div>
      <div class="mb">${esc(m.bloodline || '')}</div>
    </div>`;
  }).join('');
  return `
  <div class="team">
    <h3>${esc(t.name)}</h3>
    <div class="by">${esc(t.author || '佚名')}${t.date ? ' · ' + esc(t.date) : ''}</div>
    <div class="members">${members}</div>
    ${t.item ? `<div class="item">战斗道具：<b>${esc(t.item)}</b></div>` : ''}
  </div>`;
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
    </div>`).join('')}</div>` : '<div class="empty">没有匹配的词条</div>'}`;
}

/* ============================================================
   详情弹窗
   ============================================================ */
function openModal(html) {
  $('#modalBody').innerHTML = html;
  $('#modal').hidden = false;
  $('.modal-panel').scrollTop = 0;
  document.body.style.overflow = 'hidden';
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

  // 数据多边形：每项按自己的上限缩放
  const points = STAT_KEYS.map(({ k }, i) => {
    const v = Math.max(0, stats[k] ?? 0);
    const ratio = Math.min(1, v / (STAT_MAX[k] ?? 180));
    return pt(i, R * Math.max(0.09, ratio));
  });
  const poly = points.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join(' ') + ' Z';
  const dots = points.map(([x, y], i) =>
    `<circle class="radar-dot s-${STAT_KEYS[i].k}" cx="${f(x)}" cy="${f(y)}" r="3"/>`).join('');

  // 外侧标签：图标（当 CSS mask 用，按数值染色）+ 数值
  // 注意：内部统计键是缩写（patk/satk…），而 stat_icons 表用的是上游的完整名
  // （physical_attack/special_attack…），靠 STAT_KEYS[].icon 做映射，
  // 直接用 k 去查会只有 hp 命中（踩过）。
  const labels = STAT_KEYS.map(({ k, label, icon: iconKey }, i) => {
    const [x, y] = pt(i, R + 24);
    const v = stats[k] ?? 0;
    const ratio = Math.min(1, Math.max(0, v / (STAT_MAX[k] ?? 180)));
    const icon = STATE.statIconByStat.get(iconKey);
    const anchor = Math.abs(x - C) < 8 ? 'middle' : (x > C ? 'start' : 'end');
    // 染色的比例：数值越低越淡（对应原站的 --stat-tint-high/low）
    const tint = `--tint:${(ratio * 100).toFixed(0)}%`;
    if (icon) {
      const maskUrl = esc(icon.icon || icon.iconOnline);
      return `<g class="radar-node" style="${tint}">
        <rect class="radar-icon" x="${f(x - 11)}" y="${f(y - 20)}" width="22" height="22"
              style="-webkit-mask-image:url('${maskUrl}');mask-image:url('${maskUrl}')"/>
        <text class="radar-val" x="${f(x)}" y="${f(y + 12)}" text-anchor="${anchor}" dominant-baseline="middle">${v}</text>
      </g>`;
    }
    return `<text class="radar-label" x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" dominant-baseline="middle">${label} <tspan class="radar-val">${v}</tspan></text>`;
  }).join('');

  return `<svg class="radar" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="六维种族值雷达图：${STAT_KEYS.map(({ k, label }) => `${label} ${stats[k] ?? 0}`).join('，')}">
    ${rings}${spokes}
    <path class="radar-area" d="${poly}"/>
    ${dots}${labels}
  </svg>`;
}

function spiritDetail(key, lvFromSkillId = null) {
  const sp = STATE.bySpirit.get(key);
  if (!sp) return toast('找不到这只精灵');
  const skills = spiritSkillsOf(sp);
  const statRows = STAT_KEYS.map(({ k, label }) => {
    const v = sp.stats[k] ?? 0;
    const pct = Math.min(100, (v / (STAT_MAX[k] ?? 180)) * 100);
    return `<div class="stat"><span class="k">${label}</span>
      <div class="bar s-${k}"><i style="width:${pct}%"></i></div>
      <span class="v">${v}</span></div>`;
  }).join('');
  // 雷达图 + 数值条一起给：图看形状，条看精确值
  const statBlock = `<div class="stat-wrap">
    ${radarChart(sp.stats)}
    <div class="stat-bars">${statRows}</div>
  </div>`;

  const skillTable = (arr, withLv) => arr.length ? `
    <div class="table-wrap"><table>
      <thead><tr>${withLv ? '<th class="num">Lv</th>' : ''}<th>技能</th><th class="num">威力</th>
        <th class="num">能耗</th><th class="mid">分类</th><th class="mid">系别</th><th>效果</th></tr></thead>
      <tbody>${arr.map((s) => `
        <tr class="clickable" data-skill="${s.id}">
          ${withLv ? `<td class="num">${s.lv ?? '—'}</td>` : ''}
          <td class="skill-name">${esc(s.name)}${lvFromSkillId === s.id ? ' <span class="pill">当前</span>' : ''}</td>
          <td class="num">${s.dmgMax ?? ''}</td><td class="num">${s.energy ?? ''}</td>
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

    ${sp.passive ? `<div class="section"><h3>被动技能</h3>
      <div class="passive"><b>${esc(sp.passive.name)}</b> — ${glossaryTag(sp.passive.desc)}</div></div>` : ''}

    ${evo ? `<div class="section"><h3>进化链</h3><div class="evo">${evo}</div></div>` : ''}

    <div class="section"><h3>升级学会 <span class="n">${skills.level.length}</span></h3>${skillTable(skills.level, true)}</div>
    ${skills.machine.length ? `<div class="section"><h3>技能石 <span class="n">${skills.machine.length}</span></h3>${skillTable(skills.machine, false)}</div>` : ''}
    ${skills.blood.length ? `<div class="section"><h3>血脉 <span class="n">${skills.blood.length}</span></h3>${skillTable(skills.blood, false)}</div>` : ''}

    ${family.length > 1 ? `<div class="section"><h3>同族</h3><div class="evo">${family.map((f) => {
      const m = /^#(\d+)(.*)$/.exec(f);
      if (!m) return `<span class="pill">${esc(f)}</span>`;
      const other = STATE.bySpirit.get(`${m[1]}:1`);
      return `<div class="node${String(other?.id) === String(sp.id) && sp.formId === 1 ? ' cur' : ''}" data-spirit="${m[1]}:1">
        ${other ? imgTag(other.head, other.headOnline, other.name) : ''}<span>${esc(m[2] || ('#' + m[1]))}</span></div>`;
    }).join('<span class="arrow">·</span>')}</div></div>` : ''}

    <div class="section"><h3>快捷链接</h3>
      <div class="frow">
        <a class="chip" href="${esc(sp.url)}" target="_blank" rel="noopener">在原站打开 #${sp.id}</a>
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
        <thead><tr><th>精灵</th><th class="num">解锁等级</th><th class="mid">形态</th><th class="mid">系别</th></tr></thead>
        <tbody>${sorted.map((l) => {
          const sp = l.sp;
          return `<tr class="clickable" data-spirit="${l.id}:${l.formId}">
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
          <span class="k">威力</span><span class="v">${sk.dmgMin === sk.dmgMax ? (sk.dmgMax ?? '—') : `${sk.dmgMin} ~ ${sk.dmgMax}`}</span>
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
      <a class="chip" href="https://roco.world/zh/skills/${sk.id}" target="_blank" rel="noopener">在原站打开</a>
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
  const fns = { spirits: viewSpirits, skills: viewSkills, types: viewTypes, teams: viewTeams, glossary: viewGlossary };
  app.innerHTML = (fns[STATE.view] ?? viewSpirits)();
  bindView();
}

function bindView() {
  const app = $('#app');

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

// 详情弹窗里点精灵/技能时要切换内容，需要单独处理（避免被上面的 data-skill 干扰）
$('#modalBody').addEventListener('click', (e) => {
  const termEl = e.target.closest('[data-glossary]');
  if (termEl) return glossaryDetail(termEl.dataset.glossary);
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
    window.__roco = { STATE, filterSpirits, filterSkills, spiritSkillsOf, learnersOf, spiritDetail, skillDetail, render, index };
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
