/**
 * 给 HTML 里的本地资源加上版本号查询串，避免浏览器/托管缓存继续用旧文件。
 *
 * 背景：index.html 里是裸的 <script src="app.js"> / <link href="style.css">，
 * 部署到 GitHub Pages 后浏览器和 Pages 边缘缓存会继续用旧文件，表现就是
 * "改了但用户看不到新功能"，刷新也不一定好。加上 ?v=... 后每次内容变化都会换 URL。
 *
 * 版本号 = 数据版本（catalog_version）+ 代码文件内容哈希。
 * 为什么不用时间戳：同一份内容重复构建必须得到同一个版本号，否则 CI 每次都会
 * 提交一个"只有版本号变了"的空改动（这个坑之前踩过，见 export-data.mjs 的说明）。
 * 为什么不能只用数据版本：只改代码不改数据时版本号不变，缓存仍会命中旧 app.js ——
 * 这正是当初"改了功能但用户用不了"的原因。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * 给某个目录下的 index.html 加资源版本号。返回 { changed, ver, added }。
 * 抽成函数是为了能被 build-share.mjs 直接调用、也能被测试直接引入
 * （沙箱里不允许 spawn 子进程捕获输出，所以不做成"只能命令行跑"）。
 */
export function cacheBust(dir) {
  const htmlPath = path.join(dir, 'index.html');
  if (!fs.existsSync(htmlPath)) throw new Error(`找不到 ${htmlPath}`);

  // 数据版本
  let dataVer = '';
  const metaPath = path.join(dir, 'data', 'meta.json');
  if (fs.existsSync(metaPath)) {
    try { dataVer = JSON.parse(fs.readFileSync(metaPath, 'utf8')).catalogVersion ?? ''; } catch { /* 忽略 */ }
  }

  // 代码内容哈希：页面代码 + 样式 + 单文件数据包（有就带上）
  const parts = [];
  for (const f of ['app.js', 'style.css', 'data-bundle.js']) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) parts.push(fs.readFileSync(p));
  }
  const hash = crypto.createHash('sha256').update(dataVer).update(Buffer.concat(parts)).digest('hex').slice(0, 10);
  const ver = dataVer ? `${dataVer}-${hash}` : hash;

  const before = fs.readFileSync(htmlPath, 'utf8');
  // 先去掉上一次可能留下的版本号，保证重复执行结果稳定（幂等）
  let html = before.replace(/((?:src|href)="[^"?]+\.(?:js|css))\?v=[^"]*(")/g, '$1$2');
  // 只处理相对路径的本地资源，跳过 http(s)://、//、data:、# 等
  html = html.replace(
    /(\s(?:src|href)=")(?!https?:|\/\/|data:|#)([^"?]+\.(?:js|css))(")/g,
    (_, pre, file, post) => `${pre}${file}?v=${ver}${post}`,
  );

  const added = [...html.matchAll(/(?:src|href)="([^"]+\?v=[^"]+)"/g)].map((m) => m[1]);
  if (html !== before) fs.writeFileSync(htmlPath, html, 'utf8');
  return { changed: html !== before, ver, added };
}

// 直接命令行执行时才跑（被 import 时不执行）
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const dir = process.argv[2] ?? 'dist-share';
  const r = cacheBust(dir);
  console.log(r.changed
    ? `✓ 已给 ${r.added.length} 个资源加版本号 ?v=${r.ver}：${r.added.join(', ')}`
    : `· index.html 已是最新（版本号 ?v=${r.ver}）`);
}
