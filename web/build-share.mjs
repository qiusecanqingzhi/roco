#!/usr/bin/env node
/**
 * 打包一个"可直接分享/上传"的版本到 dist-share/，并生成 zip。
 *
 * 用法:
 *   node web/build-share.mjs              # 生成 dist-share/ 和 dist-share.zip
 *   node web/build-share.mjs --no-bundle  # 不带 data-bundle.js（更小，但不再支持 file:// 双击）
 *   node web/build-share.mjs --no-zip     # 只生成目录
 *   node web/build-share.mjs --out D:\x   # 换输出目录
 *
 * 与 web/ 的区别：
 *   - 只带页面需要的东西（app.js / style.css / index.html / data / assets / data-bundle.js）
 *   - 附带 _headers、robots.txt、README.txt（托管与说明用）
 *   - 不包含爬虫脚本、缓存、测试工具
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const opt = { out: 'dist-share', bundle: true, zip: true };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--no-bundle') opt.bundle = false;
  else if (args[i] === '--no-zip') opt.zip = false;
  else if (args[i] === '--out') opt.out = args[++i];
  else if (args[i] === '-h' || args[i] === '--help') { console.log('用法: node web/build-share.mjs [--no-bundle] [--no-zip] [--out <dir>]'); process.exit(0); }
  else throw new Error('未知参数: ' + args[i]);
}

const WEB = 'web';
const OUT = opt.out;
const t0 = Date.now();

if (!fs.existsSync(path.join(WEB, 'index.html'))) {
  console.error('✗ 找不到 web/index.html，请在项目根目录执行');
  process.exit(1);
}

/* ---------------------------------------------------------- 复制文件 */
console.log(`· 打包到 ${OUT}/`);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let files = 0, bytes = 0;
function copyDir(src, dest, filter = () => true) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (!filter(s, e)) continue;
    if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyDir(s, d, filter); }
    else {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
      files++; bytes += fs.statSync(d).size;
    }
  }
}

const rootFiles = ['index.html', 'app.js', 'style.css'];
const skip = new Set();
if (!opt.bundle) skip.add('data-bundle.js');
for (const f of rootFiles) {
  fs.copyFileSync(path.join(WEB, f), path.join(OUT, f));
  files++; bytes += fs.statSync(path.join(OUT, f)).size;
}
if (opt.bundle) {
  fs.copyFileSync(path.join(WEB, 'data-bundle.js'), path.join(OUT, 'data-bundle.js'));
  files++; bytes += fs.statSync(path.join(OUT, 'data-bundle.js')).size;
}
// data/ 里除了给打包脚本用的 assets.json，其余都要
copyDir(path.join(WEB, 'data'), path.join(OUT, 'data'), (s) => path.basename(s) !== 'assets.json');
// 图片
copyDir(path.join(WEB, 'assets'), path.join(OUT, 'assets'));

// 给 index.html 里的本地资源加版本号，避免浏览器/托管缓存继续用旧版 app.js。
// 这一步必须在复制完 data/（要读 meta.json 拿数据版本）之后做。
{
  const { cacheBust } = await import('./cache-bust.mjs');
  const r = cacheBust(OUT);
  console.log(r.changed
    ? `✓ 已给 ${r.added.length} 个资源加版本号 ?v=${r.ver}：${r.added.join(', ')}`
    : `· 资源版本号已是最新（?v=${r.ver}）`);
}

/* ---------------------------------------------------------- 附加文件 */
// 托管平台常用：防止被搜索引擎收录（数据与图片版权属于原站）
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');

fs.writeFileSync(path.join(OUT, '_headers'), [
  '/*',
  '  X-Robots-Tag: noindex, nofollow',
  '',
].join('\n'));

const meta = JSON.parse(fs.readFileSync(path.join(WEB, 'data', 'meta.json'), 'utf8'));
const deployMode = process.env.ROCO_DEPLOY === 'gh-pages'
  ? `自动更新
  本目录由 GitHub Actions 定时任务自动重建（工作流见仓库 .github/workflows/sync.yml）：
  检测到上游数据版本变化时，会重新抓取、重建页面并发布到这里。

`
  : '';
fs.writeFileSync(path.join(OUT, 'README.txt'), `洛克王国：世界 图鉴浏览器（离线版网页）
================================================================

${deployMode}怎么用
  1. 双击 index.html —— 本机直接打开，断网也能看
  2. 或者把整个文件夹放到任意静态托管上（GitHub Pages / Cloudflare Pages /
     Vercel / 对象存储），根目录指到这里即可，不需要任何后端

内容
  精灵图鉴 ${meta.counts.spirits} 条（含形态）
  技能库   ${meta.counts.skills} 个
  克制关系 ${meta.counts.matchups} 条
  推荐队伍 ${meta.counts.teams} 支
  术语词条 ${meta.counts.glossary} 条
  数据版本 ${meta.catalogVersion}（${meta.locale}），生成于 ${meta.generatedAt}

隐私与来源
  · 页面纯静态，没有统计脚本、没有第三方请求，除了你自己的服务器不会连别处
  · 数据与图片来自非官方图鉴站 roco.world，版权属于该站与腾讯；
    本站点为个人整理，与腾讯无关联，未获其认可、赞助或批准
  · 请勿用于商业用途；如不希望被索引，robots.txt / _headers 已默认禁止收录

文件说明
  index.html       页面
  app.js           全部前端逻辑（零依赖）
  style.css        样式
  data-bundle.js   数据单文件包（给 file:// 双击用；托管时可删，页面会自动改读 data/*.json）
  data/*.json      同样的数据按需分片
  assets/          本地图片
`);

/* ---------------------------------------------------------- 统计 */
console.log(`  文件 ${files} 个，共 ${(bytes / 1048576).toFixed(1)} MB`);

/* ---------------------------------------------------------- 打包 zip */
if (opt.zip) {
  const zipPath = OUT + '.zip';
  // Node 24 自带 zlib，手写一个最小 zip（store 模式，不压缩，够用且不引依赖）
  const { default: zlib } = await import('node:zlib');
  const entries = [];
  (function walk(dir, prefix = '') {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const name = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, name);
      else entries.push({ name, full });
    }
  })(OUT, path.basename(OUT));

  const chunks = [];
  const central = [];
  let offset = 0;
  const crcTable = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    return t;
  })();
  const crc32 = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };

  for (const e of entries) {
    const data = fs.readFileSync(e.full);
    const comp = zlib.deflateRawSync(data, { level: 6 });   // 图片已是压缩格式，压不动也无所谓
    const useStore = comp.length >= data.length;
    const body = useStore ? data : comp;
    const method = useStore ? 0 : 8;
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);        // UTF-8 文件名
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));
    offset += local.length + nameBuf.length + body.length;
  }

  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(zipPath, Buffer.concat([...chunks, cdBuf, end]));
  console.log(`  ${zipPath}  ${(fs.statSync(zipPath).size / 1048576).toFixed(1)} MB（解压后双击 index.html 即可）`);
}

console.log(`\n✓ 完成（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
console.log('  上传整个目录到静态托管，或把 zip 发给好友（解压后双击 index.html）');
console.log('  提示：设 ROCO_DEPLOY=gh-pages 会在 README.txt 里写明"本目录由 Actions 自动发布"');
