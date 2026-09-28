import fs from 'node:fs';

const C = 'out/.cache/';
const m = JSON.parse(fs.readFileSync(C + fs.readdirSync(C).find((x) => x.includes('manifest')), 'utf8'));
console.log('=== manifest.capabilities ===');
console.log(JSON.stringify(m.capabilities, null, 1));
console.log('\n=== static_url_prefix / asset_url_prefix ===');
console.log(m.static_url_prefix, '|', m.asset_url_prefix);

console.log('\n=== 试探原站是否有性格/天分相关接口 ===');
const base = 'https://roco.world';
const ver = m.catalog_version;
const cands = [
  `/static/${ver}/zh-Hans/natures.json`,
  `/static/${ver}/zh-Hans/nature.json`,
  `/static/${ver}/zh-Hans/talents.json`,
  `/static/${ver}/zh-Hans/aptitudes.json`,
  `/static/${ver}/zh-Hans/personalities.json`,
  `/static/${ver}/zh-Hans/individuals.json`,
  `/static/${ver}/zh-Hans/stat-natures.json`,
  `/static/${ver}/zh-Hans/config.json`,
  `/static/${ver}/zh-Hans/constants.json`,
  `/static/${ver}/zh-Hans/calculator.json`,
  `/static/${ver}/zh-Hans/capabilities.json`,
];
for (const p of cands) {
  try {
    const r = await fetch(base + p, { headers: { 'user-agent': 'Mozilla/5.0' } });
    let extra = '';
    if (r.ok) {
      const t = await r.text();
      extra = `  <-- 有内容! ${t.length} 字节, 开头: ${t.slice(0, 120)}`;
    }
    console.log(`  ${r.status}  ${p}${extra}`);
  } catch (e) {
    console.log(`  ERR ${p}  ${e.message}`);
  }
}
