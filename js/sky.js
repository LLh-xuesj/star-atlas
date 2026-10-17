// sky.js — 天文计算与星图渲染引擎
// v2：通用视角投影（观察中心可在天球上移动，支持平移/缩放/居中动画）
// 坐标均为 J2000；方位角从正北顺时针；高度角相对真地平
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const norm360 = a => ((a % 360) + 360) % 360;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function jdFromMs(ms) { return ms / 86400000 + 2440587.5; }

// 本地恒星时（度）
function lstDeg(jd, lonEast) {
  const d = jd - 2451545.0;
  return norm360(280.46061837 + 360.98564736629 * d + lonEast);
}

// 赤道坐标(ra小时, dec度) → 地平坐标
function toAltAz(raH, dec, lst, lat) {
  const H = norm360(lst - raH * 15) * D2R;
  const dR = dec * D2R, lR = lat * D2R;
  const sinAlt = Math.sin(dR) * Math.sin(lR) + Math.cos(dR) * Math.cos(lR) * Math.cos(H);
  const alt = Math.asin(clamp(sinAlt, -1, 1)) * R2D;
  const az = norm360(Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lR) - Math.tan(dR) * Math.cos(lR)) * R2D + 180);
  return { alt, az };
}

// 地平坐标 → 赤道坐标
function toRaDec(alt, az, lst, lat) {
  const a = alt * D2R, A = az * D2R, lR = lat * D2R;
  const e = Math.cos(a) * Math.sin(A), n = Math.cos(a) * Math.cos(A), u = Math.sin(a);
  const sinD = Math.sin(lR) * u + Math.cos(lR) * n;
  const dec = Math.asin(clamp(sinD, -1, 1)) * R2D;
  const H = Math.atan2(-e, Math.cos(lR) * u - Math.sin(lR) * n) * R2D;
  const ra = norm360(lst - H) / 15;
  return { ra, dec };
}

// 太阳低精度位置（Meeus）
function sunRaDec(jd) {
  const d = jd - 2451545.0;
  const L = norm360(280.460 + 0.9856474 * d);
  const g = norm360(357.528 + 0.9856003 * d);
  const lam = norm360(L + 1.915 * Math.sin(g * D2R) + 0.020 * Math.sin(2 * g * D2R));
  const eps = 23.439 - 0.0000004 * d;
  const ra = norm360(Math.atan2(Math.cos(eps * D2R) * Math.sin(lam * D2R), Math.cos(lam * D2R)) * R2D) / 15;
  const dec = Math.asin(Math.sin(eps * D2R) * Math.sin(lam * D2R)) * R2D;
  return { ra, dec, lam };
}

// 月亮低精度位置（误差约1°）
function moonRaDec(jd) {
  const d = jd - 2451545.0;
  const L = norm360(218.316 + 13.176396 * d);
  const M = norm360(134.963 + 13.064993 * d);
  const F = norm360(93.272 + 13.229350 * d);
  const lam = norm360(L + 6.289 * Math.sin(M * D2R));
  const beta = 5.128 * Math.sin(F * D2R);
  const dist = 385001 - 20905 * Math.cos(M * D2R);
  const eps = 23.439 * D2R, b = beta * D2R, l = lam * D2R;
  const x = Math.cos(b) * Math.cos(l);
  const y = Math.cos(eps) * Math.cos(b) * Math.sin(l) - Math.sin(eps) * Math.sin(b);
  const z = Math.sin(eps) * Math.cos(b) * Math.sin(l) + Math.cos(eps) * Math.sin(b);
  return { ra: norm360(Math.atan2(y, x) * R2D) / 15, dec: Math.asin(clamp(z, -1, 1)) * R2D, lam, dist };
}

