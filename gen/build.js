// 构建脚本：把 _raw 星表 + 手工中文知识库 合成 js/data-sky.js
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..', '_raw');
const { CURATED_STARS, CURATED_M, CURATED_NGC, ASTERISMS, CITIES } = require('./curated.js');

const stars6 = JSON.parse(fs.readFileSync(path.join(R, 'stars.6.json'), 'utf8'));
const lines = JSON.parse(fs.readFileSync(path.join(R, 'constellations.lines.json'), 'utf8'));
const cinfo = JSON.parse(fs.readFileSync(path.join(R, 'constellations.json'), 'utf8'));
const cbounds = JSON.parse(fs.readFileSync(path.join(R, 'constellations.bounds.json'), 'utf8'));
const dsos = JSON.parse(fs.readFileSync(path.join(R, 'dsos.14.json'), 'utf8'));

const d2r = Math.PI / 180;
// 数据集经度范围 [-180,180]，归一化 RA 到 [0,24) 小时
function toRaH(lon) { let h = lon / 15; if (h < 0) h += 24; return +h.toFixed(5); }
// 繁体→简体（星座名用到的字）
const T2S = { '獵':'猎','戶':'户','雙':'双','蠍':'蝎','獅':'狮','魚':'鱼','馬':'马','烏':'乌','鴉':'鸦','儀':'仪','龍':'龙','飛':'飞','鳳':'凤','鶴':'鹤','鏡':'镜','鐘':'钟','網':'网','劍':'剑','羅':'罗','盤':'盘','顯':'显','遠':'远','圓':'圆','極':'极','蠅':'蝇','貓':'猫','鯨':'鲸','爐':'炉','壇':'坛','繪':'绘','鷹':'鹰','鵝':'鹅','寶':'宝','時':'时','鴿':'鸽','髮':'发','長':'长' };
function s2t(s) { return (s || '').replace(/[獵戶雙蠍獅魚馬烏鴉儀龍飛鳳鶴鏡鐘網劍羅盤顯遠圓極蠅貓鯨爐壇繪鷹鵝寶時鴿髮長]/g, c => T2S[c] || c); }
// 球面角距（度）
function angDist(l1, b1, l2, b2) {
  const ra1 = l1 * d2r, ra2 = l2 * d2r, d1 = b1 * d2r, d2 = b2 * d2r;
  const c = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(ra1 - ra2);
  return Math.acos(Math.max(-1, Math.min(1, c))) / d2r;
}

// ---------- 1. 全天恒星表 ----------
const SKY_STARS = stars6.features.map(f => {
  const [lon, lat] = f.geometry.coordinates;
  const p = f.properties;
  const bv = (p.bv === '' || p.bv == null) ? null : +p.bv;
  return [toRaH(lon), +lat.toFixed(4), +p.mag, bv];
});

