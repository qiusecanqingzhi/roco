/** 线上验收：队伍页已移除、四个页签在、血脉分片可加载 */
const base = 'https://qiusecanqingzhi.github.io/roco';
const [html, js, bl] = await Promise.all([
  fetch(base + '/index.html').then((r) => r.text()),
  fetch(base + '/app.js').then((r) => r.text()),
  fetch(base + '/data/spirit-bloodlines.json').then((r) => r.json()),
]);

const tabs = [...html.matchAll(/data-tab="(\w+)">([^<]+)</g)].map((m) => m[2]);
console.log('线上导航栏  :', tabs.join(' / '));
console.log('四个页签    :', tabs.length === 4 ? '✓' : `✗（${tabs.length} 个）`);
console.log('「推荐队伍」:', /推荐队伍/.test(html + js) ? '✗ 仍存在' : '✓ 已移除');
console.log('viewTeams   :', /function viewTeams/.test(js) ? '✗ 仍在代码里' : '✓ 已删除');
console.log('skills.blood:', /skills\.blood/.test(js) ? '✗ 死代码仍在' : '✓ 已清除');
console.log('血脉分片    :', Object.keys(bl).length, '个键', Object.keys(bl).length === 621 ? '✓' : '✗');
console.log('血脉区块    :', /血脉技能/.test(js) ? '✓ 代码在' : '✗');
