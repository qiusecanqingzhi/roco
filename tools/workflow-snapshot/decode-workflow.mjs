#!/usr/bin/env node
/**
 * 用真正的 YAML 解析器把 .github/workflows/*.yml 解析成快照 JSON，
 * 供零依赖的 tools/check-workflow.mjs 校验（这样校验脚本不必引入 npm 依赖）。
 *
 * 什么时候需要跑：改动 .github/workflows/*.yml 之后。
 *
 *   cd tools/workflow-snapshot
 *   npm install                    # 只需一次，装 yaml
 *   node decode-workflow.mjs
 *   cd ../..
 *   node tools/check-workflow.mjs
 *
 * 快照会写到 tools/workflow-snapshot/workflow-snapshot.json（建议提交）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const YAML = require('yaml');

// 仓库根目录 = 本文件往上两层
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, '.github', 'workflows');
const OUT = path.join(ROOT, 'tools', 'workflow-snapshot', 'workflow-snapshot.json');

if (!fs.existsSync(DIR)) {
  console.error(`✗ 找不到 ${DIR}`);
  process.exit(1);
}

const snaps = [];
for (const f of fs.readdirSync(DIR).filter((x) => /\.ya?ml$/.test(x))) {
  const text = fs.readFileSync(path.join(DIR, f), 'utf8');
  // uniqueKeys: 出现重复键直接抛错，这是 YAML 最常见的手误
  const doc = YAML.parse(text, { uniqueKeys: true });
  snaps.push({ file: path.relative(ROOT, path.join(DIR, f)).replace(/\\/g, '/'), doc });
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(snaps, null, 1));
console.log(`· 已解析 ${snaps.length} 个工作流 -> ${path.relative(ROOT, OUT)}`);
console.log('  接着跑：node tools/check-workflow.mjs');
