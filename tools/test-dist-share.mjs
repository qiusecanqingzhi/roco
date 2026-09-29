/** 直接检查 dist-share/index.html（用户双击的那个文件）能否正常启动 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { makeEnv } from '../web/tools/dom-stub.mjs';

const DIR = 'dist-share';
const bundleSrc = fs.readFileSync(path.join(DIR, 'data-bundle.js'), 'utf8');
const bundle = JSON.parse(bundleSrc.replace(/^window\.ROCO_DATA\s*=\s*/, '').replace(/;\s*$/, ''));
const appSrc = fs.readFileSync(path.join(DIR, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');

console.log('index.html 里的资源引用:');
for (const m of indexHtml.matchAll(/(?:src|href)="([^"]+)"/g)) console.log('  ', m[1]);

const env = makeEnv({ withBundle: true, bundle });
vm.createContext(env.sandbox);
vm.runInContext(bundleSrc, env.sandbox);
vm.runInContext(appSrc, env.sandbox);
await new Promise((r) => setTimeout(r, 120));

const api = env.window.__roco;
console.log('\n启动钩子:', api ? '✓' : '✗');
console.log('首页渲染长度:', env.byId.get('app').innerHTML.length);
console.log('console.error:', env.errors.length ? env.errors.join('\n') : '(无)');

console.log('\n=== 打开翼王详情 ===');
try {
  api.spiritDetail('152:1');
  const modal = env.byId.get('modalBody');
  console.log('弹窗内容长度:', modal.innerHTML.length);
  const box = modal.querySelector('.natal-block');
  console.log('.natal-block 存在:', !!box);
  if (box) {
    console.log('  性格按钮数:', box.querySelectorAll('[data-nat-btn]').length);
    console.log('  个体按钮数:', box.querySelectorAll('[data-nat-ivbtn]').length);
    console.log('  雷达图存在:', box.innerHTML.includes('<svg'));
    const btn = box.querySelector('[data-nat-btn="spd"][data-nat-kind="up"]');
    console.log('  速度"性格+"按钮存在:', !!btn);
    const wc = api.spiritCalcOf(api.STATE.bySpirit.get('152:1'));
    const before = api.calcStatsOf(api.STATE.bySpirit.get('152:1'), wc).spd;
    btn?.click();
    const after = api.calcStatsOf(api.STATE.bySpirit.get('152:1'), wc).spd;
    console.log(`  点击后速度: ${before} -> ${after}`, after > before ? '✓ 有反应' : '✗ 没反应');
    // 重画后还能不能继续操作
    const box2 = env.byId.get('modalBody').querySelector('.natal-block');
    console.log('  重画后 .natal-block 还在:', !!box2);
    const btn2 = box2?.querySelector('[data-nat-btn="spd"][data-nat-kind="down"]');
    btn2?.click();
    console.log('  再点"性格−"后:', wc.stats.spd.nature);
  }
} catch (e) {
  console.log('✗ 打开详情报错:', e.message);
  console.log(e.stack?.split('\n').slice(0, 4).join('\n'));
}
