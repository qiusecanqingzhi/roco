/**
 * 逐行对比两套实现的产出（Node: out/roco.sqlite，Python: out-py/roco.sqlite）。
 * 先比行数，再按主键逐行比字段，能直接指出"哪一行哪个字段不同"。
 * 用法: node tools/compare.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const A_PATH = 'out/roco.sqlite';
const B_PATH = 'out-py/roco.sqlite';
if (!fs.existsSync(B_PATH)) {
  console.log(`跳过：找不到 ${B_PATH}（先跑 python python/scrape.py --all -o out-py）`);
  process.exit(0);
}

// 表 -> 主键列（用于配对同一行）。注意 spirit_skill 同一只精灵可能有多个形态，
// 甚至同一个技能出现在两条不同记录里（不同解锁等级，如"牵线木偶"的取念 Lv1 与 Lv7），
// 所以键要带上 form_id / source_type / source_order，否则会错配。
const KEYS = {
  spirit: ['handbook_id', 'form_id'],
  skill: ['id'],
  spirit_skill: ['handbook_id', 'form_id', 'skill_id', 'source_type', 'source_order'],
  skill_learner: ['skill_id', 'handbook_id', 'form_id', 'source_group'],
  type: ['id'],
  type_matchup: ['attacking_type_id', 'defending_type_id'],
  team: ['id'],
  team_member: ['team_id', 'seat'],
  glossary: ['note_id'],
  stat_icons: ['stat'],
  passive_skill: ['handbook_id', 'form_id'],
  spirit_bloodline: ['handbook_id', 'form_id', 'bloodline_id'],
};

const A = new DatabaseSync(A_PATH);
const B = new DatabaseSync(B_PATH);
const plain = (v) => (typeof v === 'bigint' ? Number(v) : v);
const keyOf = (r, keys) => keys.map((k) => String(plain(r[k]))).join('|');

let bad = 0;
console.log('表'.padEnd(14), 'Node'.padStart(7), 'Python'.padStart(8), '  结果');
for (const [t, keys] of Object.entries(KEYS)) {
  const ra = A.prepare(`select * from ${t}`).all();
  const rb = B.prepare(`select * from ${t}`).all();
  let verdict = '一致';
  if (ra.length !== rb.length) {
    verdict = `✗ 行数不同 (Node ${ra.length} / Python ${rb.length})`;
    bad++;
  } else {
    const mb = new Map(rb.map((r) => [keyOf(r, keys), r]));
    const problems = [];
    for (const a of ra) {
      const b = mb.get(keyOf(a, keys));
      if (!b) { problems.push(`Python 缺少 ${keyOf(a, keys)}`); continue; }
      for (const k of Object.keys(a)) {
        if (k === 'locale') continue;
        if (String(plain(a[k])) !== String(plain(b[k])))
          problems.push(`${keyOf(a, keys)} 的 ${k}: Node=${JSON.stringify(plain(a[k]))} / Python=${JSON.stringify(plain(b[k]))}`);
      }
    }
    if (problems.length) {
      verdict = `✗ ${problems.length} 处字段不同`;
      bad++;
      problems.slice(0, 5).forEach((p) => console.log('      ' + p));
    }
  }
  console.log(t.padEnd(14), String(ra.length).padStart(7), String(rb.length).padStart(8), ' ', verdict);
}
A.close(); B.close();
console.log(bad ? `\n✗ ${bad} 张表不一致` : '\n✓ 两套实现产出的数据完全一致（逐行逐字段）');
process.exit(bad ? 1 : 0);
