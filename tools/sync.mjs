#!/usr/bin/env node
/**
 * 一键同步上游 → 重建网页 → 打包。
 * 本地手动跑、GitHub Actions 定时跑，都用这一个入口。
 *
 * 用法:
 *   node tools/sync.mjs                # 上游版本变了就抓；没变则用缓存快速重建
 *   node tools/sync.mjs --check        # 只检查上游版本，不抓也不写（退出码 0=无变化 10=有变化）
 *   node tools/sync.mjs --force        # 忽略版本比对，强制重抓
 *   node tools/sync.mjs --no-share     # 不生成 dist-share/
 *   node tools/sync.mjs --offline      # 完全不联网（从缓存重建，验证用）
 *
 * 退出码：0 正常；10 检测到上游更新（供 CI 判断）；其它为失败。
 * CI 用法：结果会写进 $GITHUB_OUTPUT（changed=true/false），并输出一份摘要。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const opt = {
  check: false, force: false, share: true, offline: false,
  locale: 'zh-Hans', db: 'out/roco.sqlite', quiet: false,
};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--check') opt.check = true;
  else if (a === '--force') opt.force = true;
  else if (a === '--no-share') opt.share = false;
  else if (a === '--offline') opt.offline = true;
  else if (a === '--locale' || a === '--lang') opt.locale = args[++i];
  else if (a === '--db') opt.db = args[++i];
  else if (a === '--quiet') opt.quiet = true;
  else if (a === '-h' || a === '--help') {
    console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('*/')[0].replace(/^#!.*\n\/\*\*?/, ''));
    process.exit(0);
  } else throw new Error('未知参数: ' + a);
}

const log = (...m) => { if (!opt.quiet) console.log(...m); };
const t0 = Date.now();

/* ------------------------------------------------ 1) 读上游版本 */
const MANIFEST = 'https://roco.world/static/manifest.json';
let upstream = null, upstreamErr = null;
if (!opt.offline) {
  try {
    const res = await fetch(MANIFEST, { headers: { 'user-agent': 'roco-sync/1.0 (+https://github.com/)' }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    upstream = await res.json();
  } catch (e) {
    upstreamErr = e.message;
  }
}

/* ------------------------------------------------ 2) 读本地版本 */
let local = null;
try {
  local = JSON.parse(fs.readFileSync('web/data/meta.json', 'utf8'));
} catch { /* 首次运行，还没有数据 */ }

const upVer = upstream?.catalog_version ?? null;
const localVer = local?.catalogVersion ?? null;
const changed = opt.force || (upVer && upVer !== localVer);
const counts = upstream?.counts?.[opt.locale] ?? null;

log(`· 上游版本: ${upVer ?? '（未取到：' + upstreamErr + '）'}`);
log(`  本地版本: ${localVer ?? '（无，属首次）'}`);
if (counts) log(`  上游规模: 精灵 ${counts.spirits} / 技能 ${counts.skills} / 术语 ${counts.description_notes} / 队伍 ${counts.teams}`);

if (opt.check) {
  log(changed ? '→ 检测到更新，需要同步' : '→ 无更新');
  writeOutputs({ changed, upstreamVersion: upVer, localVersion: localVer });
  process.exit(changed ? 10 : 0);
}

/* ------------------------------------------------ 3) 抓取 */
if (changed && !opt.offline) {
  log('\n· 上游有更新，开始抓取（约 2~3 分钟）');
  run('node', ['node/scrape.mjs', '--all', '--locale', opt.locale, '--assets']);
} else {
  log('\n· 无更新（或用 --offline），直接从缓存/数据库重建');
  if (!fs.existsSync(opt.db)) {
    log('  本地还没有数据库，改为全量抓取');
    run('node', ['node/scrape.mjs', '--all', '--locale', opt.locale, '--assets']);
  }
}

/* ------------------------------------------------ 4) 导出网页数据 */
log('\n· 导出网页数据');
run('node', ['web/export-data.mjs', '--db', opt.db, '--locale', opt.locale]);

/* ------------------------------------------------ 5) 补齐新图片 */
log('\n· 检查图片');
run('node', ['web/fetch-assets.mjs']);

/* ------------------------------------------------ 6) 打包 */
if (opt.share) {
  log('\n· 打包分享版');
  run('node', ['web/build-share.mjs']);
}

/* ------------------------------------------------ 7) 摘要 */
const newLocal = JSON.parse(fs.readFileSync('web/data/meta.json', 'utf8'));
const summary = {
  changed: changed || newLocal.catalogVersion !== localVer,
  upstreamVersion: upVer,
  localVersion: newLocal.catalogVersion,
  counts: newLocal.counts,
  durationSec: Number(((Date.now() - t0) / 1000).toFixed(1)),
};
log(`\n✓ 同步完成（${summary.durationSec}s）`);
log('  ' + JSON.stringify(summary.counts));
writeOutputs(summary);

/* ------------------------------------------------ 工具 */
function run(cmd, argv) {
  const r = spawnSync(cmd, argv, { stdio: opt.quiet ? 'pipe' : 'inherit', env: process.env, shell: false });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} 失败（退出码 ${r.status}）`);
}

function writeOutputs(obj) {
  const line = (k, v) => `${k}=${v}\n`;
  let out = '';
  out += line('changed', obj.changed);
  out += line('upstream_version', obj.upstreamVersion ?? '');
  out += line('local_version', obj.localVersion ?? '');
  if (obj.counts) {
    out += line('spirits', obj.counts.spirits);
    out += line('skills', obj.counts.skills);
    out += line('glossary', obj.counts.glossary);
    out += line('teams', obj.counts.teams);
  }
  if (obj.durationSec) out += line('duration_sec', obj.durationSec);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, out);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      '## 洛克王国图鉴 同步结果', '',
      `- 上游版本：\`${obj.upstreamVersion ?? '未知'}\``,
      `- 本地版本：\`${obj.localVersion ?? '未知'}\``,
      `- 是否有更新：**${obj.changed ? '是' : '否'}**`,
      obj.counts ? `- 数据规模：精灵 ${obj.counts.spirits} / 技能 ${obj.counts.skills} / 术语 ${obj.counts.glossary} / 队伍 ${obj.counts.teams}` : '',
      obj.durationSec ? `- 耗时：${obj.durationSec}s` : '',
      '',
    ].join('\n'));
  }
}
