/** 扫描所有视图里的重复 id（id 必须唯一，否则 getElementById 会拿错/拿不到） */
import fs from 'node:fs';
import vm from 'node:vm';
import { makeEnv } from '../web/tools/dom-stub.mjs';

const bundleSrc = fs.readFileSync('web/data-bundle.js', 'utf8');
const bundle = JSON.parse(bundleSrc.replace(/^window\.ROCO_DATA\s*=\s*/, '').replace(/;\s*$/, ''));
const env = makeEnv({ withBundle: true, bundle });
vm.createContext(env.sandbox);
vm.runInContext(bundleSrc, env.sandbox);
vm.runInContext(fs.readFileSync('web/app.js', 'utf8'), env.sandbox);
await new Promise((r) => setTimeout(r, 80));
const api = env.window.__roco;

let bad = 0;
for (const v of ['spirits', 'skills', 'types', 'calc', 'glossary']) {
  api.STATE.view = v;
  env.byId.get('app').innerHTML = '';
  api.render();
  const html = env.byId.get('app').innerHTML;
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  console.log(`  ${v.padEnd(9)} id 数 ${String(ids.length).padStart(3)}  重复: ${dup.join(', ') || '无'}`);
  if (dup.length) bad++;
}
console.log(bad ? '\n✗ 有视图存在重复 id' : '\n✓ 所有视图都没有重复 id');