// ---------- 2. 命名亮星：吸附精确坐标 ----------
const claims = {}; // catalogIndex -> curatedKey
const NAMED = [];
const problems = [];
for (const s of CURATED_STARS) {
  if (s.hand) { // 变星等不在 mag≤6 星表中的天体，直接用手工坐标
    NAMED.push({ k: s.k, zh: s.zh, en: s.en, b: s.b, c: s.c, ra: +s.ra.toFixed(5), dec: +s.dec.toFixed(4), mag: s.hand.mag, bv: s.hand.bv, d: s.d || null, note: s.note || null, vari: true });
    continue;
  }
  let best = -1, bestD = 1e9;
  for (let i = 0; i < SKY_STARS.length; i++) {
    const [raH, dec] = SKY_STARS[i];
    const d = angDist(s.ra * 15, s.dec, raH * 15, dec);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (bestD > 1.2) { problems.push(`FAIL ${s.k} (${s.zh || s.b}) 最近星距 ${bestD.toFixed(2)}°`); continue; }
  if (claims[best]) problems.push(`DUP ${s.k} 与 ${claims[best]} 吸附到同一颗星`);
  claims[best] = s.k;
  const [raH, dec, mag, bv] = SKY_STARS[best];
  NAMED.push({ k: s.k, zh: s.zh, en: s.en, b: s.b, c: s.c, ra: +raH.toFixed(5), dec: +dec.toFixed(4), mag, bv, d: s.d || null, note: s.note || null });
}

// ---------- 3. 星座连线 / 边界 / 名称 ----------
const CON_LINES = {}, CON_BOUNDS = {}, CON_INFO = {};
const order = cinfo.features.map(f => f.properties.desig);
lines.features.forEach((f, i) => {
  const des = order[i] || ('#' + i);
  const segs = (CON_LINES[des] = CON_LINES[des] || []);
  for (const line of f.geometry.coordinates) {
    segs.push(line.map(([lon, lat]) => [+toRaH(lon).toFixed(4), +lat.toFixed(3)]));
  }
});
cbounds.features.forEach((f, i) => {
  const des = order[i] || ('#' + i);
  const polys = (CON_BOUNDS[des] = CON_BOUNDS[des] || []);
  for (const poly of f.geometry.coordinates) {
    polys.push(poly.map(([lon, lat]) => [+toRaH(lon).toFixed(3), +lat.toFixed(2)]));
  }
});
// 星座名落点：星表自带的标注点有 1/3 落在别的星座里（金牛座偏 14°、天龙座 12°、波江座 11°），
// 改为「该星座连线的图形质心」——名字必然贴在用户看到的图形上。
const D2R = Math.PI / 180;
function v3(raH, dec) { const a = raH * 15 * D2R, d = dec * D2R; return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)]; }
function toRaDec(v) {
  const n = Math.hypot(v[0], v[1], v[2]);
  const ra = Math.atan2(v[1] / n, v[0] / n) / (15 * D2R);
  return [+(((ra % 24) + 24) % 24).toFixed(4), +(Math.asin(v[2] / n) / D2R).toFixed(3)];
}
function angBetween(a, b) {
  const p = v3(a[0], a[1]), q = v3(b[0], b[1]);
  return Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]))) / D2R;
}
const moved = [];
function bestLabel(des) {
  const pts = (CON_LINES[des] || []).flat();
  if (!pts.length) return null;
  let s = [0, 0, 0];
  for (const p of pts) { const v = v3(p[0], p[1]); s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; }
  return toRaDec(s);
}
for (const f of cinfo.features) {
  const p = f.properties;
  if (CON_INFO[p.desig]) continue;
  const cat = [+toRaH(f.geometry.coordinates[0]).toFixed(4), +f.geometry.coordinates[1].toFixed(2)];
  const lab = bestLabel(p.desig) || cat;
  const d = angBetween(lab, cat);
  if (d > 3) moved.push(`${p.desig} ${d.toFixed(0)}°`);
  CON_INFO[p.desig] = { zh: s2t(p.zh), name: p.name, label: lab };
}

// ---------- 4. 梅西耶天体（与 dsos.14 校准） ----------
const mIdx = {};
const dsoByDesig = {};
for (const f of dsos.features) {
  const des = (f.properties.desig || '').trim().replace(/\s+/g, ' ');
  if (des) dsoByDesig[des] = f;
  const m = /^M (\d+)$/.exec(f.properties.desig || '');
  if (m) mIdx['M' + (+m[1])] = f;
}
const MESSIER = CURATED_M.map(c => {
  const f = mIdx[c.id];
  let ra, dec, mag;
  if (f) {
    const [lon, lat] = f.geometry.coordinates;
    ra = +((((lon / 15) % 24) + 24) % 24).toFixed(5); dec = +lat.toFixed(4);
    mag = +f.properties.mag;
    if (!(mag > 0 && mag < 90)) mag = (c.mag != null ? c.mag : null);   // 999 等占位值视为未知
  } else if (c.h) {
    ra = c.h.ra; dec = c.h.dec; mag = c.h.mag;
  } else {
    problems.push(`WARN ${c.id} 不在 dsos.14 中（使用手工坐标）`);
    ra = null; dec = null; mag = null;
  }
  return { id: c.id, zh: c.zh, t: c.t, c: c.c, ra, dec, mag, d: c.d, note: c.note, cat: 'm' };
});
MESSIER.forEach(m => { if (m.mag == null && m.id === 'M40') m.mag = 8.4; });