// 行星日心黄道直角坐标（JPL 近似轨道元，1800–2050，误差<1°）
const PLANET_ELEMS = {
  Mercury: { a: [0.38709927, 0.00000037], e: [0.20563593, 0.00001906], I: [7.00497902, -0.00594749], L: [252.25032350, 149472.67411175], w: [77.45779628, 0.16047689], O: [48.33076593, -0.12534081] },
  Venus:   { a: [0.72333566, 0.00000390], e: [0.00677672, -0.00004107], I: [3.39467605, -0.00078890], L: [181.97909950, 58517.81538729], w: [131.60246718, 0.00268329], O: [76.67984255, -0.27769418] },
  Earth:   { a: [1.00000261, 0.00000562], e: [0.01671123, -0.00004392], I: [-0.00001531, -0.01294668], L: [100.46457166, 35999.37244981], w: [102.93768193, 0.32327364], O: [0, 0] },
  Mars:    { a: [1.52371034, 0.00001847], e: [0.09339410, 0.00007882], I: [1.84969142, -0.00813131], L: [-4.55343205, 19140.30268499], w: [-23.94362959, 0.44441088], O: [49.55953891, -0.29257343] },
  Jupiter: { a: [5.20288700, -0.00011607], e: [0.04838624, -0.00013253], I: [1.30439695, -0.00183714], L: [34.39644051, 3034.74612775], w: [14.72847983, 0.21252668], O: [100.47390909, 0.20469106] },
  Saturn:  { a: [9.53667594, -0.00125060], e: [0.05386179, -0.00050991], I: [2.48599187, 0.00193609], L: [49.95424423, 1222.49362201], w: [92.59887831, -0.41897216], O: [113.66242448, -0.28867794] },
};
function planetEclXYZ(name, jd) {
  const el = PLANET_ELEMS[name];
  const T = (jd - 2451545.0) / 36525;
  const a = el.a[0] + el.a[1] * T, e = el.e[0] + el.e[1] * T;
  const I = (el.I[0] + el.I[1] * T) * D2R;
  const L = el.L[0] + el.L[1] * T, w = el.w[0] + el.w[1] * T, O = el.O[0] + el.O[1] * T;
  const M = norm360(L - w);
  let E = M + R2D * e * Math.sin(M * D2R);
  for (let i = 0; i < 8; i++) {
    const dM = M - (E - R2D * e * Math.sin(E * D2R));
    E += dM / (1 - e * Math.cos(E * D2R));
  }
  const xp = a * (Math.cos(E * D2R) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E * D2R);
  const warg = (w - O) * D2R; // 近日点幅角 = 近日点黄经 − 升交点黄经
  const cw = Math.cos(warg), sw = Math.sin(warg), cO = Math.cos(O * D2R), sO = Math.sin(O * D2R), cI = Math.cos(I), sI = Math.sin(I);
  return {
    x: (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    y: (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    z: sw * sI * xp + cw * sI * yp,
  };
}
function planetRaDec(name, jd) {
  const p = planetEclXYZ(name, jd), q = planetEclXYZ('Earth', jd);
  const xe = p.x - q.x, ye = p.y - q.y, ze = p.z - q.z;
  const eps = 23.4392911 * D2R;
  const xq = xe, yq = ye * Math.cos(eps) - ze * Math.sin(eps), zq = ye * Math.sin(eps) + ze * Math.cos(eps);
  return { ra: norm360(Math.atan2(yq, xq) * R2D) / 15, dec: Math.asin(clamp(zq / Math.hypot(xq, yq, zq), -1, 1)) * R2D };
}

// ---------- 视角投影 ----------
// 视角中心 (alt0, az0)；屏幕"上"= 朝天顶方向；默认望南、地平压在视场下缘（像抬头看天，拖动即平移）
const DEFAULT_VIEW = { alt: 38, az: 180 };
const DEFAULT_ZOOM = 3;      // 竖直视场约 74°，与 Stellarium 默认接近：拖动像平移，不变形
const VIEW_ALT_MIN = -80, VIEW_ALT_MAX = 89.6, ZOOM_MIN = 1, ZOOM_MAX = 8;

// 视野基。roll 为画面滚转（度）：0 = 屏幕"上"朝天顶。拖动模型保持 roll≡0（地平线永远水平）
function viewFrame(alt0, az0, roll) {
  const a = alt0 * D2R, z = az0 * D2R, ca = Math.cos(a), sa = Math.sin(a), cz = Math.cos(z), sz = Math.sin(z);
  const c = [ca * cz, ca * sz, sa];                       // 观察方向
  const u0 = [-sa * cz, -sa * sz, ca];                    // 屏幕向上（朝更高高度角）
  const r0 = [u0[1] * c[2] - u0[2] * c[1], u0[2] * c[0] - u0[0] * c[2], u0[0] * c[1] - u0[1] * c[0]]; // 屏幕向右（方位角增大方向）
  if (!roll) return { c, u: u0, r: r0 };
  const s = Math.sin(roll * D2R), k = Math.cos(roll * D2R);
  return {
    c,
    r: [k * r0[0] + s * u0[0], k * r0[1] + s * u0[1], k * r0[2] + s * u0[2]],
    u: [-s * r0[0] + k * u0[0], -s * r0[1] + k * u0[1], -s * r0[2] + k * u0[2]],
  };
}
// 地平坐标 → 单位方向向量
function dirOf(alt, az) {
  const a = alt * D2R, z = az * D2R, ca = Math.cos(a);
  return [ca * Math.cos(z), ca * Math.sin(z), Math.sin(a)];
}
// 平移：方位角 + 高度角模型（「转头」式，Stellarium/SkySafari 的默认手感）
//   · 水平分量 → 绕天顶轴转方位角；垂直分量 → 抬高/降低视角高度角。
//   · 高度角**硬钳**在 [VIEW_ALT_MIN, VIEW_ALT_MAX]：到天顶 +89.6° 或 −80° 后垂直方向彻底停住。
//     因为方位角是独立变量、高度角是直接赋值，所以**结构上不可能翻到天顶另一侧**
//     （早先的「刚性旋转 + 事后钳高度角」会先转过天顶、再把高度角改回来，于是方位角/滚转各翻 180°；
//      即便改成「限制旋转量」，只要拖动的弧线擦着天顶旁边过去（最高点 < 89.6°）仍会绕到另一侧）。
//   · 滚转恒为 0：地平线始终水平，不会出现画面倾斜/上下颠倒；天球形状由保角投影保证不形变。
// dx,dy 为鼠标位移（屏幕像素，向下为正）；Rp 为画布上 90° 角距对应的像素半径；
// rhoPx 为抓取点到画布中心的像素距离（球极投影中央与边缘的角尺度不同，按抓取点取值才跟手）
function panView(alt0, az0, roll, dx, dy, Rp, rhoPx) {
  const u0 = (rhoPx || 0) / Math.max(Rp, 1);
  const kPx = 2 * R2D / (Math.max(Rp, 1) * (1 + u0 * u0));   // 抓取点处「度/像素」
  const alt = clamp(alt0 + dy * kPx, VIEW_ALT_MIN, VIEW_ALT_MAX);
  // 方位角速率随高度角升高而加快（近天顶时同样的像素位移对应更大的方位变化），
  // 除以 cos(alt) 后抓取点才贴着光标；极点附近设下限，避免数值爆炸。
  const ca = Math.max(Math.cos(clamp(alt0, -89.9, 89.9) * D2R), 0.3);
  const az = norm360(az0 - dx * kPx / ca);
  return { alt, az, roll: 0 };
}

// 拖动时把「按下去那一点的天区」（anchorAlt/anchorAz，按下去时位于 anchorX/anchorY 像素）
// 钉在光标上：解 (alt, az) 使该方向落在 (anchorX+dx, anchorY+dy)。roll 恒为 0，
// 所以地平线永远水平、也永远不会翻到天顶另一侧；高度角触界时解算必然留下残差，
// 调用方据此退回 panView 的纯方位-高度增量（触界后只转方位）。
function panViewAnchored(alt0, az0, dx, dy, w, h, R, zoom, anchorAlt, anchorAz, anchorX, anchorY) {
  const Rp = R * zoom, cx = w / 2, cy = h / 2;
  const tx = anchorX + dx, ty = anchorY + dy;
  let alt = clamp(alt0, VIEW_ALT_MIN, VIEW_ALT_MAX), az = az0, err = Infinity;
  for (let it = 0; it < 4; it++) {
    const p = projectView(anchorAlt, anchorAz, viewFrame(alt, az, 0), cx, cy, Rp);
    const ex = tx - p.x, ey = ty - p.y;
    err = Math.hypot(ex, ey);
    if (err < 0.25) break;
    const d = 0.05;
    const alt2 = clamp(alt + d, VIEW_ALT_MIN, VIEW_ALT_MAX), dA = alt2 - alt;
    if (dA < 1e-6) break;                       // 已在高度角上限，纯方位无解可求
    const pa = projectView(anchorAlt, anchorAz, viewFrame(alt2, az, 0), cx, cy, Rp);
    const pz = projectView(anchorAlt, anchorAz, viewFrame(alt, norm360(az + d), 0), cx, cy, Rp);
    const j11 = (pa.x - p.x) / dA, j21 = (pa.y - p.y) / dA;
    const j12 = (pz.x - p.x) / d, j22 = (pz.y - p.y) / d;
    const det = j11 * j22 - j12 * j21;
    if (!isFinite(det) || Math.abs(det) < 1e-8) break;   // 近极点退化，交给调用方走增量
    const dAlt = clamp((ex * j22 - ey * j12) / det, -20, 20);
    const dAz = clamp((j11 * ey - j21 * ex) / det, -30, 30);
    alt = clamp(alt + dAlt, VIEW_ALT_MIN, VIEW_ALT_MAX);
    az = norm360(az + dAz);
  }
  return { alt, az, roll: 0, err };
}
// 缩放时把 anchor 天体的屏幕位置钉在原处（牛顿法反解视中心；解不出/不可达时返回 err 大）
function solveCenterForAnchor(anchorAlt, anchorAz, tx, ty, alt0, az0, zoom, w, h, R, roll) {
  const Rp = R * zoom, cx = w / 2, cy = h / 2;
  const res = (alt, az) => {
    const p = projectView(anchorAlt, anchorAz, viewFrame(alt, az, roll || 0), cx, cy, Rp);
    return [p.x - tx, p.y - ty];
  };
  let alt = alt0, az = az0, err = 1e9;
  for (let it = 0; it < 8; it++) {
    const [ex, ey] = res(alt, az);
    err = Math.hypot(ex, ey);
    if (err < 0.05) break;
    const d = 0.05, [ax, ay] = res(alt + d, az), [bx, by] = res(alt, az + d);
    const j11 = (ax - ex) / d, j12 = (bx - ex) / d, j21 = (ay - ey) / d, j22 = (by - ey) / d;
    const det = j11 * j22 - j12 * j21;
    if (Math.abs(det) < 1e-9) break;
    const dAlt = (-ex * j22 + ey * j12) / det, dAz = (-j11 * ey + j21 * ex) / det;
    alt = clamp(alt + dAlt, VIEW_ALT_MIN, VIEW_ALT_MAX); az = norm360(az + dAz);
    if (Math.abs(dAlt) < 1e-6 && Math.abs(dAz) < 1e-6) break;
  }
  return { alt, az, err };
}
// 把地平坐标投影到屏幕（theta 为与视角中心的角距）
function projectView(alt, az, fr, cx, cy, Rp) {
  const a = alt * D2R, z = az * D2R, ca = Math.cos(a);
  const px = ca * Math.cos(z), py = ca * Math.sin(z), pz = Math.sin(a);
  const dot = clamp(px * fr.c[0] + py * fr.c[1] + pz * fr.c[2], -1, 1);
  const theta = Math.acos(dot) * R2D;
  let tx = px - dot * fr.c[0], ty = py - dot * fr.c[1], tz = pz - dot * fr.c[2];
  const tn = Math.hypot(tx, ty, tz);
  let X = 0, Y = 0;
  if (tn > 1e-9) { X = (tx * fr.r[0] + ty * fr.r[1] + tz * fr.r[2]) / tn; Y = (tx * fr.u[0] + ty * fr.u[1] + tz * fr.u[2]) / tn; }
  const rho = Rp * Math.tan(theta * D2R / 2);   // 球极投影（保角，形状不失真——行星软件标准投影）
  return { x: cx + rho * X, y: cy - rho * Y, theta };
}
// 屏幕坐标 → 地平坐标（未命中返回 null）
function unprojectView(sc, sx, sy) {
  const k = (sx - sc.cx) / sc.Rp, m = -(sy - sc.cy) / sc.Rp;
  const rho = Math.hypot(k, m);
  const theta = 2 * Math.atan(rho) * R2D;
  if (theta > 170) return null;
  const fr = sc.frame, ct = Math.cos(theta * D2R), st = Math.sin(theta * D2R);
  let t = [0, 0, 0];
  if (rho > 1e-9) { const X = k / rho, Y = m / rho; t = [X * fr.r[0] + Y * fr.u[0], X * fr.r[1] + Y * fr.u[1], X * fr.r[2] + Y * fr.u[2]]; }
  const px = fr.c[0] * ct + t[0] * st, py = fr.c[1] * ct + t[1] * st, pz = fr.c[2] * ct + t[2] * st;
  const alt = Math.asin(clamp(pz, -1, 1)) * R2D;
  const az = norm360(Math.atan2(py, px) * R2D);
  return { alt, az };
}
// 视角中心插值（球面线性插值，用于居中动画）
function slerpView(alt0, az0, alt1, az1, t) {
  const c0 = viewFrame(alt0, az0).c, c1 = viewFrame(alt1, az1).c;
  const dot = clamp(c0[0] * c1[0] + c0[1] * c1[1] + c0[2] * c1[2], -1, 1);
  const om = Math.acos(dot);
  if (om < 1e-6) return { alt: alt1, az: az1 };
  const s = Math.sin(om), w0 = Math.sin((1 - t) * om) / s, w1 = Math.sin(t * om) / s;
  const n = [c0[0] * w0 + c1[0] * w1, c0[1] * w0 + c1[1] * w1, c0[2] * w0 + c1[2] * w1];
  return { alt: Math.asin(clamp(n[2], -1, 1)) * R2D, az: norm360(Math.atan2(n[1], n[0]) * R2D) };
}

// ---------- 恒星颜色 ----------
function starColor(bv) {
  if (bv == null) return '#dfe4ff';
  if (bv < -0.1) return '#9db4ff';
  if (bv < 0.15) return '#d5e0ff';
  if (bv < 0.45) return '#f8f5ef';
  if (bv < 0.8) return '#ffefc9';
  if (bv < 1.4) return '#ffdca6';
  return '#ffbe87';
}
const STAR_COLORS = ['#dfe4ff', '#9db4ff', '#d5e0ff', '#f8f5ef', '#ffefc9', '#ffdca6', '#ffbe87'];
function colorIdx(bv) {
  if (bv == null) return 0;
  if (bv < -0.1) return 1;
  if (bv < 0.15) return 2;
  if (bv < 0.45) return 3;
  if (bv < 0.8) return 4;
  if (bv < 1.4) return 5;
  return 6;
}

const M_TYPES = {
  gx: { zh: '星系', color: '#ff9d6b' }, oc: { zh: '疏散星团', color: '#6be3ff' },
  gc: { zh: '球状星团', color: '#ffd166' }, pn: { zh: '行星状星云', color: '#7dffc4' },
  dn: { zh: '弥漫星云', color: '#e08bff' }, sn: { zh: '超新星遗迹', color: '#ff5d5d' },
  ast: { zh: '星群/恒星云', color: '#d7d7ff' }, ds: { zh: '双星', color: '#c9c9e8' },
};
const PLANET_ZH = { Mercury: '水星', Venus: '金星', Mars: '火星', Jupiter: '木星', Saturn: '土星' };
const PLANET_COLOR = { Mercury: '#b8b0a8', Venus: '#f5edd6', Mars: '#ff8a70', Jupiter: '#f0dcc0', Saturn: '#e8d9a8' };
const PLANET_NOTE = {
  Mercury: '肉眼难得一见，只能在黎明/黄昏低空短暂出现。',
  Venus: '夜空中最亮的行星（启明星/长庚星），只能在清晨或黄昏附近看到。',
  Mars: '发出不闪烁的红光，大冲年前后特别明亮。',
  Jupiter: '通常比所有恒星都亮，木星四颗伽利略卫星用双筒镜可见。',
  Saturn: '淡黄色，土星环需要望远镜才能看到。',
};

// ---------- 位置缓存：只随时间/地点变化（平移缩放时复用） ----------
const N_STAR = SKY_STARS.length, N_NAMED = NAMED.length, N_MESS = DEEPSKY.length;
const A_STAR = new Float32Array(N_STAR * 2);
const A_NAMED = new Float32Array(N_NAMED * 2);
const A_MESS = new Float32Array(N_MESS * 2);
const X_STAR = new Float32Array(N_STAR), Y_STAR = new Float32Array(N_STAR);
const I_STAR = new Int32Array(N_STAR);
// 可拾取的恒星（亮于4.5等）：索引+屏幕坐标，避免悬停时遍历全部
const PICK_IDX = [];
for (let i = 0; i < N_STAR; i++) if (SKY_STARS[i][2] <= 4.5) PICK_IDX.push(i);
const _cache = { key: '', jd: 0, lst: 0, sun: null, moon: null, planets: [] };

function ensurePositions(state) {
  const key = Math.round(state.simMs / 1000) + '|' + state.lat.toFixed(3) + '|' + state.lon.toFixed(3);
  if (_cache.key === key) return _cache;
  const jd = jdFromMs(state.simMs), lst = lstDeg(jd, state.lon);
  for (let i = 0; i < N_STAR; i++) {
    const s = SKY_STARS[i], aa = toAltAz(s[0], s[1], lst, state.lat);
    A_STAR[i * 2] = aa.alt; A_STAR[i * 2 + 1] = aa.az;
  }
  for (let i = 0; i < N_NAMED; i++) {
    const n = NAMED[i], aa = toAltAz(n.ra, n.dec, lst, state.lat);
    A_NAMED[i * 2] = aa.alt; A_NAMED[i * 2 + 1] = aa.az;
  }
  for (let i = 0; i < N_MESS; i++) {
    const m = DEEPSKY[i];
    if (m.ra == null) { A_MESS[i * 2] = -999; A_MESS[i * 2 + 1] = 0; continue; }
    const aa = toAltAz(m.ra, m.dec, lst, state.lat);
    A_MESS[i * 2] = aa.alt; A_MESS[i * 2 + 1] = aa.az;
  }
  const srd = sunRaDec(jd), saa = toAltAz(srd.ra, srd.dec, lst, state.lat);
  const mrd = moonRaDec(jd), maa = toAltAz(mrd.ra, mrd.dec, lst, state.lat);
  const elong = Math.acos(clamp(Math.sin(mrd.dec * D2R) * Math.sin(srd.dec * D2R) + Math.cos(mrd.dec * D2R) * Math.cos(srd.dec * D2R) * Math.cos((mrd.ra - srd.ra) * 15 * D2R), -1, 1)) * R2D;
  _cache.key = key; _cache.jd = jd; _cache.lst = lst;
  _cache.sun = { alt: saa.alt, az: saa.az, ra: srd.ra, dec: srd.dec };
  _cache.moon = { alt: maa.alt, az: maa.az, ra: mrd.ra, dec: mrd.dec, illum: (1 - Math.cos(elong * D2R)) / 2, waxing: norm360(mrd.lam - srd.lam) < 180, dist: mrd.dist };
  _cache.planets = Object.keys(PLANET_ZH).map(pn => {
    const rd = planetRaDec(pn, jd), aa = toAltAz(rd.ra, rd.dec, lst, state.lat);
    return { name: pn, alt: aa.alt, az: aa.az, ra: rd.ra, dec: rd.dec };
  });
  return _cache;
}

// 星座连线端点位置缓存（同样只随时间变；预分配数组，避免每帧分配）
const CON_KEYS = Object.keys(CON_LINES);
const CON_PTS = [], CON_SEG = [];   // CON_PTS: [raH,dec,...]；CON_SEG: {start,len,des}
(function buildConGeom() {
  let off = 0;
  for (const des of CON_KEYS) {
    for (const seg of CON_LINES[des]) {
      for (const p of seg) CON_PTS.push(p[0], p[1]);
      CON_SEG.push({ start: off, len: seg.length, des });
      off += seg.length;
    }
  }
})();
const CON_ALT = new Float32Array(CON_PTS.length / 2), CON_AZ = new Float32Array(CON_PTS.length / 2);
let conLabelPos = {}, conLabelKey = '';
const CON_INFO_KEYS = Object.keys(CON_INFO);
function ensureConPositions(state, lst) {
  if (conLabelKey === _cache.key) return;
  for (let i = 0; i < CON_ALT.length; i++) {
    const aa = toAltAz(CON_PTS[i * 2], CON_PTS[i * 2 + 1], lst, state.lat);
    CON_ALT[i] = aa.alt; CON_AZ[i] = aa.az;
  }
  conLabelPos = {};
  for (const des of CON_INFO_KEYS) {
    const L = CON_INFO[des].label;
    conLabelPos[des] = toAltAz(L[0], L[1], lst, state.lat);
  }
  conLabelKey = _cache.key;
}

// ---------- 场景计算：把天体投影到画布坐标 ----------
function computeScene(state, w, h) {
  const pos = ensurePositions(state);
  ensureConPositions(state, pos.lst);
  const R = Math.min(w, h) / 2 - 26;
  const zoom = clamp(state.zoom || 1, ZOOM_MIN, ZOOM_MAX);
  const Rp = R * zoom, cx = w / 2, cy = h / 2;
  const alt0 = clamp(state.viewAlt == null ? DEFAULT_VIEW.alt : state.viewAlt, VIEW_ALT_MIN, VIEW_ALT_MAX);
  const az0 = state.viewAz == null ? DEFAULT_VIEW.az : state.viewAz;
  const fr = viewFrame(alt0, az0, state.roll || 0);
  const sc = { jd: pos.jd, lst: pos.lst, cx, cy, R, Rp, zoom, frame: fr, viewAlt: alt0, viewAz: az0, roll: state.roll || 0, w, h, starN: 0 };

  for (let i = 0; i < N_STAR; i++) {
    const alt = A_STAR[i * 2];
    if (alt < -2) continue;
    const p = projectView(alt, A_STAR[i * 2 + 1], fr, cx, cy, Rp);
    if (p.x < -30 || p.x > w + 30 || p.y < -30 || p.y > h + 30) continue;
    X_STAR[sc.starN] = p.x; Y_STAR[sc.starN] = p.y;
    I_STAR[sc.starN] = i; sc.starN++;
  }
  sc.named = [];
  for (let i = 0; i < N_NAMED; i++) {
    const alt = A_NAMED[i * 2]; if (alt < -2) continue;
    const p = projectView(alt, A_NAMED[i * 2 + 1], fr, cx, cy, Rp);
    if (p.x < -40 || p.x > w + 40 || p.y < -40 || p.y > h + 40) continue;
    sc.named.push({ x: p.x, y: p.y, ref: NAMED[i], mag: NAMED[i].mag, alt, az: A_NAMED[i * 2 + 1] });
  }
  sc.messier = [];
  if (state.opts.messier !== false) {
    for (let i = 0; i < N_MESS; i++) {
      const alt = A_MESS[i * 2]; if (alt < -2) continue;
      const p = projectView(alt, A_MESS[i * 2 + 1], fr, cx, cy, Rp);
      if (p.x < -30 || p.x > w + 30 || p.y < -30 || p.y > h + 30) continue;
      sc.messier.push({ x: p.x, y: p.y, ref: DEEPSKY[i], alt, az: A_MESS[i * 2 + 1] });
    }
  }
  sc.planets = [];
  if (state.opts.planets) {
    for (const p of pos.planets) {
      if (p.alt < -2) continue;                    // 地平线下的行星与恒星一样不绘制
      const pp = projectView(p.alt, p.az, fr, cx, cy, Rp);
      sc.planets.push({ x: pp.x, y: pp.y, name: p.name, alt: p.alt, az: p.az, ra: p.ra, dec: p.dec });
    }
    const sp = projectView(pos.sun.alt, pos.sun.az, fr, cx, cy, Rp);
    sc.sun = { x: sp.x, y: sp.y, alt: pos.sun.alt, az: pos.sun.az };
    const mp = projectView(pos.moon.alt, pos.moon.az, fr, cx, cy, Rp);
    sc.moon = { x: mp.x, y: mp.y, alt: pos.moon.alt, az: pos.moon.az, illum: pos.moon.illum, waxing: pos.moon.waxing, dist: pos.moon.dist };
  }
  // 星座连线段（投影；超出画布一定范围的端点打断连线）
  sc.segs = [];
  if (state.opts.lines) {
    for (const sg of CON_SEG) {
      let prev = null;
      for (let i = sg.start; i < sg.start + sg.len; i++) {
        const alt = CON_ALT[i];
        const p = projectView(alt, CON_AZ[i], fr, cx, cy, Rp);
        const on = alt > -2 && p.x > -120 && p.x < w + 120 && p.y > -120 && p.y < h + 120;
        if (prev && on) sc.segs.push(prev.x, prev.y, p.x, p.y);
        prev = on ? p : null;
      }
    }
  }
  sc.conLabels = [];
  if (state.opts.names) {   // 星座名与连线相互独立：关掉连线也保留名字
    for (const des of Object.keys(conLabelPos)) {
      const aa = conLabelPos[des];
      if (aa.alt < -2) continue;
      const p = projectView(aa.alt, aa.az, fr, cx, cy, Rp);
      if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) continue;
      sc.conLabels.push({ x: p.x, y: p.y, zh: CON_INFO[des].zh });
    }
  }
  // 地平圈（大圆采样：视角移动后不再是屏幕上的圆）
  sc.horizon = [];
  for (let az = 0; az <= 360; az += 2) {
    const p = projectView(0, az, fr, cx, cy, Rp);
    sc.horizon.push(p.x, p.y);
  }
  return sc;
}

// 点击拾取（按像素距离返回最近天体；type: named|star|messier|planet|moon|sun）
function pickScene(sc, mx, my) {
  // 命名星在星表里也有一份副本（位置可能相差不到 1px），必须让命名/深空/行星优先命中，
  // 否则点中亮星时可能取到无名星副本 → 面板被当成"空白天区"关掉。
  let best = null, bestD = 1e9, bestStar = null, bestStarD = 1e9;
  const consider = (x, y, type, ref, rr, alt, az) => {
    const d = Math.hypot(mx - x, my - y);
    if (d <= rr && d < bestD) { bestD = d; best = { x, y, type, ref, d, alt, az }; }
  };
  for (const n of sc.named) consider(n.x, n.y, 'named', n.ref, 13, n.alt, n.az);
  for (const m of sc.messier) consider(m.x, m.y, 'messier', m.ref, 11, m.alt, m.az);
  for (const p of sc.planets) consider(p.x, p.y, 'planet', p, 13, p.alt, p.az);
  if (sc.moon) consider(sc.moon.x, sc.moon.y, 'moon', sc.moon, 15, sc.moon.alt, sc.moon.az);
  if (sc.sun) consider(sc.sun.x, sc.sun.y, 'sun', sc.sun, 15, sc.sun.alt, sc.sun.az);
  if (best) return best;
  for (let k = 0; k < sc.starN; k++) {
    const i = I_STAR[k];
    if (SKY_STARS[i][2] > 4.5) continue;   // 暗星不参与拾取
    const d = Math.hypot(mx - X_STAR[k], my - Y_STAR[k]);
    if (d <= 7 && d < bestStarD) { bestStarD = d; bestStar = { x: X_STAR[k], y: Y_STAR[k], type: 'star', ref: { idx: i, mag: SKY_STARS[i][2] }, d, alt: A_STAR[i * 2], az: A_STAR[i * 2 + 1] }; }
  }
  return bestStar;
}

// ---------- 离屏资源：背景渐变 / 亮星光晕 ----------
let _bg = { key: '', cv: null };
function bgCanvas(w, h, sunAlt) {
  const key = Math.round(sunAlt) + '|' + w + 'x' + h;
  if (_bg.key === key && _bg.cv) return _bg.cv;
  const dpr = window.devicePixelRatio || 1;
  const cv = document.createElement('canvas');
  cv.width = w * dpr; cv.height = h * dpr;
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  let bg1 = '#04060f', bg2 = '#0b1026';
  if (sunAlt > 0) { bg1 = '#5f86c9'; bg2 = '#9db9e2'; }
  else if (sunAlt > -9) { const t = (sunAlt + 9) / 9; bg1 = lerpColor('#04060f', '#33456b', t); bg2 = lerpColor('#0b1026', '#7c94bd', t); }
  const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, bg2); g.addColorStop(1, bg1);
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  _bg = { key, cv };
  return cv;
}
let _glow = null;
function glowSprite() {
  if (_glow) return _glow;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  _glow = cv;
  return _glow;
}
// 星云弥散光斑（按颜色缓存，避免每帧建渐变）
const _neb = {};
function nebSprite(col) {
  if (_neb[col]) return _neb[col];
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, col + 'd0');
  g.addColorStop(0.5, col + '66');
  g.addColorStop(1, col + '00');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  _neb[col] = cv;
  return cv;
}

