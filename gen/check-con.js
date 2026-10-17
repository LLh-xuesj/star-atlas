// 诊断：星座连线/名称 与 星表坐标 是否一致（临时脚本）
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'data-sky.js'), 'utf8');
const sandbox = {};
const fn = new Function(src + ';return {SKY_STARS,NAMED,CON_LINES,CON_INFO,CON_BOUNDS,MESSIER};');
const D = fn();

function angDist(ra1, d1, ra2, d2) {
  const r = Math.PI / 180, a1 = ra1 * 15 * r, a2 = ra2 * 15 * r, b1 = d1 * r, b2 = d2 * r;
  return Math.acos(Math.max(-1, Math.min(1, Math.sin(b1) * Math.sin(b2) + Math.cos(b1) * Math.cos(b2) * Math.cos(a1 - a2)))) / r;
}
// 每个星座：连线端点与「最近的命名星」的平均角距，以及连线端点与星表恒星的最近距离
let worst = [];
for (const des of Object.keys(D.CON_LINES)) {
  const pts = D.CON_LINES[des].flat();
  const named = D.NAMED.filter(n => n.c === des);
  const lab = D.CON_INFO[des] ? D.CON_INFO[des].label : null;
  let sumLineToStar = 0, n1 = 0, sumLab = 0, n2 = 0;
  for (const p of pts) {
    // 连线端点 到 该星座命名亮星 的最小角距
    let bd = 1e9;
    for (const n of named) bd = Math.min(bd, angDist(p[0], p[1], n.ra, n.dec));
    if (named.length) { sumLineToStar += bd; n1++; }
  }
  if (lab && named.length) for (const n of named) { sumLab += angDist(lab[0], lab[1], n.ra, n.dec); n2++; }
  worst.push({ des, zh: D.CON_INFO[des] && D.CON_INFO[des].zh, segs: D.CON_LINES[des].length, pts: pts.length, named: named.length,
    avgLineToNamed: n1 ? +(sumLineToStar / n1).toFixed(2) : null, labToNamed: n2 ? +(sumLab / n2).toFixed(1) : null, label: lab });
}
worst.sort((a, b) => (b.avgLineToNamed || 0) - (a.avgLineToNamed || 0));
console.log('连线端点↔该星座命名亮星 平均角距 最大的 12 个星座：');
for (const w of worst.slice(0, 12)) console.log(`  ${(w.zh || w.des).padEnd(6)} ${w.des} 线段${String(w.segs).padStart(3)} 端点${String(w.pts).padStart(3)} 命名星${String(w.named).padStart(2)} 平均偏差 ${w.avgLineToNamed}° 标签距星中心 ${w.labToNamed}°`);
console.log('\n无命名星的星座数:', worst.filter(w => !w.named).length);
// 具体看猎户座
const o = worst.find(w => w.des === 'Ori');
console.log('\n猎户座明细:', JSON.stringify(o));
console.log('猎户座连线端点:', D.CON_LINES['Ori'].map(s => s.map(p => p[0].toFixed(2) + 'h/' + p[1].toFixed(1)).join(' → ')).slice(0, 12).join('\n  '));
console.log('猎户座命名星:', D.NAMED.filter(n => n.c === 'Ori').map(n => `${n.zh} ${n.ra.toFixed(2)}h/${n.dec.toFixed(1)}`).join(' | '));
// 星表覆盖检查：连线端点是否都能在星表里找到很近的星（≤0.5°）
let miss = 0, tot = 0, far = [];
for (const des of Object.keys(D.CON_LINES)) {
  for (const p of D.CON_LINES[des].flat()) {
    tot++;
    let bd = 1e9;
    for (const s of D.SKY_STARS) { const d = angDist(p[0], p[1], s[0], s[1]); if (d < bd) bd = d; if (bd < 0.05) break; }
    if (bd > 0.2) { miss++; if (far.length < 8) far.push(`${(D.CON_INFO[des] || {}).zh || des} ${p[0].toFixed(2)}h/${p[1].toFixed(1)} 最近星 ${bd.toFixed(2)}°`); }
  }
}
console.log(`\n连线端点总数 ${tot}，最近星 >0.2° 的有 ${miss} 个（星表 mag≤6.5 覆盖不到）`);
far.forEach(s => console.log('  ' + s));
