/**
 * 从我们自己的数据（out/<locale>/glossary.jsonl + skills.jsonl）抽出【状态与印记】数据集。
 *
 * 为什么不用第三方整理的数据：rocopvp 的页脚声明"自建数据保留权利"，
 * 所以状态表改由我们自己的上游（roco.world 术语库）抽取 —— 它本来就是官方词条，
 * 54 条术语里包含 13 种印记、3 种天气、中毒/灼烧/冻结等状态与各类机制词。
 *
 * 产出 out/zh-Hans/status.jsonl，字段：
 *   key          稳定键（icon_key，用来找图标）
 *   name         名称
 *   kind         分类：mark 印记 / weather 天气 / status 状态 / buff 增益减益 /
 *                counter 应对 / mechanic 机制 / field 场地相关
 *   desc         描述（把 <desc_id=N> 换成该词条名，纯文本）
 *   refs         引用到的其它词条 key 列表
 *   icon         图标相对路径（由 export-data 落到 meta.statusIcons）
 *   usedBy       引用该词条的技能名列表
 *   n            引用技能数
 */
import fs from 'node:fs';
import path from 'node:path';

const LOCALE = process.env.ROCO_LOCALE ?? 'zh-Hans';
const SRC = path.join('out', LOCALE);
const glossary = fs.readFileSync(path.join(SRC, 'glossary.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));

const byId = new Map(glossary.map((g) => [g.note_id, g]));

/** 把描述里的交叉引用与标记清成纯文本，同时记录引用到的词条 */
function cleanDesc(raw) {
  const refs = [];
  const text = String(raw ?? '')
    // <desc_id=3010>印记</> -> 印记（并记下引用）
    .replace(/<desc_id=(\d+)>([^<]*)<\/>/g, (_, id, inner) => {
      const target = byId.get(Number(id));
      if (target) refs.push(target.note_id);
      return inner || target?.note || '';
    })
    // 其它成对标记 <xxx>…</> 直接去掉标签
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { text, refs: [...new Set(refs)] };
}

/** 分类规则：以"印记""天气""应对""场地"等词条语义为准（不照搬外部命名） */
function kindOf(g) {
  const name = g.note;
  const desc = g.description ?? '';
  if (/印记$/.test(name)) return 'mark';
  if (['沙暴', '暴风雪', '雨天', '雷鸣'].includes(name)) return 'weather';
  if (/^应对/.test(name)) return 'counter';
  if (['增益', '减益', '属性增益', '属性减益'].includes(name)) return 'buff';
  if (['离场', '返场', '脱离', '紧急脱离'].includes(name)) return 'leave';
  if (/状态$/.test(name)) return 'status';
  if (['中毒', '灼烧', '冻结', '寄生', '中毒效果', '附加中毒', '引电', '禁足'].includes(name)) return 'status';
  if (['印记', '连击数', '先手', '吸血', '传动', '巧变', '选择', '萌化', '蓄力'].includes(name)) return 'mechanic';
  if (desc.includes('天气')) return 'weather';
  return 'mechanic';
}

// 技能里引用该词条的（used_by_skills 已由抓取端给好）
const out = glossary.map((g) => {
  const { text, refs } = cleanDesc(g.description);
  return {
    key: g.icon_key,
    name: g.note,
    noteId: g.note_id,
    kind: kindOf(g),
    desc: text,
    refs: refs.map((id) => byId.get(id)?.icon_key).filter(Boolean),
    usedBy: (g.used_by_skills ?? '').split(' / ').map((s) => s.trim()).filter(Boolean),
    n: g.used_by_skill_count ?? 0,
  };
});

fs.writeFileSync(path.join(SRC, 'status.jsonl'), out.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

const kinds = {};
for (const r of out) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
console.log(`写出 out/${LOCALE}/status.jsonl —— ${out.length} 条`);
console.log('分类分布:', JSON.stringify(kinds));
console.log('\n印记（mark）:');
for (const r of out.filter((x) => x.kind === 'mark')) console.log(`  ${r.name}  [${r.key}]  引用 ${r.n} 个技能  ${r.desc.slice(0, 50)}`);
console.log('\n天气（weather）:');
for (const r of out.filter((x) => x.kind === 'weather')) console.log(`  ${r.name}  [${r.key}]  ${r.desc.slice(0, 50)}`);
console.log('\n状态（status）:');
for (const r of out.filter((x) => x.kind === 'status')) console.log(`  ${r.name}  [${r.key}]  引用 ${r.n}  ${r.desc.slice(0, 50)}`);
console.log('\n带交叉引用的:');
for (const r of out.filter((x) => x.refs.length)) console.log(`  ${r.name} -> ${r.refs.join(', ')}`);
