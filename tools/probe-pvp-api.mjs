/** 探测 rocopvp 站点是否有性格/天分等结构化数据接口 */
const base = 'https://rocopvp.tzrain.wiki';
const paths = [
  '/api/natures', '/api/personalities', '/api/personality', '/api/config',
  '/api/creatures', '/api/skills', '/api/stat', '/api/nature',
  '/data/natures.json', '/data/personalities.json', '/natures.json',
  '/api/v1/natures', '/api/meta', '/api/calc/config',
];

for (const p of paths) {
  try {
    const r = await fetch(base + p, { headers: { 'user-agent': 'Mozilla/5.0' } });
    const ct = r.headers.get('content-type') ?? '';
    let body = '';
    if (r.ok) {
      const t = await r.text();
      body = `  ${t.length}B ${ct} :: ${t.slice(0, 160).replace(/\s+/g, ' ')}`;
    }
    console.log(`${String(r.status).padEnd(4)} ${p}${body}`);
  } catch (e) {
    console.log(`ERR  ${p}  ${e.message}`);
  }
}

// 抓主页，找打包后的 JS 里关于 nature 的线索
console.log('\n=== 主页里的 script 资源 ===');
const html = await (await fetch(base + '/battle-use-guide')).text();
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
console.log(scripts.join('\n') || '(内联脚本)');
const inline = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]{0,200})/g)].map((m) => m[1].replace(/\s+/g, ' '));
console.log('\n内联脚本片段:', inline.slice(0, 3).join(' || ').slice(0, 400));