// ---------- 4b. 著名 NGC/IC 天体（同样以 dsos.14 校准） ----------
const NGC = CURATED_NGC.map(c => {
  const f = dsoByDesig[c.id];
  let ra, dec, mag;
  if (f) {
    const [lon, lat] = f.geometry.coordinates;
    ra = +((((lon / 15) % 24) + 24) % 24).toFixed(5); dec = +lat.toFixed(4);
    mag = +f.properties.mag;
    if (!(mag > 0 && mag < 90)) mag = (c.mag != null ? c.mag : null);
  } else if (c.h) {
    ra = c.h.ra; dec = c.h.dec; mag = c.h.mag;
  } else {
    problems.push(`WARN ${c.id} 不在 dsos.14 中且无手工坐标`);
    ra = null; dec = null; mag = null;
  }
  return { id: c.id, zh: c.zh, t: c.t, c: c.c, ra, dec, mag, d: c.d, note: c.note, cat: 'ngc' };
});

// ---------- 5. 校验 ----------
for (const a of ASTERISMS) for (const k of a.pts) {
  if (!NAMED.find(n => n.k === k)) problems.push(`FAIL asterism 引用不存在的星 ${k}`);
}
const desigSet = new Set(order);
for (const m of MESSIER) if (!desigSet.has(m.c)) problems.push(`FAIL ${m.id} 星座缩写异常 ${m.c}`);
const mcount = MESSIER.filter(m => m.ra != null).length;
const ncount = NGC.filter(m => m.ra != null).length;
console.log(`恒星 ${SKY_STARS.length} | 命名星 ${NAMED.length}/${CURATED_STARS.length} | 星座 ${Object.keys(CON_LINES).length} | 梅西耶 ${mcount}/110 | NGC ${ncount}/15`);
console.log(`星座名落点：按图形质心重算，其中与星表标注点相距 >3° 的 ${moved.length} 个（${moved.join(' ')}）`);
if (problems.length) { console.log('—— 问题 ——'); problems.forEach(p => console.log(p)); }

// ---------- 6. 输出 ----------
function j(v) { return JSON.stringify(v); }
const out = `// 自动生成于 ${new Date().toISOString().slice(0, 10)}，数据源：d3-celestial (stars.6 / constellations / dsos.14, J2000)
const SKY_STARS = ${j(SKY_STARS)};
const NAMED = ${j(NAMED)};
const CON_LINES = ${j(CON_LINES)};
const CON_INFO = ${j(CON_INFO)};
const CON_BOUNDS = ${j(CON_BOUNDS)};
const MESSIER = ${j(MESSIER)};
const NGC = ${j(NGC)};
const DEEPSKY = MESSIER.concat(NGC);
const ASTERISMS = ${j(ASTERISMS)};
const CITIES = ${j(CITIES)};
`;
fs.mkdirSync(path.join(__dirname, '..', 'js'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'js', 'data-sky.js'), out);
console.log('已写出 js/data-sky.js (' + (out.length / 1024).toFixed(0) + ' KB)');

// ---------- 6. 更新 index.html 里的资源版本号（避免浏览器缓存旧数据/旧代码） ----------
const idxPath = path.join(__dirname, '..', 'index.html');
let html = fs.readFileSync(idxPath, 'utf8');
const stamp = Date.now().toString(36);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const f of ['style.css', 'js/data-sky.js', 'js/photos.js', 'js/sky.js', 'js/app.js']) {
  const re = new RegExp('((?:href|src)="' + esc(f) + ')(?:\\?v=[^"]*)?(")', 'g');
  html = html.replace(re, '$1?v=' + stamp + '$2');
}
fs.writeFileSync(idxPath, html);
console.log('已更新 index.html 资源版本号 ?v=' + stamp);
