// 诊断：星座名标注点是否落在自己星座的边界多边形内（临时脚本）
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'data-sky.js'), 'utf8');
const D = new Function(src + ';return {CON_LINES,CON_INFO,CON_BOUNDS};')();

const R = Math.PI / 180;
function ray(raH, dec) { const a = raH * 15 * R; return [Math.cos(dec * R) * Math.cos(a), Math.cos(dec * R) * Math.sin(a), Math.sin(dec * R)]; }
function sep(a1, d1, a2, d2) { const A = raH => raH; return Math.acos(Math.max(-1, Math.min(1, Math.sin(d1 * R) * Math.sin(d2 * R) + Math.cos(d1 * R) * Math.cos(d2 * R) * Math.cos((a1 - a2) * 15 * R)))) / R; }
// 点在多边形内（在球面上用切平面近似：以测试点为原点做方位角投影）
function inPoly(pt, poly) {
  const v = ray(pt[0], pt[1]);
  const up = [0, 0, 1];
  let e1 = [up[0] - v[0] * (up[0] * v[0] + up[1] * v[1] + up[2] * v[2]), up[1] - v[1] * (up[0] * v[0] + up[1] * v[1] + up[2] * v[2]), up[2] - v[2] * (up[0] * v[0] + up[1] * v[1] + up[2] * v[2])];
  let n1 = Math.hypot(...e1); if (n1 < 1e-9) e1 = [1, 0, 0], n1 = 1; e1 = e1.map(x => x / n1);
  const e2 = [v[1] * e1[2] - v[2] * e1[1], v[2] * e1[0] - v[0] * e1[2], v[0] * e1[1] - v[1] * e1[0]];
  const proj = (p) => { const w = ray(p[0], p[1]); const d = Math.max(1e-9, w[0] * v[0] + w[1] * v[1] + w[2] * v[2]); return [(w[0] * e1[0] + w[1] * e1[1] + w[2] * e1[2]) / d, (w[0] * e2[0] + w[1] * e2[1] + w[2] * e2[2]) / d]; };
  const q = poly.map(proj); let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    if (((q[i][1] > 0) !== (q[j][1] > 0)) && (q[i][0] < (q[j][0] - q[i][0]) * (0 - q[i][1]) / (q[j][1] - q[i][1]) + q[i][0])) inside = !inside;
  }
  return inside;
}
// 边界多边形的顶点向量质心（按最大多边形）
function centroid(des) {
  const polys = D.CON_BOUNDS[des] || []; if (!polys.length) return null;
  let best = null, bestA = -1;
  for (const poly of polys) {
    let s = [0, 0, 0], a = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = ray(poly[i][0], poly[i][1]), q = ray(poly[(i + 1) % poly.length][0], poly[(i + 1) % poly.length][1]);
      const c = [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
      a += Math.hypot(...c); for (let k = 0; k < 3; k++) s[k] += (p[k] + q[k]) / 2 * Math.hypot(...c);
    }
    if (a > bestA) { bestA = a; best = s.map(x => x / a); }
  }
  const n = Math.hypot(...best); const v = best.map(x => x / n);
  let ra = Math.atan2(v[1], v[0]) / (15 * R); if (ra < 0) ra += 24;
  return [+ra.toFixed(4), +(Math.asin(v[2]) / R).toFixed(3)];
}
let out = 0, tot = 0, list = [];
for (const des of Object.keys(D.CON_LINES)) {
  const info = D.CON_INFO[des]; if (!info || !info.label) continue;
  const polys = D.CON_BOUNDS[des] || []; if (!polys.length) continue;
  tot++;
  const inside = polys.some(p => inPoly(info.label, p));
  const c = centroid(des);
  const insideC = c ? polys.some(p => inPoly(c, p)) : null;
  const d = c ? sep(info.label[0], info.label[1], c[0], c[1]) : null;
  if (!inside) { out++; list.push({ des, zh: info.zh, label: info.label, centroid: c, dist: d && +d.toFixed(1), insideC }); }
}
list.sort((a, b) => b.dist - a.dist);
console.log(`标注点不在自身边界多边形内的星座：${out}/${tot}`);
console.log('（对比：按边界质心重算后是否落在多边形内 inC，以及新旧标注点相距 dist°）');
for (const l of list.slice(0, 20)) console.log(`  ${(l.zh || l.des).padEnd(7)} ${l.des} 现标注 ${JSON.stringify(l.label)} → 质心 ${JSON.stringify(l.centroid)} 相距 ${l.dist}° 质心在多边形内=${l.insideC}`);
console.log('\n全部星座里，质心落在自身边界内的情况统计：');
let okC = 0, badC = [];
for (const des of Object.keys(D.CON_LINES)) {
  const c = centroid(des); if (!c) continue;
  const polys = D.CON_BOUNDS[des] || [];
  if (polys.some(p => inPoly(c, p))) okC++; else badC.push((D.CON_INFO[des] || {}).zh || des);
}
console.log('  质心在边界内:', okC, ' 不在:', badC.length, badC.join(','));
