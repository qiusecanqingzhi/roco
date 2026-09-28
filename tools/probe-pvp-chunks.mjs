/** 在 rocopvp 的打包 JS 里找性格/天分数据 */
const base = 'https://rocopvp.tzrain.wiki';
const html = await (await fetch(base + '/battle-use-guide')).text();
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);

console.log('=== 逐个 chunk 搜关键词 ===');
for (const s of scripts) {
  try {
    const t = await (await fetch(base + s)).text();
    const hits = [];
    for (const kw of ['性格', '天分', '资质', '个体', 'nature', 'Nature', 'personality']) {
      const n = (t.match(new RegExp(kw, 'g')) || []).length;
      if (n) hits.push(`${kw}×${n}`);
    }
    console.log(`  ${s.split('/').pop()}  ${(t.length / 1024).toFixed(0)}KB  ${hits.length ? hits.join(' ') : '—'}`);
  } catch (e) {
    console.log(`  ${s} ERR ${e.message}`);
  }
}

// 也试试 Next.js 的 RSC / data 端点
console.log('\n=== 试 Next.js RSC 数据端点 ===');
for (const p of ['/battle?_rsc=1', '/battle', '/creature-dex', '/api/trpc/natures', '/_next/data']) {
  try {
    const r = await fetch(base + p, { headers: { 'user-agent': 'Mozilla/5.0', RSC: '1' } });
    const t = r.ok ? await r.text() : '';
    console.log(`  ${r.status} ${p} ${t ? t.length + 'B :: ' + t.slice(0, 100).replace(/\s+/g, ' ') : ''}`);
  } catch (e) { console.log(`  ERR ${p} ${e.message}`); }
}
