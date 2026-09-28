/** 线上验收：详情外链已移除、功能仍在 */
const js = await (await fetch('https://qiusecanqingzhi.github.io/roco/app.js')).text();

const links = [...js.matchAll(/<a[^>]+href="[^"]*roco\.world/g)];
console.log('指向 roco.world 的 <a> 链接:', links.length, links.length === 0 ? '✓ 已清空' : '✗ 仍有');
console.log('「在原站打开」文案        :', /在原站打开/.test(js) ? '✗ 仍有' : '✓ 已移除');
console.log('「复制名称」按钮          :', /data-copy/.test(js) ? '✓ 保留' : '✗ 丢了');
console.log('技能详情硬编码外链        :', /href="https:\/\/roco\.world/.test(js) ? '✗ 仍有' : '✓ 已移除');
console.log('传说技能区块              :', /传说技能/.test(js) ? '✓' : '✗');
console.log('威力可变标记              :', /powerCell/.test(js) ? '✓' : '✗');

// 页脚声明应当还在（HTML 里）
const html = await (await fetch('https://qiusecanqingzhi.github.io/roco/index.html')).text();
console.log('页脚来源声明              :', /数据来源/.test(html) ? '✓ 保留（必要的归属说明）' : '✗ 被误删');
