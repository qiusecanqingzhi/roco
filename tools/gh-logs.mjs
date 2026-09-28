/**
 * 取某次 Actions 运行的日志（公开仓库不需要 token）。
 * 用法: node tools/gh-logs.mjs <run_id> [过滤关键字]
 */
const repo = 'qiusecanqingzhi/roco';
const runId = process.argv[2];
const filter = process.argv[3];
if (!runId) { console.log('用法: node tools/gh-logs.mjs <run_id> [关键字]'); process.exit(1); }

const H = { 'user-agent': 'roco-dex-status', accept: 'application/vnd.github+json' };
const r = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${runId}/logs`, {
  headers: H, redirect: 'follow', signal: AbortSignal.timeout(30000),
});
console.log('HTTP', r.status, r.headers.get('content-type'));

if (!r.ok) {
  console.log('（需要 token 才能下载日志 —— 那就请看网页里的失败步骤）');
  process.exit(0);
}

// 返回的是 zip：不引入依赖，直接把可打印文本里的关键行抓出来
const buf = Buffer.from(await r.arrayBuffer());
console.log('下载到', (buf.length / 1024).toFixed(0), 'KB zip');
const text = buf.toString('latin1');
const lines = text.split(/\r?\n/).filter((l) => /error|Error|fail|Fail|not found|Not Found|denied|pages/i.test(l));
const uniq = [...new Set(lines)].slice(0, 40);
console.log('\n=== 命中关键字的行（最多 40）===')
for (const l of uniq) console.log('  ' + l.replace(/[^\x20-\x7E\u4e00-\u9fa5]/g, '').slice(0, 200));

if (filter) {
  console.log(`\n=== 含「${filter}」的行 ===`);
  for (const l of [...new Set(text.split(/\r?\n/).filter((x) => x.includes(filter)))].slice(0, 20))
    console.log('  ' + l.replace(/[^\x20-\x7E\u4e00-\u9fa5]/g, '').slice(0, 200));
}
