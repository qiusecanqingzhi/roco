/** 检查 __roco 导出列表里的名字是否都还在（删代码后最容易漏的就是这个） */
import fs from 'node:fs';

const src = fs.readFileSync('web/app.js', 'utf8');
const i = src.indexOf('window.__roco = {');
const j = src.indexOf('};', i);
const block = src.slice(i, j);
const names = [...block.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*(?=[,}])/g)].map((m) => m[1]);

const missing = [];
for (const n of [...new Set(names)]) {
  // function 声明 / const / class 都算定义
  const def = new RegExp(`(?:function\\s+${n}\\b|(?:const|let|var)\\s+${n}\\s*=|class\\s+${n}\\b)`, 'm');
  if (!def.test(src)) missing.push(n);
}
console.log(`导出 ${new Set(names).size} 个名字，缺失 ${missing.length} 个：`);
for (const n of missing) console.log(`  ✗ ${n}`);
if (!missing.length) console.log('  （都在）');
