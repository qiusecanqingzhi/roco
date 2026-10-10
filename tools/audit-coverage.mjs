/** 机制覆盖对账：把上游所有"变威力技能"跟我们的效果表逐一对上 */
import fs from 'node:fs';
import vm from 'node:vm';
import { makeEnv } from '../web/tools/dom-stub.mjs';

const bs = fs.readFileSync('web/data-bundle.js', 'utf8');
const bundle = JSON.parse(bs.replace(/^window\.ROCO_DATA\s*=\s*/, '').replace(/;\s*$/, ''));
const env = makeEnv({ withBundle: true, bundle });
vm.createContext(env.sandbox);
vm.runInContext(bs, env.sandbox);
vm.runInContext(fs.readFileSync('web/app.js', 'utf8'), env.sandbox);
await new Promise((r) => setTimeout(r, 80));
const api = env.window.__roco;
const A2 = api.STATE;

const skills = A2.data.skills;
const have = (id) => !!api.SKILL_EFFECTS[id];

console.log('=== 一、变威力技能（powerIsVariable=1）覆盖率 ===');
const varSkills = skills.filter((s) => s.powerIsVariable);
const missVar = varSkills.filter((s) => !have(s.id));
console.log(`总共 ${varSkills.length} 个；我们已实现 ${varSkills.length - missVar.length} 个；**缺 ${missVar.length} 个**`);
console.log('\n已实现：');
for (const s of varSkills.filter((s) => have(s.id))) {
  console.log(`  ✓ [${s.name}] ${api.SKILL_EFFECTS[s.id].kind}  ${s.descPlain.slice(0, 46)}`);
}
console.log('\n缺的：');
for (const s of missVar) {
  console.log(`  ✗ [${s.name}] id=${s.id} damage=${JSON.stringify(s.damage)}`);
  console.log(`      ${s.descPlain}`);
}

console.log('\n=== 二、描述里带"数值效果"但我们没进表的技能 ===');
const RE = /威力\s*[+＋-]\s*\d|威力永久|倍伤害|伤害\s*[×x]\s*\d|减伤\s*\d+%|回复\s*\d+%|获得[^，。]*[+＋]\d|每[^，。]{0,8}\d+[^，。]{0,4}(层|点|次|个)/;
const missed = skills.filter((s) => RE.test(s.descPlain) && !have(s.id) && (s.dmgMax ?? 0) > 0);
console.log(`共 ${missed.length} 个（有威力、描述里有数值、但没进效果表）`);
for (const s of missed.slice(0, 40)) {
  console.log(`  [${s.name}] id=${s.id} 威力${s.dmgMax} ${s.var ? '(变威力)' : ''}`);
  console.log(`      ${s.descPlain.slice(0, 70)}`);
}
if (missed.length > 40) console.log(`  …还有 ${missed.length - 40} 个`);

console.log('\n=== 三、按机制分类统计（我们能做 vs 缺）===');
const bucket = {};
for (const s of missed) {
  let k = '其他';
  const d = s.descPlain;
  if (/连击/.test(d)) k = '连击';
  else if (/回复/.test(d)) k = '回复';
  else if (/减伤/.test(d)) k = '减伤/防御';
  else if (/先手|后手/.test(d)) k = '先手/后手';
  else if (/能耗/.test(d)) k = '能耗';
  else if (/印记/.test(d)) k = '印记';
  else if (/天气/.test(d)) k = '天气';
  else if (/层/.test(d)) k = '层数';
  else if (/每/.test(d)) k = '每…触发';
  bucket[k] = (bucket[k] ?? 0) + 1;
}
for (const [k, v] of Object.entries(bucket).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
