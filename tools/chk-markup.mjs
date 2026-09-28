/**
 * 描述富文本自检：确认 web/data-bundle.js 里的标记处理正确。
 *
 * 站点描述里实测只有两类标记：
 *   <desc_id=1015>应对状态</>        术语链接（1015 -> glossary.note_id）
 *   <span fork_road="or">或</>       分支连接词
 *
 * 期望：
 *   - desc（富文本）里保留标记，交给前端 glossaryTag() 渲染
 *   - descPlain（纯文本）里不残留任何标记，用于搜索/复制
 *
 * 用法: node tools/chk-markup.mjs
 */
import fs from 'node:fs';

const bundle = 'web/data-bundle.js';
if (!fs.existsSync(bundle)) {
  console.error(`✗ 找不到 ${bundle}，先跑 node web/export-data.mjs`);
  process.exit(1);
}
const D = JSON.parse(fs.readFileSync(bundle, 'utf8').replace(/^window\.ROCO_DATA=/, '').replace(/;\s*$/, ''));

const rich = [];   // 富文本条目
for (const s of D.skills) rich.push(['skill', s.id, s.name, s.desc, s.descPlain]);
for (const g of D.glossary) rich.push(['glossary', g.id, g.name, g.desc, g.descPlain]);
for (const s of D.spirits) if (s.passive) rich.push(['passive', s.id, s.name, s.passive.desc, s.passive.descPlain]);

let bad = 0;

// 1) descPlain 不应有标记
const dirty = rich.filter(([, , , , plain]) => /<[^>]*>/.test(plain ?? ''));
console.log(`· descPlain 里残留标记的条目: ${dirty.length}`);
if (dirty.length) {
  bad++;
  for (const d of dirty.slice(0, 5)) console.log(`    ${d[0]} ${d[2]}: ${d[4]}`);
}

// 2) 富文本里出现的标记形态（前端必须支持全部）
const tags = new Map();
const add = (d) => { for (const m of String(d ?? '').matchAll(/<[^<>]{1,60}>/g)) { const k = m[0].replace(/=\d+/, '=N'); tags.set(k, (tags.get(k) ?? 0) + 1); } };
for (const [, , , d] of rich) add(d);
console.log('\n· 富文本里的标记形态（app.js 的 glossaryTag 需覆盖）:');
const SUPPORTED = ['<desc_id=N>', '<span fork_road="or">', '</>'];
for (const [k, v] of [...tags.entries()].sort((a, b) => b[1] - a[1])) {
  const supported = SUPPORTED.includes(k);
  if (!supported) bad++;
  console.log(`    ${supported ? '✓' : '✗'} ${String(v).padStart(6)}  ${k}`);
}

// 3) 术语 id 是否都能在 glossary 里找到（找不到时前端只显示文字，不报错）
const known = new Set(D.glossary.map((g) => g.id));
const used = new Set();
for (const [, , , d] of rich) for (const m of String(d ?? '').matchAll(/<desc_id=(\d+)>/g)) used.add(Number(m[1]));
const unknown = [...used].filter((i) => !known.has(i));
console.log(`\n· 被引用的术语 ${used.size} 个，找不到定义的 ${unknown.length} 个 ${unknown.slice(0, 8).join(',')}`);
if (unknown.length) bad++;

// 4) 抽样打印
const sample = rich.find(([, , , d]) => /fork_road/.test(d ?? ''));
if (sample) {
  console.log(`\n· fork_road 样例（${sample[2]}）:`);
  console.log('    desc     : ' + sample[3]);
  console.log('    descPlain: ' + sample[4]);
}
const t = rich.find(([, , , d]) => /<desc_id/.test(d ?? ''));
if (t) {
  console.log(`\n· desc_id 样例（${t[2]}）:`);
  console.log('    desc     : ' + t[3]);
  console.log('    descPlain: ' + t[4]);
}

console.log(bad ? `\n✗ ${bad} 项需要处理` : '\n✓ 标记处理正确');
process.exit(bad ? 1 : 0);
