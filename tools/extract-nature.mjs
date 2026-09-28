/** 从 battle 页 chunk 里提取性格/个体相关数据 */
const chunkUrl = 'https://rocopvp.tzrain.wiki/_next/static/chunks/app/battle-use-guide/page-214a2525499fbff8.js';
const t = await (await fetch(chunkUrl)).text();
console.log('chunk 大小:', (t.length / 1024).toFixed(0), 'KB');

// 找"性格"附近的片段
console.log('\n=== "性格" 上下文 ===');
let idx = 0, n = 0;
while ((idx = t.indexOf('性格', idx)) !== -1 && n < 8) {
  console.log(`--- @${idx} ---`);
  console.log(t.slice(Math.max(0, idx - 220), idx + 220).replace(/\s+/g, ' '));
  console.log('');
  idx += 2; n++;
}

console.log('\n=== "个体" 上下文（前 4 处）===');
idx = 0; n = 0;
while ((idx = t.indexOf('个体', idx)) !== -1 && n < 4) {
  console.log(`--- @${idx} ---`);
  console.log(t.slice(Math.max(0, idx - 200), idx + 200).replace(/\s+/g, ' '));
  console.log('');
  idx += 2; n++;
}

// 找可能的性格名数组
console.log('\n=== 搜常见性格名 ===');
for (const nm of ['勇敢', '固执', '胆小', '开朗', '保守', '温和', '大胆', '沉着']) {
  const i = t.indexOf(nm);
  console.log(`  ${nm}: ${i === -1 ? '未出现' : '@' + i + '  ' + t.slice(i - 60, i + 60).replace(/\s+/g, ' ')}`);
}
