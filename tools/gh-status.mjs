/**
 * 通过 GitHub 公开 API 查看工作流运行结果与失败原因（只读，不需要 token）。
 * 仅对公开仓库有效；私有仓库会返回 404。
 *
 * 用法: node tools/gh-status.mjs [owner/repo]
 */
const repo = process.argv[2] ?? 'qiusecanqingzhi/roco';
const API = 'https://api.github.com';
const H = { 'user-agent': 'roco-dex-status', accept: 'application/vnd.github+json' };

async function api(path) {
  try {
    const r = await fetch(API + path, { headers: H, signal: AbortSignal.timeout(20000) });
    if (r.status === 404) return { error: '404（仓库私有或不存在）' };
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return { data: await r.json() };
  } catch (e) {
    return { error: e.message };
  }
}

const runs = await api(`/repos/${repo}/actions/runs?per_page=3`);
if (runs.error) {
  console.log(`✗ 取不到运行记录：${runs.error}`);
  process.exit(1);
}
if (!runs.data.workflow_runs.length) {
  console.log('· 还没有任何运行记录');
  process.exit(0);
}

for (const run of runs.data.workflow_runs) {
  console.log(`\n═══ 运行 #${run.run_number}  ${run.status} / ${run.conclusion ?? '进行中'}  (${run.event})`);
  console.log(`    提交 ${run.head_sha.slice(0, 7)}  用时 ${run.run_started_at}`);

  const jobs = await api(`/repos/${repo}/actions/runs/${run.id}/jobs`);
  if (jobs.error) { console.log(`    ✗ 取不到 job：${jobs.error}`); continue; }
  for (const job of jobs.data.jobs) {
    const mark = job.conclusion === 'success' ? '✓' : job.conclusion === 'skipped' ? '－' : '✗';
    console.log(`    ${mark} ${job.name.padEnd(8)} ${job.conclusion ?? job.status}`);
    for (const s of job.steps ?? []) {
      if (s.conclusion === 'success') continue;              // 只看没成功的
      console.log(`        ${s.conclusion === 'skipped' ? '－' : '✗'} ${s.number}. ${s.name}  [${s.conclusion ?? s.status}]`);
    }
    if (job.conclusion === 'failure') {
      console.log(`        → 失败步骤日志：${run.html_url}/job/${job.id}`);
    }
  }
  console.log(`    运行详情：${run.html_url}`);
}