// ---------- 标签避让（贪心，按亮度优先） ----------
function labelWidth(s) {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0x2e80 ? 13 : 6.6;
  return w;
}
function placeLabel(placed, x, y, text) {
  const w = labelWidth(text), h = 12;
  // 四周各留 2px：不这样的话相邻两颗星的标签会贴成「斗宿四斗宿一」
  const box = { x: x - 2, y: y - 12, w: w + 4, h: 15 };
  for (let i = 0; i < placed.length; i++) {
    const b = placed[i];
    if (box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y) return false;
  }
  placed.push(box);
  return true;
}

// ---------- 渲染 ----------
function renderScene(ctx, sc, state, w, h) {
  const o = state.opts;
  const sunAlt = sc.sun ? sc.sun.alt : -30;
  ctx.drawImage(bgCanvas(w, h, sunAlt), 0, 0, w, h);

  // 网格（高度圈 + 方位线，均为球面曲线采样）
  if (o.grid) {
    ctx.strokeStyle = 'rgba(120,150,220,0.13)'; ctx.lineWidth = 1;
    const fr = sc.frame;
    for (const alt of [30, 60]) {
      ctx.beginPath();
      for (let az = 0; az <= 360; az += 4) {
        const p = projectView(alt, az, fr, sc.cx, sc.cy, sc.Rp);
        az === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    for (let az = 0; az < 360; az += 30) {
      ctx.beginPath();
      for (let alt = 0; alt <= 90; alt += 4) {
        const p = projectView(alt, az, fr, sc.cx, sc.cy, sc.Rp);
        alt === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }
  // 地平圈 + 地平线下遮罩。
  // 球极投影把「地平线以下」映射到地平线圆的某一侧，到底在圆内还是圆外取决于视角在天上还是地下；
  // 所以先找一个确定在地面下的屏幕点（反投影后 alt<0）判断方向，再用 evenodd 只填屏幕内的那一侧。
  // 旧写法直接填地平线路径的内部，视角朝上时整个屏幕都落在地平线圆内，等于把整片天空压暗。
  const hz = new Path2D();
  for (let i = 0; i < sc.horizon.length; i += 2) {
    i === 0 ? hz.moveTo(sc.horizon[i], sc.horizon[i + 1]) : hz.lineTo(sc.horizon[i], sc.horizon[i + 1]);
  }
  hz.closePath();
  ctx.strokeStyle = 'rgba(160,190,255,0.6)'; ctx.lineWidth = 1.6; ctx.stroke(hz);
  let groundPt = null;
  for (const [gx, gy] of [[w / 2, h], [0, h], [w, h], [0, 0], [w, 0], [w / 2, 0]]) {
    const v = unprojectView(sc, gx, gy);
    if (v && v.alt < 0) { groundPt = [gx, gy]; break; }
  }
  if (groundPt) {
    ctx.fillStyle = 'rgba(26,38,68,0.34)';
    if (ctx.isPointInPath(hz, groundPt[0], groundPt[1])) {
      ctx.fill(hz);                                  // 地面在地平线圆内
    } else {
      hz.rect(-4, -4, w + 8, h + 8);
      ctx.fill(hz, 'evenodd');                       // 地面在地平线圆外（常态）
    }
  }
  // 方位标
  ctx.fillStyle = 'rgba(190,210,255,0.9)'; ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const azNames = { 0: '北', 90: '东', 180: '南', 270: '西' };
  for (const [az, t] of Object.entries(azNames)) {
    const p = projectView(0, +az, sc.frame, sc.cx, sc.cy, sc.Rp);
    const dx = p.x - sc.cx, dy = p.y - sc.cy, d = Math.hypot(dx, dy) || 1;
    ctx.fillText(t, p.x + dx / d * 15, p.y + dy / d * 15);
  }
  ctx.textBaseline = 'alphabetic';   // 后面的标签避让按字母基线计算包围盒

  // 星座连线（合并成一次 stroke）
  if (sc.segs.length) {
    ctx.strokeStyle = 'rgba(110,150,255,0.38)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < sc.segs.length; i += 4) { ctx.moveTo(sc.segs[i], sc.segs[i + 1]); ctx.lineTo(sc.segs[i + 2], sc.segs[i + 3]); }
    ctx.stroke();
  }
  // 星座名 + 四季辅助星群（星座名先占位，亮星标注再避让）
  const placed = [];
  if (o.names) {
    ctx.textAlign = 'center';
    const hasLS = 'letterSpacing' in ctx;
    if (hasLS) ctx.letterSpacing = '1.2px';
    ctx.font = '11.5px system-ui';
    ctx.fillStyle = 'rgba(146,174,255,0.82)';
    ctx.shadowColor = 'rgba(0,0,0,0.72)'; ctx.shadowBlur = 4;
    for (const c of sc.conLabels) {
      const lw = labelWidth(c.zh);
      if (c.y < 11 || c.y > h - 5) continue;
      const lx = clamp(c.x, lw / 2 + 3, w - lw / 2 - 3);   // 贴边时把名字拉回画布内
      ctx.fillText(c.zh, lx, c.y);
      placed.push({ x: lx - lw / 2 - 2, y: c.y - 12, w: lw + 4, h: 15 });
    }
    ctx.shadowBlur = 0;
    if (hasLS) ctx.letterSpacing = '0px';
  }
  if (o.ast) {
    ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(255,209,102,0.5)'; ctx.lineWidth = 1.2;
    for (const a of ASTERISMS) {
      const pts = a.pts.map(k => sc.named.find(n => n.ref.k === k)).filter(Boolean);
      for (let i = 0; i < pts.length - 1; i++) {
        if (pts[i].alt < 0 || pts[i + 1].alt < 0) continue;
        ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[i + 1].x, pts[i + 1].y); ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }

  // 梅西耶天体（按类型分桶批量描边/填充 + 单个符号）
  const mBuckets = {};
  for (const m of sc.messier) {
    const t = (M_TYPES[m.ref.t] || M_TYPES.dn).color;
    (mBuckets[t] = mBuckets[t] || []).push(m);
  }
  for (const [col, list] of Object.entries(mBuckets)) {
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.3;
    // 星系/行星状：椭圆/小圆批量
    ctx.beginPath();
    for (const m of list) {
      const size = clamp(9.5 - (m.ref.mag || 9), 4.5, 10);
      if (m.ref.t === 'gx') {
        ctx.moveTo(m.x + size, m.y);
        ctx.ellipse(m.x, m.y, size, size * 0.55, -0.5, 0, Math.PI * 2);
      } else if (m.ref.t === 'pn' || m.ref.t === 'gc') {
        ctx.moveTo(m.x + size * 0.55, m.y);
        ctx.arc(m.x, m.y, size * 0.55, 0, Math.PI * 2);
      }
    }
    ctx.stroke();
    for (const m of list) {
      const size = clamp(9.5 - (m.ref.mag || 9), 4.5, 10);
      if (m.ref.t === 'oc') {
        ctx.setLineDash([3, 2.5]);
        ctx.beginPath(); ctx.arc(m.x, m.y, size * 0.8, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        for (const [dx, dy] of [[-2, -1], [2, -2], [0, 2], [3, 1]]) { ctx.beginPath(); ctx.arc(m.x + dx, m.y + dy, 1.1, 0, Math.PI * 2); ctx.fill(); }
      } else if (m.ref.t === 'gc') {
        for (const [dx, dy] of [[-1.5, 0], [1.5, 0], [0, -1.5], [0, 1.5], [0, 0]]) { ctx.beginPath(); ctx.arc(m.x + dx, m.y + dy, 1.2, 0, Math.PI * 2); ctx.fill(); }
      } else if (m.ref.t === 'pn') {
        ctx.beginPath(); ctx.arc(m.x, m.y, 1.3, 0, Math.PI * 2); ctx.fill();
      } else if (m.ref.t === 'gx') {
        /* 已在上面批量描边 */
      } else {
        const size = clamp(9.5 - (m.ref.mag || 9), 4.5, 10);
        const sp = nebSprite(col);
        ctx.drawImage(sp, m.x - size, m.y - size, size * 2, size * 2);
      }
    }
  }

  // 恒星：按颜色分桶，暗星用方点批量绘制（每色一次 fill，替代逐星 arc+fill）
  const buckets = [];
  for (let i = 0; i < 7; i++) buckets.push(null);
  let bigN = 0;
  for (let k = 0; k < sc.starN; k++) {
    const idx = I_STAR[k], s = SKY_STARS[idx], x = X_STAR[k], y = Y_STAR[k];
    const r = Math.max(0.7, 6.0 - s[2] * 1.35);
    if (r > 2) { bigN++; continue; }
    const bi = colorIdx(s[3]);
    if (!buckets[bi]) buckets[bi] = new Path2D();
    buckets[bi].rect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 7; i++) {
    if (!buckets[i]) continue;
    ctx.fillStyle = STAR_COLORS[i];
    ctx.fill(buckets[i]);
  }
  // 亮星（约80颗）：圆点 + 光晕贴图
  const gs = glowSprite();
  for (let k = 0; k < sc.starN; k++) {
    const idx = I_STAR[k], s = SKY_STARS[idx];
    const r = Math.max(0.7, 6.0 - s[2] * 1.35);
    if (r <= 2) continue;
    const x = X_STAR[k], y = Y_STAR[k];
    ctx.fillStyle = starColor(s[3]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    if (s[2] < 1.2) { const sz = r * 5; ctx.drawImage(gs, x - sz / 2, y - sz / 2, sz, sz); }
  }

  // 命名亮星标注（圆环 + 标签，带避让）
  const sorted = sc.named.slice().sort((a, b) => a.mag - b.mag);
  if (o.starNames) {
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const n of sorted) {
      const r = Math.max(2, 7.2 - n.mag * 1.5);
      ctx.moveTo(n.x + r, n.y);
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 4;
    for (const n of sorted) {
      const ref = n.ref;
      if (!ref.zh && n.mag > 2.0) continue;
      if (state.highlight && state.highlight.kind === 'named' && state.highlight.key === ref.k) continue;
      const label = ref.zh || ref.b;
      const r = Math.max(2, 7.2 - n.mag * 1.5);
      const lw = labelWidth(label);
      let lx = n.x + r + 4;
      if (lx + lw > w - 2) lx = n.x - r - 4 - lw;   // 右边缘放不下就翻到星点左侧
      const ly = n.y - r - 2;
      if (lx < 2 || ly < 11 || ly > h - 5) continue;
      if (!placeLabel(placed, lx, ly, label)) continue;
      ctx.fillStyle = ref.zh ? '#eef1ff' : 'rgba(210,216,245,0.8)';
      ctx.font = (n.mag < 1.6 ? 'bold ' : '') + '12.5px system-ui';
      ctx.fillText(label, lx, ly);
    }
    ctx.shadowBlur = 0;
  }
  // 深空编号（同样避让；全天视图不铺编号，避免 125 个标签糊成一片）
  if (o.messierLabels && sc.zoom >= 1.7) {
    ctx.textAlign = 'center'; ctx.font = '10px system-ui';
    ctx.fillStyle = 'rgba(224,228,246,0.86)';
    ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 4;
    for (const m of sc.messier) {
      if (state.highlight && state.highlight.kind === 'messier' && state.highlight.key === m.ref.id) continue;
      if (m.x < 12 || m.x > w - 12) continue;
      const ly = m.y + 14;
      if (ly < 11 || ly > h - 5) continue;
      if (!placeLabel(placed, m.x - 12, ly, m.ref.id)) continue;
      ctx.fillText(m.ref.id, m.x, ly);
    }
    ctx.shadowBlur = 0;
  }
  // 行星 / 太阳 / 月亮
  for (const p of sc.planets) {
    ctx.fillStyle = PLANET_COLOR[p.name];
    ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,230,150,0.9)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.stroke();
    if (o.planetNames) {
      ctx.fillStyle = '#ffe9b0'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'left';
      const pl = PLANET_ZH[p.name], plx = p.x + 10, ply = p.y - 8;
      if (placeLabel(placed, plx, ply, pl)) {
        ctx.shadowColor = 'rgba(0,0,0,0.72)'; ctx.shadowBlur = 4;
        ctx.fillText(pl, plx, ply);
        ctx.shadowBlur = 0;
      }
    }
  }
  if (sc.sun && sc.sun.alt > -1) {
    const s = sc.sun;
    ctx.fillStyle = '#ffe27a';
    ctx.beginPath(); ctx.arc(s.x, s.y, 9, 0, Math.PI * 2); ctx.fill();
    const gr = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 26);
    gr.addColorStop(0, 'rgba(255,220,120,0.65)'); gr.addColorStop(1, 'rgba(255,220,120,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(s.x, s.y, 26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,240,190,0.9)'; ctx.font = '11px system-ui'; ctx.textAlign = 'left';
    if (placeLabel(placed, s.x + 12, s.y - 10, '太阳')) {
      ctx.shadowColor = 'rgba(0,0,0,0.72)'; ctx.shadowBlur = 4;
      ctx.fillText('太阳', s.x + 12, s.y - 10);
      ctx.shadowBlur = 0;
    }
  }
  if (sc.moon && sc.moon.alt > -1) drawMoon(ctx, sc.moon, o, placed);

  // 高亮脉冲（定位后）
  if (state.highlight) drawHighlight(ctx, sc, state);
  if (state.sel) {
    const p = findObjScreen(sc, state.sel);
    if (p) {
      ctx.strokeStyle = '#7dffc4'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, Math.PI * 2); ctx.stroke();
    }
  }
  if (sunAlt > -2) {
    ctx.fillStyle = sunAlt > 0 ? 'rgba(20,30,55,0.85)' : 'rgba(255,240,200,0.85)';
    ctx.font = 'bold 15px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(sunAlt > 0 ? '☀ 白天 — 恒星被阳光淹没，可把时间调到夜间' : '晨昏蒙影 — 天快亮/刚黑，亮星渐现', sc.cx, 22);
  }
}

function findObjScreen(sc, sel) {
  if (sel.kind === 'named') return sc.named.find(n => n.ref.k === sel.key) || null;
  if (sel.kind === 'messier') return sc.messier.find(m => m.ref.id === sel.key) || null;
  if (sel.kind === 'planet') {
    if (sel.key === '__moon') return sc.moon || null;
    if (sel.key === '__sun') return sc.sun || null;
    return sc.planets.find(p => p.name === sel.key) || null;
  }
  return null;
}
function drawHighlight(ctx, sc, state) {
  const hl = state.highlight;
  const p = findObjScreen(sc, hl);
  if (!p || p.alt < -2) return;
  const col = hl.color || '#ffd166';
  const t = Date.now() / 1000;
  const r = 27 + Math.sin(t * 4) * 2.5;
  ctx.strokeStyle = col; ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = col + '66'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(p.x, p.y, 36, 0, Math.PI * 2); ctx.stroke();
  // 名称标签放在脉冲圈之外，避免与圈线重叠
  const txt = (typeof objLabel === 'function') ? objLabel(hl.kind, hl.key) : '';
  if (txt) {
    ctx.font = 'bold 12.5px system-ui'; ctx.textAlign = 'center';
    const tw = txt.length * 12.5 + 14, bx = p.x, by = p.y - 46;
    ctx.fillStyle = 'rgba(8,12,24,0.88)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx - tw / 2, by - 14, tw, 21, 6);
    else ctx.rect(bx - tw / 2, by - 14, tw, 21);
    ctx.fill();
    ctx.strokeStyle = col + '88'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = col; ctx.fillText(txt, bx, by + 1);
  }
}
function drawMoon(ctx, mo, o, placed) {
  const r = 8, k = clamp(mo.illum, 0, 1);
  // 未照亮部分留一个很暗的盘，方便在星空中找到月亮
  ctx.fillStyle = 'rgba(196,204,224,0.12)';
  ctx.beginPath(); ctx.arc(mo.x, mo.y, r, 0, Math.PI * 2); ctx.fill();
  // 亮面：盈月亮面在右。明暗界线取半椭圆，半短轴 r·|2k−1| —— 亮面面积恰好是 k，
  // 弦月/凸月/满月都成比例（早先用「偏移一个暗圆」近似，k=0 和 k=1 都画不对）。
  ctx.save();
  if (!mo.waxing) { ctx.translate(mo.x, mo.y); ctx.scale(-1, 1); ctx.translate(-mo.x, -mo.y); }
  ctx.beginPath();
  ctx.arc(mo.x, mo.y, r, -Math.PI / 2, Math.PI / 2, false);
  ctx.ellipse(mo.x, mo.y, r * Math.abs(2 * k - 1), r, 0, Math.PI / 2, -Math.PI / 2, k <= 0.5);
  ctx.closePath();
  ctx.fillStyle = '#f4f0e6'; ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(240,238,225,0.75)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(mo.x, mo.y, r, 0, Math.PI * 2); ctx.stroke();
  if (o.planetNames) {
    ctx.fillStyle = '#e8e8dc'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'left';
    const t = '月亮 ' + Math.round(k * 100) + '%';
    if (!placed || placeLabel(placed, mo.x + 11, mo.y - 9, t)) {
      ctx.shadowColor = 'rgba(0,0,0,0.72)'; ctx.shadowBlur = 4;
      ctx.fillText(t, mo.x + 11, mo.y - 9);
      ctx.shadowBlur = 0;
    }
  }
}
function lerpColor(c1, c2, t) {
  const p = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const a = p(c1), b = p(c2);
  return 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',') + ')';
}

// 点在星座区内？（RA小时/dec度 多边形，处理 24h 环绕）
function conAt(raH, dec) {
  for (const des of Object.keys(CON_BOUNDS)) {
    for (const ring of CON_BOUNDS[des]) if (pointInRing(raH, dec, ring)) return des;
  }
  return null;
}
function pointInRing(raH, dec, ring) {
  let inside = false;
  for (let i = 0, jn = ring.length - 1; i < ring.length; jn = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[jn][0], yj = ring[jn][1];
    let x1 = xi, x2 = xj;
    if (x1 - raH > 12) x1 -= 24; if (raH - x1 > 12) x1 += 24;
    if (x2 - raH > 12) x2 -= 24; if (raH - x2 > 12) x2 += 24;
    if (((yi > dec) !== (yj > dec)) && (raH < (x2 - x1) * (dec - yi) / (yj - yi) + x1)) inside = !inside;
  }
  return inside;
}

// 最佳观测月：取每月15日21时（北京时间，UTC 13:00）高度角最大者
const BEST_TIME = month => Date.UTC(2026, month - 1, 15, 13, 0, 0);
function bestMonth(raH, dec, lat, lon) {
  let best = { m: 0, alt: -99 };
  for (let m = 0; m < 12; m++) {
    const aa = toAltAz(raH, dec, lstDeg(jdFromMs(BEST_TIME(m + 1)), lon), lat);
    if (aa.alt > best.alt) best = { m, alt: aa.alt };
  }
  const seasons = ['冬', '冬', '春', '春', '春', '夏', '夏', '夏', '秋', '秋', '秋', '冬'];
  return { month: best.m + 1, alt: best.alt, season: seasons[best.m] };
}
