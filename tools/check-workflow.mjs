#!/usr/bin/env node
/**
 * 校验 GitHub Actions 工作流（零依赖）。
 *
 * 它读的是「已解析的快照」tools/workflow-snapshot/workflow-snapshot.json ——
 * 因为仓库里不想为了一个校验脚本引入 npm 依赖。
 *
 * 改动 .github/workflows/*.yml 之后，重新生成快照再校验：
 *   cd tools/workflow-snapshot && npm install && node decode-workflow.mjs && cd ../..
 *   node tools/check-workflow.mjs
 *
 * 除结构外还会检查：触发条件、cron 格式（并换算北京时间）、job/step 引用是否成立、
 * Pages 权限是否齐全、action 版本，以及「定时触发时用 inputs.* 取不到值」这类常见坑。
 */
import fs from 'node:fs';

const SNAP = 'tools/workflow-snapshot/workflow-snapshot.json';
const YML_DIR = '.github/workflows';
const problems = [];
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); else { problems.push(m); console.log('  ✗ ' + m); } };

if (!fs.existsSync(SNAP)) {
  console.log(`· 没有快照 ${SNAP}`);
  console.log('  生成方式（需要一次 npm install yaml）：');
  console.log('    cd tools/workflow-snapshot && npm install && node decode-workflow.mjs');
  process.exit(0);
}

// 快照是否过期：与 yml 的修改时间比较
const ymlFiles = fs.existsSync(YML_DIR) ? fs.readdirSync(YML_DIR).filter((f) => /\.ya?ml$/.test(f)) : [];
const snapTime = fs.statSync(SNAP).mtimeMs;
const stale = ymlFiles.filter((f) => fs.statSync(`${YML_DIR}/${f}`).mtimeMs > snapTime + 1000);
if (stale.length) console.log(`· 注意：${stale.join(', ')} 比快照新，建议先重新生成快照\n`);

const snaps = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
for (const { file, doc } of snaps) {
  console.log(`\n· ${file}`);
  ok(!!doc && typeof doc === 'object', '解析结果是个映射');

  // 触发条件：YAML 1.1 会把裸 on 解析成 true，两种都接受
  const on = doc.on ?? doc.true;
  ok(!!on, '有触发条件');
  if (on && typeof on === 'object') {
    const evts = Object.keys(on);
    ok(evts.length > 0, `触发事件: ${evts.join(', ')}`);
    if (evts.includes('schedule')) {
      const crons = (on.schedule ?? []).map((s) => s.cron).filter(Boolean);
      ok(crons.length > 0, `定时表达式: ${crons.join(' | ')}`);
      for (const c of crons) {
        const parts = c.trim().split(/\s+/);
        ok(parts.length === 5, `cron "${c}" 是 5 段格式`);
        if (parts.length === 5) {
          const [min, hour] = parts;
          ok(/^[\d*/,\-]+$/.test(min) && /^[\d*/,\-]+$/.test(hour), `cron "${c}" 分/时字段合法`);
          if (/^\d+$/.test(hour)) {
            const bj = (Number(hour) + 8) % 24;
            console.log(`      提示：${c} → 北京时间约 ${String(bj).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
          }
        }
      }
    }
    if (evts.includes('workflow_dispatch')) {
      const inputs = on.workflow_dispatch?.inputs ?? {};
      console.log(`      手动参数: ${Object.keys(inputs).join(', ') || '（无）'}`);
    }
  }

  // 权限 / 并发
  const perm = doc.permissions;
  ok(!!perm, '声明了 permissions（最小权限原则）');
  if (perm && typeof perm === 'object') {
    const usesPages = JSON.stringify(doc).includes('deploy-pages');
    const pushes = JSON.stringify(doc).includes('git push');
    if (usesPages) ok(perm['pages'] === 'write' && perm['id-token'] === 'write', '发布 Pages 需要 pages:write 与 id-token:write');
    if (pushes) ok(perm['contents'] === 'write', 'git push 需要 contents:write');
  }
  ok(!!doc.concurrency, '设置了 concurrency（避免两次运行打架）');

  /* ---------------------------------------------- jobs */
  const jobs = doc.jobs ?? {};
  ok(Object.keys(jobs).length > 0, `jobs: ${Object.keys(jobs).join(', ')}`);

  const scheduleOnly = typeof on === 'object' && Object.keys(on).length === 1 && 'schedule' in on;

  for (const [jobName, job] of Object.entries(jobs)) {
    const steps = Array.isArray(job.steps) ? job.steps : [];
    ok(steps.length > 0, `job ${jobName}: ${steps.length} 个 step`);
    const ids = new Set();
    for (const s of steps) if (s?.id) { ok(!ids.has(s.id), `job ${jobName}: step id "${s.id}" 唯一`); ids.add(s.id); }

    const refs = JSON.stringify(steps.map((s) => ({ if: s?.if, env: s?.env, run: s?.run, with: s?.with })))
      + JSON.stringify(job.outputs ?? {});
    for (const m of refs.matchAll(/steps\.([A-Za-z0-9_-]+)\.outputs/g)) {
      ok(ids.has(m[1]), `job ${jobName}: 引用的 steps.${m[1]}.outputs 存在`);
    }
    for (const n of [].concat(job.needs ?? [])) ok(!!jobs[n], `job ${jobName}: needs ${n} 存在`);

    // 常见坑：定时触发时 inputs 是空的
    if (scheduleOnly && jobName === 'sync') {
      const usesInputs = JSON.stringify(steps).includes('inputs.');
      ok(usesInputs, `job ${jobName}: 有定时触发，确认没有依赖 inputs.*（定时触发时 inputs 为空）`);
    }
  }

  // 引用 needs.*.outputs 的 job 必须真的声明了这些 output
  for (const [jobName, job] of Object.entries(jobs)) {
    const body = JSON.stringify(job);
    for (const m of body.matchAll(/needs\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_-]+)/g)) {
      const [, dep, out] = m;
      ok(!!jobs[dep], `job ${jobName}: 依赖的 job ${dep} 存在`);
      ok(!!(jobs[dep]?.outputs && out in jobs[dep].outputs), `job ${jobName}: ${dep} 声明了 output "${out}"`);
    }
  }

  // action 版本
  const all = JSON.stringify(doc);
  for (const [name, want] of [['actions/checkout', 'v4'], ['actions/setup-node', 'v4'],
    ['actions/upload-pages-artifact', 'v3'], ['actions/deploy-pages', 'v4']]) {
    if (all.includes(name)) ok(all.includes(`${name}@${want}`), `${name} 使用 ${want}`);
  }
}

console.log('');
if (problems.length) { console.log(`✗ ${problems.length} 项问题`); process.exit(1); }
console.log('✓ 工作流校验通过');
