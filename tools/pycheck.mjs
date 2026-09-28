/**
 * 在没有 Python 的机器上对 scrape.py 做基础结构检查（不是真正的语法检查）：
 *   - 字符串/注释之外，括号是否配对
 *   - 逻辑行起始处的缩进是否为 4 的倍数（括号内的续行不检查）
 *   - 是否 Tab 混用 / 行尾空白
 *   - 关键定义与入口是否存在
 */
import fs from 'node:fs';

const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');
const lines = src.split('\n');
const problems = [];

// 逐字符扫描：记录每一行起始时的括号深度，忽略字符串与注释
const depthAtLineStart = new Array(lines.length).fill(0);
const close = { ')': '(', ']': '[', '}': '{' };
const stack = [];
let inStr = null;
let line = 0;
let inComment = false;
for (let i = 0; i < src.length; i++) {
  const c = src[i];
  if (c === '\n') { line++; inComment = false; if (line < lines.length) depthAtLineStart[line] = stack.length; continue; }
  if (inComment) continue;
  if (inStr) {
    if (c === '\\') { i++; continue; }
    if (src.startsWith(inStr, i)) { i += inStr.length - 1; inStr = null; }
    continue;
  }
  if (c === '#') { inComment = true; continue; }
  if (src.startsWith('"""', i) || src.startsWith("'''", i)) { inStr = src.slice(i, i + 3); i += 2; continue; }
  if (c === '"' || c === "'") { inStr = c; continue; }
  if ('([{'.includes(c)) stack.push([c, line + 1]);
  else if (')]}'.includes(c)) {
    const top = stack.pop();
    if (!top || top[0] !== close[c])
      problems.push(`第 ${line + 1} 行: 括号不匹配 '${c}'` + (top ? `（未闭合: 第 ${top[1]} 行 '${top[0]}'）` : ''));
  }
}
if (inStr) problems.push(`字符串未闭合: ${inStr}`);
if (stack.length) problems.push('未闭合括号: ' + stack.map(([c, l]) => `'${c}'@${l}`).join(', '));

lines.forEach((l, idx) => {
  if (/[ \t]+$/.test(l)) problems.push(`第 ${idx + 1} 行: 行尾空白`);
  if (/^\t/.test(l) || /^ *\t/.test(l)) problems.push(`第 ${idx + 1} 行: 使用 Tab 缩进`);
  const indent = (l.match(/^ +/) || [''])[0].length;
  const isLogicalStart = depthAtLineStart[idx] === 0;
  const isBlankOrComment = /^\s*$/.test(l) || /^\s*#/.test(l);
  if (isLogicalStart && !isBlankOrComment && indent % 4 !== 0)
    problems.push(`第 ${idx + 1} 行: 逻辑行缩进 ${indent} 空格不是 4 的倍数 | ${l.slice(0, 50)}`);
});

// 类体缩进检查：class X: 之后、下一个顶层语句之前，必须存在缩进更深的行
for (let idx = 0; idx < lines.length; idx++) {
  if (!/^class\s/.test(lines[idx])) continue;
  let hasBody = false;
  for (let j = idx + 1; j < lines.length; j++) {
    if (/^\s*$/.test(lines[j]) || /^\s*#/.test(lines[j])) continue;
    if (/^\S/.test(lines[j])) break; // 回到顶层 -> 类体结束
    hasBody = true;
  }
  if (!hasBody) problems.push(`第 ${idx + 1} 行: class 体没有缩进内容: ${lines[idx].trim().slice(0, 50)}`);
}

for (const need of ['def main(', 'def build_sqlite(', 'def spirit_row(', 'def skill_row(', 'def skill_learner_rows(',
  'def team_rows(', 'def write_table(', 'if __name__ == "__main__":', 'argparse.ArgumentParser',
  'urllib.request', 'ThreadPoolExecutor', 'CREATE TABLE IF NOT EXISTS skill_learner'])
  if (!src.includes(need)) problems.push(`缺少: ${need}`);

console.log(`检查 ${file}: ${lines.length} 行`);
if (!problems.length) console.log('✓ 未发现结构性问题');
else { console.log(`✗ ${problems.length} 个问题:`); problems.slice(0, 30).forEach((p) => console.log('  - ' + p)); }
process.exit(problems.length ? 1 : 0);
