#!/usr/bin/env node
/**
 * 下载网页需要的图片到 web/assets/（离线也能看图）。
 *
 * 用法：
 *   node web/fetch-assets.mjs                # 下载清单里所有图片
 *   node web/fetch-assets.mjs --concurrency 8
 *   node web/fetch-assets.mjs --force        # 重新下载已存在的
 *   node web/fetch-assets.mjs --only spirit  # 只下精灵图（spirit|skill|type）
 *
 * 清单来自 web/data/assets.json（由 export-data.mjs 生成）。
 * 已存在的文件默认跳过，所以中断后重跑即可续传。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const ORIGIN = 'https://roco.world';

const args = process.argv.slice(2);
const opt = { concurrency: 6, rate: 60, force: false, only: null, assetsDir: 'web/assets', list: 'web/data/assets.json' };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--concurrency' || args[i] === '-c') opt.concurrency = Number(args[++i]);
  else if (args[i] === '--rate') opt.rate = Number(args[++i]);
  else if (args[i] === '--force') opt.force = true;
  else if (args[i] === '--only') opt.only = args[++i];
  else if (args[i] === '--assets-dir') opt.assetsDir = args[++i];
  else if (args[i] === '--list') opt.list = args[++i];
  else if (args[i] === '-h' || args[i] === '--help') { console.log('用法: node web/fetch-assets.mjs [--concurrency 6] [--rate 60] [--force] [--only spirit|skill|type]'); process.exit(0); }
  else throw new Error('未知参数: ' + args[i]);
}

if (!fs.existsSync(opt.list)) {
  console.error(`✗ 找不到 ${opt.list}\n  先跑 node web/export-data.mjs 生成清单`);
  process.exit(1);
}
let urls = JSON.parse(fs.readFileSync(opt.list, 'utf8'));
if (opt.only) urls = urls.filter((u) => u.includes(opt.only));

const localName = (url) => 'assets/' + url.replace(ORIGIN, '').replace(/^\/assets\//, '').replace(/[/\\]/g, '_');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let done = 0, skipped = 0, failed = 0, bytes = 0, last = 0;
const failures = [];

async function downloadOne(url) {
  const dest = path.join(opt.assetsDir, path.basename(localName(url)));
  if (!opt.force && fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    skipped++;
    return;
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const wait = opt.rate - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, buf);
      bytes += buf.length;
      done++;
      return;
    } catch (e) {
      if (attempt === 3) {
        failed++;
        failures.push(`${url} (${e.message})`);
      } else await sleep(400 * attempt);
    }
  }
}

// 简单的并发池
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      await fn(items[idx]);
      if ((done + skipped + failed) % 100 === 0) {
        process.stderr.write(`\r  进度 ${done} 下载 / ${skipped} 已有 / ${failed} 失败   `);
      }
    }
  }));
}

const t0 = Date.now();
console.log(`· 共 ${urls.length} 个图片 -> ${opt.assetsDir}/`);
await pool(urls, opt.concurrency, downloadOne);
process.stderr.write('\r');

// 统计目录体积
let totalFiles = 0, totalBytes = 0;
if (fs.existsSync(opt.assetsDir)) {
  for (const f of fs.readdirSync(opt.assetsDir)) {
    const st = fs.statSync(path.join(opt.assetsDir, f));
    if (st.isFile()) { totalFiles++; totalBytes += st.size; }
  }
}

console.log(`✓ 完成（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
console.log(`  本次新下载 ${done} 个（${(bytes / 1048576).toFixed(1)} MB），已存在 ${skipped} 个，失败 ${failed} 个`);
console.log(`  ${opt.assetsDir}/ 现有 ${totalFiles} 个文件，共 ${(totalBytes / 1048576).toFixed(1)} MB`);
if (failures.length) {
  console.log(`  失败列表（前 10 条）:`);
  failures.slice(0, 10).forEach((f) => console.log('    ' + f));
  process.exitCode = 1;
}
