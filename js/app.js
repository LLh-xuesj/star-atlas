// app.js — 界面与交互
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const CON_ZH = des => (CON_INFO[des] ? CON_INFO[des].zh : des);

// 构建指纹：从自身 script 标签的 ?v= 读取（由 gen/build.js 写入），用于判断浏览器是否还在用缓存
const BUILD_VER = (() => {
  try {
    const sc = [...document.scripts].find(x => /app\.js/.test(x.src));
    const m = sc && sc.src.match(/[?&]v=([^&]+)/);
    return m ? m[1] : 'dev';
  } catch (e) { return 'dev'; }
})();
console.log('%c识星 · 构建版本 ' + BUILD_VER, 'color:#5b8cff;font-weight:bold');

const state = {
  locName: '北京', lat: 39.9, lon: 116.4,
  simMs: Date.now(), live: true, playing: false, speed: 600,
  zoom: DEFAULT_ZOOM, viewAlt: DEFAULT_VIEW.alt, viewAz: DEFAULT_VIEW.az, roll: 0,
  opts: { lines: true, names: true, starNames: true, messierLabels: true, planets: true, planetNames: true, grid: false, ast: false },
  sel: null, highlight: null, animUntil: 0,
  needRender: true,
};
let chartScene = null, quizScene = null;
const dirty = () => { state.needRender = true; };

// ---------- 工具 ----------
function fmtBJ(ms) {
  return new Date(ms + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
}
function dtToInput(ms) { return new Date(ms + 8 * 3600e3).toISOString().slice(0, 16); }
function inputToMs(v) { return new Date(v + '+08:00').getTime(); }
function fmtRa(raH) {
  const r = ((raH % 24) + 24) % 24;
  let h = Math.floor(r), m = Math.round((r - h) * 60);
  if (m === 60) { m = 0; h = (h + 1) % 24; }
  return `${h}h${String(m).padStart(2, '0')}m`;
}
function fmtAzPt(alt, az) {
  if (alt < 0) return '地平线下';
  const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  const d = dirs[Math.round(az / 45) % 8];
  return `高 ${alt.toFixed(0)}° · ${d}方`;
}
function showToast(msg, ms = 3000) {
  const t = $('#toast'); t.textContent = msg; t.style.display = 'block';
  clearTimeout(showToast._h); showToast._h = setTimeout(() => t.style.display = 'none', ms);
}
function seasonOf(m) { return ['冬', '冬', '春', '春', '春', '夏', '夏', '夏', '秋', '秋', '秋', '冬'][m]; }

// ---------- 选项卡 ----------
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  $$('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  $$('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'chart') sizeCanvas();   // 隐藏期间窗口尺寸可能已变
  if (b.dataset.tab === 'quiz') sizeQuizCanvas();
  dirty();
});

// ---------- 星图画布 ----------
const canvas = $('#sky'), ctx = canvas.getContext('2d');
function sizeCanvas() {
  const wrap = $('#chartwrap'), dpr = window.devicePixelRatio || 1;
  if (!(wrap.clientWidth > 0 && wrap.clientHeight > 0)) return;   // 星图页不可见时不动画布
  canvas.width = wrap.clientWidth * dpr; canvas.height = wrap.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  dirty();
}
window.addEventListener('resize', () => {
  sizeCanvas(); sizeQuizCanvas();
  if (drag) {   // 拖动中改窗口大小：同步缓存的画布几何，避免下一帧跳一下
    drag.rect = canvas.getBoundingClientRect();
    drag.w = canvas.clientWidth; drag.h = canvas.clientHeight; drag.R = viewR();
  }
});

function draw() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!(w > 0 && h > 0)) { state.needRender = true; return; }   // 画布隐藏时跳过（如停在图鉴页）
  chartScene = computeScene(state, w, h);
  updateViewHud();
  renderScene(ctx, chartScene, state, w, h);
  state.needRender = false;
}
// 交互前确保 chartScene 与 state 同步（快速连发事件时 rAF 可能还没重绘）
function freshScene() {
  if (state.needRender || !chartScene) draw();
  return chartScene;
}

// ---------- 视角动画（居中定位用）----------
const anim = { on: false, t0: 0, dur: 560, from: null, to: null };
function animateView(alt, az, zoom, dur = 560, roll = 0) {
  anim.on = true; anim.t0 = performance.now(); anim.dur = dur;
  anim.from = { alt: state.viewAlt, az: state.viewAz, zoom: state.zoom, roll: state.roll || 0 };
  anim.to = { alt: clamp(alt, VIEW_ALT_MIN, VIEW_ALT_MAX), az, zoom: clamp(zoom, ZOOM_MIN, ZOOM_MAX), roll };
  state.animUntil = anim.t0 + dur + 3200;   // 结束后继续跑高亮脉冲
  dirty();
}
function stepAnim(ts) {
  if (!anim.on) return;
  const t = clamp((ts - anim.t0) / anim.dur, 0, 1);
  const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const v = slerpView(anim.from.alt, anim.from.az, anim.to.alt, anim.to.az, e);
  state.viewAlt = v.alt; state.viewAz = v.az;
  state.zoom = anim.from.zoom + (anim.to.zoom - anim.from.zoom) * e;
  let dr = anim.to.roll - anim.from.roll;
  while (dr > 180) dr -= 360; while (dr < -180) dr += 360;
  state.roll = anim.from.roll + dr * e;
  if (t >= 1) { state.roll = anim.to.roll; anim.on = false; }
  dirty();
}

function canvasXY(e) {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

function tickBody(ts) {
  updateHstat();   // 顶栏时钟独立于星图渲染：切到图鉴/测验页也继续走
  if (state.playing) { state.simMs += (ts - (tickBody._last || ts)) * state.speed; syncDt(); dirty(); }
  else if (state.live) {
    const sec = Math.floor(ts / 1000);
    if (sec !== tickBody._sec) { tickBody._sec = sec; state.simMs = Date.now(); syncDt(); dirty(); }
  }
  tickBody._last = ts;
  stepAnim(ts);
  if (state.highlight && ts < state.animUntil) dirty();   // 高亮脉冲持续刷新
  if (state.needRender) { state.needRender = false; draw(); }
}
function tick(ts) { tickBody(ts); requestAnimationFrame(tick); }
// 隐藏标签页里 rAF 会被暂停，用定时器兜底驱动；可见时交给 rAF，避免多画一帧
setInterval(() => { if (document.hidden) tickBody(performance.now()); }, 300);

// ---------- 工具栏 ----------
// 播放按钮图标随状态切换（SVG symbol）
function setPlayIcon(on) {
  $('#play').innerHTML = `<svg><use href="#i-${on ? 'pause' : 'play'}"/></svg>`;
  $('#play').title = on ? '暂停时间流逝' : '播放时间流逝';
}
// 顶栏状态条：地点 · 经纬 · 时刻
let hstatLast = '';
function updateHstat() {
  const t = new Date(state.simMs), p = n => String(n).padStart(2, '0');
  const s = `${state.locName}|${state.lat}|${state.lon}|${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
  if (s === hstatLast) return;
  hstatLast = s;
  const io = state.lat >= 0 ? 'N' : 'S', io2 = state.lon >= 0 ? 'E' : 'W';
  $('#hstat').innerHTML =
    `<b>${state.locName}</b><span class="sep"></span>` +
    `<span>${Math.abs(state.lat).toFixed(1)}°${io} ${Math.abs(state.lon).toFixed(1)}°${io2}</span>` +
    `<span class="sep"></span><span>${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}</span>`;
}
// 星图左上角的视角读数：高度角 / 方位 / 滚转 / 缩放。
// 拖动时最多约 11 次/秒更新 DOM——每帧重建 innerHTML 会打断合成，看起来就是抽动。
let vhudLast = '', vhudT = 0;
function updateViewHud(force) {
  const now = performance.now();
  if (!force && drag && now - vhudT < 90) return;
  vhudT = now;
  const roll = Math.round((chartScene && chartScene.roll) || 0);
  const azN = ((state.viewAz % 360) + 360) % 360;
  const s = state.viewAlt.toFixed(1) + '|' + Math.round(azN) + '|' + state.zoom.toFixed(2) + '|' + roll;
  if (s === vhudLast) return;
  vhudLast = s;
  const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  const d = dirs[Math.round(azN / 45) % 8];
  $('#viewhud').innerHTML =
    `<span>视向 <b>${state.viewAlt.toFixed(1)}°</b> ${d}</span>` +
    `<span class="sep"></span><span>缩放 <b>${state.zoom.toFixed(1)}×</b></span>` +
    (roll ? `<span class="sep"></span><span>滚转 <b>${roll}°</b></span>` : '');
}

const citySel = $('#city');
CITIES.forEach(([name, lat, lon], i) => citySel.add(new Option(name, i)));
citySel.add(new Option('自定义…', '__'));
citySel.value = '0';                       // 默认北京
$('#lat').value = state.lat; $('#lon').value = state.lon;
citySel.onchange = () => {
  if (citySel.value === '__') return;
  const [name, lat, lon] = CITIES[+citySel.value];
  state.locName = name; $('#lat').value = lat; $('#lon').value = lon; state.lat = lat; state.lon = lon; dirty();
};
$('#lat').oninput = e => { state.lat = +e.target.value || 0; citySel.value = '__'; state.locName = '自定义'; dirty(); };
$('#lon').oninput = e => { state.lon = +e.target.value || 0; citySel.value = '__'; state.locName = '自定义'; dirty(); };

const dtInput = $('#dt');
function syncDt() { if (document.activeElement !== dtInput) dtInput.value = dtToInput(state.simMs); }
syncDt();
dtInput.onchange = () => {
  const ms = inputToMs(dtInput.value);
  if (!isFinite(ms)) return;
  state.simMs = ms; state.live = false; $('#live').checked = false; dirty();
  const y = new Date(ms + 8 * 3600e3).getUTCFullYear();
  if (y < 1800 || y > 2050) showToast('行星轨道近似公式适用于 1800–2050 年，此范围外行星位置会明显偏差', 4500);
};
$('#live').onchange = e => { state.live = e.target.checked; if (state.live) { state.playing = false; setPlayIcon(false); } dirty(); };
$('#play').onclick = () => {
  state.playing = !state.playing;
  setPlayIcon(state.playing);
  if (state.playing) { state.live = false; $('#live').checked = false; }
  dirty();
};
$('#speed').onchange = e => { state.speed = +e.target.value; };
$$('#toggles input').forEach(c => c.onchange = () => { state.opts[c.dataset.opt] = c.checked; dirty(); });

// 视角半径（未缩放），与 computeScene 保持一致
function viewR() { return Math.min(canvas.clientWidth, canvas.clientHeight) / 2 - 26; }
function resetView(animate = true) {
  if (animate) animateView(DEFAULT_VIEW.alt, DEFAULT_VIEW.az, DEFAULT_ZOOM, 420, 0);
  else { state.viewAlt = DEFAULT_VIEW.alt; state.viewAz = DEFAULT_VIEW.az; state.zoom = DEFAULT_ZOOM; state.roll = 0; dirty(); }
}
$('#zoomin').onclick = () => { anim.on = false; state.zoom = clamp(state.zoom * 1.3, ZOOM_MIN, ZOOM_MAX); dirty(); };
$('#zoomout').onclick = () => { anim.on = false; state.zoom = clamp(state.zoom / 1.3, ZOOM_MIN, ZOOM_MAX); dirty(); };
$('#resetview').onclick = () => resetView(true);
canvas.addEventListener('wheel', e => {
  e.preventDefault(); anim.on = false;
  const z1 = state.zoom, z2 = clamp(state.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), ZOOM_MIN, ZOOM_MAX);
  if (z2 === z1) return;
  const [sx, sy] = canvasXY(e);
  const sc0 = freshScene();
  const anchor = sc0 ? unprojectView(sc0, sx, sy) : null;
  state.zoom = z2;
  if (anchor) {   // 光标处天体缩放前后停在同一个像素上
    const w = canvas.clientWidth, h = canvas.clientHeight, R = viewR();
    const s = solveCenterForAnchor(anchor.alt, anchor.az, sx, sy, state.viewAlt, state.viewAz, z2, w, h, R, state.roll || 0);
    if (s.err < 2) { state.viewAlt = s.alt; state.viewAz = s.az; }
  }
  dirty();
}, { passive: false });
canvas.addEventListener('dblclick', () => resetView(true));

// ---------- 双指捏合缩放（触屏）----------
// 两指中点保持不动，间距比例映射到 zoom；捏合期间禁用单指拖动。
let pinch = null;
function pinchPoint(e, rect) {
  const xs = [...e.touches].map(t => t.clientX - rect.left), ys = [...e.touches].map(t => t.clientY - rect.top);
  return {
    x: xs.reduce((a, b) => a + b, 0) / xs.length,
    y: ys.reduce((a, b) => a + b, 0) / ys.length,
    span: Math.hypot(xs[0] - xs[1], ys[0] - ys[1]),
  };
}
canvas.addEventListener('touchstart', e => {
  if (e.touches.length !== 2) return;
  e.preventDefault(); anim.on = false;
  const rect = canvas.getBoundingClientRect();
  const p = pinchPoint(e, rect);
  if (!(p.span > 10)) return;
  const sc = freshScene();
  pinch = { rect, startZoom: state.zoom, startSpan: p.span, anchor: sc ? unprojectView(sc, p.x, p.y) : null };
  if (drag) { drag = null; canvas.style.cursor = 'grab'; }   // 第二根手指落下，取消单指拖动
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  if (!pinch || e.touches.length !== 2) return;
  e.preventDefault();
  const p = pinchPoint(e, pinch.rect);
  if (!(pinch.startSpan > 10) || !(p.span > 0)) return;
  const z2 = clamp(pinch.startZoom * p.span / pinch.startSpan, ZOOM_MIN, ZOOM_MAX);
  if (z2 === state.zoom) return;
  state.zoom = z2;
  if (pinch.anchor) {   // 双指中点处天体缩放前后停在同一个像素上
    const w = canvas.clientWidth, h = canvas.clientHeight, R = viewR();
    const s = solveCenterForAnchor(pinch.anchor.alt, pinch.anchor.az, p.x, p.y, state.viewAlt, state.viewAz, z2, w, h, R, state.roll || 0);
    if (s.err < 2) { state.viewAlt = s.alt; state.viewAz = s.az; }
  }
  dirty();
}, { passive: false });
canvas.addEventListener('touchend', e => {
  if (!pinch || e.touches.length >= 2) return;
  pinch = null;
  updateViewHud(true);
  // 拦掉捏合结束后多出来的合成 click
  suppressClick = true; setTimeout(() => { suppressClick = false; }, 250);
}, { passive: false });
canvas.addEventListener('touchcancel', () => { pinch = null; }, { passive: false });

// 拖动平移（pointer 事件，鼠标/触摸通用）：水平＝转方位，垂直＝抬降视角；高度角硬钳、地平线始终水平
let drag = null, suppressClick = false;
canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  anim.on = false;
  const [sx, sy] = canvasXY(e);
  const sc = freshScene();
  const anchor = sc ? unprojectView(sc, sx, sy) : null;   // 按住的那一点天区，拖动时钉在光标上
  $('#tooltip').style.display = 'none';
  // 缓存画布尺寸/位置：拖动期间避免每次 pointermove 都读 clientWidth/getBoundingClientRect
  drag = { x: e.clientX, y: e.clientY, sx, sy, anchor, moved: 0, id: e.pointerId,
    rect: canvas.getBoundingClientRect(), w: canvas.clientWidth, h: canvas.clientHeight, R: viewR() };
  suppressClick = false;
  canvas.style.cursor = 'grabbing';
  if (e.pointerType !== 'mouse' && e.isPrimary === false && drag) drag.secondFinger = true;   // 双指：冻结单指平移
  try { canvas.setPointerCapture(e.pointerId); } catch { }
});
canvas.addEventListener('pointermove', e => {
  if (pinch) return;   // 双指捏合期间不处理单指逻辑
  if (drag && e.pointerId === drag.id) {
    if (e.pointerType !== 'mouse' && drag.secondFinger) return;   // 双指期间冻结单指平移
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    const w = drag.w, h = drag.h, R = drag.R * state.zoom;
    if ((Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) && R > 0) {
      const sx = e.clientX - drag.rect.left, sy = e.clientY - drag.rect.top;
      let v = null;
      if (drag.anchor) {   // 先把「按住的那一点」钉到光标位置（roll 保持 0）
        v = panViewAnchored(state.viewAlt, state.viewAz, sx - drag.sx, sy - drag.sy, w, h, drag.R, state.zoom,
          drag.anchor.alt, drag.anchor.az, drag.sx, drag.sy);
        if (!(v.err < 3)) v = null;   // 高度角触界 / 近极点退化 → 退回纯方位-高度增量
      }
      if (!v) {
        const rhoPx = Math.hypot(sx - w / 2, sy - h / 2);
        v = panView(state.viewAlt, state.viewAz, state.roll || 0, dx, dy, R, rhoPx);
      }
      state.viewAlt = clamp(v.alt, VIEW_ALT_MIN, VIEW_ALT_MAX);
      state.viewAz = v.az; state.roll = 0;
      state.sel = null;
      dirty();
    }
    if (drag.moved > 4) suppressClick = true;
    return;
  }
  scheduleHover(e);
});
function endDrag(e) {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  const wasTwo = drag.secondFinger;
  try { canvas.releasePointerCapture(drag.id); } catch { }
  drag = null; canvas.style.cursor = 'grab';
  updateViewHud(true);   // 拖动结束后强制刷新一次读数（拖动中限频）
  if (wasTwo) {   // 双指松开后拦一次合成 click
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 250);
  }
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', e => { if (!drag) $('#tooltip').style.display = 'none'; });

// ---------- 点击 / 悬停 ----------
let hoverPending = null, hoverRAF = 0;
function scheduleHover(e) {
  hoverPending = e;
  if (hoverRAF) return;
  hoverRAF = requestAnimationFrame(() => { hoverRAF = 0; if (hoverPending) doHover(hoverPending); });
}
function doHover(e) {
  if (!chartScene) return;
  const r = canvas.getBoundingClientRect();
  const hit = pickScene(chartScene, e.clientX - r.left, e.clientY - r.top);
  const tip = $('#tooltip');
  if (hit) {
    tip.textContent = objName(hit);
    tip.style.display = 'block';
    // 靠近右/下边缘时翻到光标另一侧，避免提示框被画布裁掉
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let lx = e.clientX - r.left + 14, ly = e.clientY - r.top + 10;
    if (lx + tw > r.width - 6) lx = e.clientX - r.left - tw - 14;
    if (ly + th > r.height - 6) ly = e.clientY - r.top - th - 10;
    tip.style.left = clamp(lx, 4, Math.max(4, r.width - tw - 4)) + 'px';
    tip.style.top = clamp(ly, 4, Math.max(4, r.height - th - 4)) + 'px';
  } else tip.style.display = 'none';
  if (!drag) canvas.style.cursor = hit ? 'pointer' : 'grab';
}
function objName(hit) {
  if (hit.type === 'named') return (hit.ref.zh ? hit.ref.zh + ' ' : '') + hit.ref.b + ` (${hit.ref.mag}等)`;
  if (hit.type === 'star') return `恒星 (${hit.ref.mag}等)`;
  if (hit.type === 'messier') return hit.ref.id + ' ' + (hit.ref.zh || (M_TYPES[hit.ref.t] || {}).zh || '');
  if (hit.type === 'planet') return PLANET_ZH[hit.ref.name];
  if (hit.type === 'moon') return '月亮';
  if (hit.type === 'sun') return '太阳';
  return '';
}
canvas.addEventListener('click', e => {
  if (!freshScene() || suppressClick) { suppressClick = false; return; }
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const hit = pickScene(chartScene, mx, my);
  if (hit) { selectObj(hit); return; }
  // 空白处 → 报告所在星座天区
  const v = unprojectView(chartScene, mx, my);
  state.sel = null; state.highlight = null; dirty();
  if (!v || v.alt < 0) { hideInfo(); return; }
  const rd = toRaDec(v.alt, v.az, chartScene.lst, state.lat);
  const des = conAt(rd.ra, rd.dec);
  if (des) showConInfo(des, v.alt, v.az); else hideInfo();
});
function selectObj(hit) {
  if (hit.type === 'named') showStarInfo(hit.ref, hit.alt, hit.az);
  else if (hit.type === 'messier') showMessierInfo(hit.ref, hit.alt, hit.az);
  else if (hit.type === 'planet') showPlanetInfo(hit.ref);
  else if (hit.type === 'moon') showMoonInfo(hit.ref);
  else if (hit.type === 'sun') showSunInfo(hit.ref);
  else hideInfo();
}

// ---------- 信息面板 ----------
function openInfo(html) { $('#infocontent').innerHTML = html; $('#infopanel').classList.remove('hidden'); }
function hideInfo() { $('#infopanel').classList.add('hidden'); }
$('#closeinfo').onclick = hideInfo;
function locateBtn(kind, key) { return `<div class="btnrow"><button onclick="appLocate('${kind}','${key}')">📍 在星图中居中定位</button></div>`; }
function switchToChart() {
  $$('#tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === 'chart'));
  $$('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-chart'));
}
function objLabel(kind, key) {
  if (kind === 'named') { const n = NAMED.find(n => n.k === key); return n ? (n.zh || n.b) : key; }
  if (kind === 'messier') { const m = DEEPSKY.find(m => m.id === key); return m ? m.id + (m.zh ? ' ' + m.zh : '') : key; }
  return key;
}
window.appLocate = (kind, key) => {
  switchToChart();
  hideInfo();
  // 星座：居中到星座名位置并适度放大；此刻在地平线下时和其他天体一样跳到最佳观测月
  if (kind === '__con') {
    const info = CON_INFO[key]; if (!info) return;
    state.opts.lines = true; $('#toggles input[data-opt=lines]').checked = true;
    state.highlight = null; state.sel = null;
    let aa = toAltAz(info.label[0], info.label[1], lstDeg(jdFromMs(state.simMs), state.lon), state.lat);
    let note = '，已打开星座连线';
    if (aa.alt < 3) {
      const bm = bestMonth(info.label[0], info.label[1], state.lat, state.lon);
      state.simMs = BEST_TIME(bm.month);
      state.live = false; $('#live').checked = false; state.playing = false; setPlayIcon(false);
      syncDt();
      const jd = jdFromMs(state.simMs), lst = lstDeg(jd, state.lon);
      aa = toAltAz(info.label[0], info.label[1], lst, state.lat);
      const sd = sunRaDec(jd);
      const sunAlt = toAltAz(sd.ra, sd.dec, lst, state.lat).alt;
      note = bm.alt < 0
        ? `：此地全年升不出地平线（最高约 ${bm.alt.toFixed(0)}°），已对准它在地平线下的位置`
        : `：此刻不可见，已跳到 ${bm.month}月15日 21:00（仰角 ${aa.alt.toFixed(0)}°${sunAlt > 0 ? '，但当地仍是白天' : ''}）`;
    }
    animateView(aa.alt, aa.az, 1.7);
    showToast(`${info.zh}${aa.alt >= 3 ? ' 已居中' : ''}${note}`, 4500);
    return;
  }
  state.highlight = { kind, key, color: kind === 'messier' ? '#ffd166' : '#7dffc4' };
  state.sel = { kind, key };
  let aa = objAltAz(kind, key);
  if (!aa) return;
  let note;
  if (aa.alt < 3) {
    const rd = objRaDec(kind, key);
    if (rd) {
      const bm = bestMonth(rd.ra, rd.dec, state.lat, state.lon);
      state.simMs = BEST_TIME(bm.month);
      state.live = false; $('#live').checked = false; state.playing = false; setPlayIcon(false);
      syncDt();
      aa = objAltAz(kind, key);
      const jd = jdFromMs(state.simMs), sd = sunRaDec(jd);
      const sunNow = toAltAz(sd.ra, sd.dec, lstDeg(jd, state.lon), state.lat);
      note = bm.alt < 0
        ? `：此地全年升不出地平线（最高约 ${bm.alt.toFixed(0)}°）`
        : `：此刻不可见，已跳到 ${bm.month}月15日 21:00（仰角 ${aa.alt.toFixed(0)}°${sunNow.alt > 0 ? '，但当地仍是白天' : ''}）`;
    } else note = '';
  } else note = `：${fmtAzPt(aa.alt, aa.az)}`;
  animateView(aa.alt, aa.az, 2.6);
  showToast(`已居中定位 ${objLabel(kind, key)}${note}`, 4500);
};
function objRaDec(kind, key) {
  if (kind === 'named') { const n = NAMED.find(n => n.k === key); return n ? { ra: n.ra, dec: n.dec } : null; }
  if (kind === 'messier') { const m = DEEPSKY.find(m => m.id === key); return m ? { ra: m.ra, dec: m.dec } : null; }
  return null;
}
function objAltAz(kind, key) {
  const rd = objRaDec(kind, key); if (!rd) return chartScene ? null : null;
  return toAltAz(rd.ra, rd.dec, lstDeg(jdFromMs(state.simMs), state.lon), state.lat);
}
function jumpBest(kind, key) {
  const rd = objRaDec(kind, key); if (!rd) return;
  const bm = bestMonth(rd.ra, rd.dec, state.lat, state.lon);
  state.simMs = BEST_TIME(bm.month);
  state.live = false; $('#live').checked = false; syncDt(); dirty();
  showToast(`已跳到 ${bm.month}月15日 21:00`);
}

// 深空天体配图（图鉴与信息面板共用；照片来自 ESA/Hubble / NOIRLab，CC BY 4.0）
function photoFigure(key, compact) {
  const p = (typeof PHOTOS !== 'undefined') && PHOTOS[key];
  if (!p) return '';
  const wide = p.w / p.h > 2.3 ? ' wide' : '';
  return `<figure class="photo${compact ? ' compact' : ''}${wide}">
    <a class="photo-open" href="${p.src1280}" data-key="${key}" title="查看大图">
      <picture>
        <source type="image/webp" srcset="${p.src640} 640w, ${p.src1280} 1280w" sizes="${compact ? '340px' : '(max-width: 940px) 92vw, 430px'}">
        <img loading="lazy" decoding="async" src="${p.jpg}" width="${p.w}" height="${p.h}" alt="${p.title.replace(/"/g, '&quot;')}">
      </picture>
    </a>
    <figcaption><span class="ph-title">${p.title}</span><span class="ph-credit">${p.credit} · <a href="${p.licenseUrl}" target="_blank" rel="noopener">${p.license}</a></span><a href="${p.source}" target="_blank" rel="noopener">原图 ↗</a></figcaption>
  </figure>`;
}
function openLightbox(key) {
  const p = (typeof PHOTOS !== 'undefined') && PHOTOS[key];
  if (!p) return;
  $('#lbimg').src = p.src1280;
  $('#lbimg').alt = p.title;
  $('#lbcap').innerHTML = `<b>${p.title}</b><br>${p.credit} · <a href="${p.licenseUrl}" target="_blank" rel="noopener">${p.license}</a> · <a href="${p.source}" target="_blank" rel="noopener">图片来源 ↗</a>`;
  $('#lightbox').classList.remove('hidden');
}
function closeLightbox() {
  $('#lightbox').classList.add('hidden');
  $('#lbimg').removeAttribute('src');
}
$('#lightbox').addEventListener('click', e => {
  if (e.target.id === 'lightbox' || e.target.closest('#lbclose')) closeLightbox();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });
document.addEventListener('click', e => {
  const a = e.target.closest('.photo-open');
  if (!a) return;
  e.preventDefault();
  openLightbox(a.dataset.key);
});

function showStarInfo(n, alt, az) {
  if (alt == null) { const a = objAltAz('named', n.k); alt = a.alt; az = a.az; }
  state.sel = { kind: 'named', key: n.k }; dirty();
  openInfo(`
    <h3>${n.zh || n.b}</h3>
    <div class="sub">${n.en ? n.en + ' · ' : ''}${n.b} · ${CON_ZH(n.c)}</div>
    <table>
      <tr><td>视星等</td><td>${n.mag}${n.vari ? '（变星，范围大）' : ''}</td></tr>
      <tr><td>距离</td><td>${n.d || '—'}</td></tr>
      <tr><td>坐标</td><td>J2000 ${fmtRa(n.ra)}, ${n.dec.toFixed(1)}°</td></tr>
      <tr><td>此刻位置</td><td>${fmtAzPt(alt, az)}</td></tr>
    </table>
    ${n.note ? `<div class="note">${n.note}</div>` : ''}
    ${locateBtn('named', n.k)}`);
}
function showMessierInfo(m, alt, az) {
  if (alt == null) { const a = objAltAz('messier', m.id); alt = a.alt; az = a.az; }
  state.sel = { kind: 'messier', key: m.id }; dirty();
  const bm = bestMonth(m.ra, m.dec, state.lat, state.lon);
  const visible = alt > 10 ? `<span class="badge" style="background:#1d3a2c;color:var(--ok)">适合观测</span>`
    : alt > 0 ? `<span class="badge" style="background:#3a341d;color:var(--gold)">贴地平线</span>`
    : `<span class="badge" style="background:#3a1d1d;color:var(--bad)">在地平线下</span>`;
  openInfo(`
    <h3>${m.id}${m.zh ? ' · ' + m.zh : ''}</h3>
    <div class="sub">${(M_TYPES[m.t] || {}).zh || ''} · ${CON_ZH(m.c)}</div>
    ${photoFigure(m.id, true)}
    <div>${visible}</div>
    <table>
      <tr><td>视星等</td><td>${m.mag == null ? '—' : m.mag}</td></tr>
      <tr><td>距离</td><td>${m.d || '—'}</td></tr>
      <tr><td>最佳观测</td><td>${bm.month}月前后（${bm.season}季，21时最高约 ${bm.alt.toFixed(0)}°）</td></tr>
      <tr><td>此刻位置</td><td>${fmtAzPt(alt, az)}</td></tr>
    </table>
    ${m.note ? `<div class="note">${m.note}</div>` : ''}
    <div class="btnrow">
      <button onclick="appLocate('messier','${m.id}')">📍 在星图中居中定位</button>
      ${alt < 5 ? `<button onclick="jumpBest('messier','${m.id}')">⏩ 跳到最佳时间</button>` : ''}
    </div>`);
}
function showPlanetInfo(p) {
  state.sel = { kind: 'planet', key: p.name }; dirty();
  openInfo(`
    <h3>${PLANET_ZH[p.name]}</h3>
    <div class="sub">行星（太阳系）</div>
    <table>
      <tr><td>此刻位置</td><td>${fmtAzPt(p.alt, p.az)}</td></tr>
      <tr><td>坐标</td><td>实时计算 ${fmtRa(p.ra)}, ${p.dec.toFixed(1)}°</td></tr>
    </table>
    <div class="note">${PLANET_NOTE[p.name]}</div>`);
}
function showMoonInfo(mo) {
  state.sel = { kind: 'planet', key: '__moon' }; dirty();
  const k = mo.illum;
  const phase = k >= 0.97 ? '满月' : k <= 0.03 ? '新月'
    : k < 0.45 ? (mo.waxing ? '蛾眉月（盈）' : '残月（亏）')
    : k < 0.55 ? (mo.waxing ? '上弦' : '下弦')
    : (mo.waxing ? '凸月（盈）' : '凸月（亏）');
  openInfo(`
    <h3>月亮</h3>
    <div class="sub">照亮比例约 ${Math.round(k * 100)}% · ${phase}${mo.waxing ? '（农历上半月）' : '（农历下半月）'}</div>
    <table>
      <tr><td>此刻位置</td><td>${fmtAzPt(mo.alt, mo.az)}</td></tr>
      <tr><td>距离</td><td>${Math.round(mo.dist).toLocaleString()} km</td></tr>
    </table>
    <div class="note">月亮位置为低精度算法（误差约1°）。观测深空天体要避开月亮，满月前后适合看行星和双星。</div>`);
}
function showSunInfo(s) {
  state.sel = { kind: 'planet', key: '__sun' }; dirty();
  openInfo(`
    <h3>太阳</h3>
    <div class="sub">恒星的代表 · 我们最近的恒星</div>
    <table><tr><td>此刻位置</td><td>${fmtAzPt(s.alt, s.az)}</td></tr></table>
    <div class="note">太阳在地平线上时，天空散射的阳光会淹没所有恒星——所以观星要在日落后约1.5小时到日出前进行。⚠️ 切勿用望远镜直视太阳。</div>`);
}
function showConInfo(des, alt, az) {
  const info = CON_INFO[des] || {};
  const named = NAMED.filter(n => n.c === des).sort((a, b) => a.mag - b.mag).slice(0, 6);
  const bm = bestMonth(info.label[0], info.label[1], state.lat, state.lon);
  openInfo(`
    <h3>${info.zh || des}</h3>
    <div class="sub">${info.name || ''} (${des}) · 88星座之一</div>
    <table>
      <tr><td>最佳观测</td><td>${bm.month}月前后（${bm.season}季星空）</td></tr>
      <tr><td>点击位置</td><td>${fmtAzPt(alt, az)}</td></tr>
    </table>
    ${named.length ? `<div class="tip">本星座中的命名亮星（按亮度）：</div>
      <table>${named.map(n => `<tr><td>${n.zh || n.b}</td><td>${n.mag} 等</td></tr>`).join('')}</table>` : ''}
    <div class="tip">提示：点击星座中的任意一颗亮星可查看详细说明。</div>`);
}

// ---------- 图例 ----------
$('#legend').innerHTML =
  `<div class="lg-hd" id="lghd">图例与操作 <svg><use href="#i-chev"/></svg></div>` +
  `<div class="lg-body">` +
  `<div><b>深空天体：</b>` +
  Object.entries(M_TYPES).map(([k, v]) => `<i style="background:${v.color}"></i>${v.zh}`).join('') + `</div>` +
  `<div><b>恒星：</b>蓝白 → 黄 → 橙红（表面温度由高到低）　<i style="background:#ffe9b0"></i>行星　<i style="background:#f4f0e6"></i>月亮</div>` +
  `<div class="hintline">拖动＝平移天空（左右转方位、上下抬降视角，地平线始终水平）· 滚轮以光标为中心缩放 · 双击复位朝南 · 单击天体看详情 · 单击空白处识别所在星座</div>` +
  `</div>`;
$('#lghd').onclick = () => $('#legend').classList.toggle('collapsed');

// ---------- 图鉴 ----------
let atlasCat = 'stars', atlasSel = null, searchText = '';
$$('.subtabs button').forEach(b => b.onclick = () => {
  $$('.subtabs button').forEach(x => x.classList.toggle('on', x === b));
  atlasCat = b.dataset.cat; atlasSel = null; searchText = ''; renderAtlas();
});
$('#atlas-list').addEventListener('input', e => { if (e.target.classList.contains('search')) { searchText = e.target.value.trim(); renderAtlasList(); } });
$('#atlas-list').addEventListener('click', e => {
  const row = e.target.closest('.row'); if (!row) return;
  atlasSel = { cat: row.dataset.cat, key: row.dataset.key };
  renderAtlasList(); renderAtlasDetail();
});
function conSeasonSort(des) { const i = CON_INFO[des] ? CON_INFO[des].label[0] : 0; return i; }
function renderAtlas() {
  $('#atlas-list').innerHTML = `<input class="search" placeholder="搜索…（中文名 / 英文名 / 编号）">
    <div class="atlas-count" id="atlas-count"></div><div id="rows"></div>`;
  renderAtlasList();
  $('#atlas-detail').innerHTML = `<div class="empty">从左侧选择一个天体，查看它的资料与最佳观测时间</div>`;
}
function renderAtlasList() {
  const rows = $('#rows'); if (!rows) return;
  const s = searchText.toLowerCase();
  let items = [];
  if (atlasCat === 'stars') {
    items = NAMED.filter(n => !s || [n.zh, n.en, n.b, CON_ZH(n.c)].join(' ').toLowerCase().includes(s))
      .sort((a, b) => a.mag - b.mag)
      .map(n => ({ key: n.k, cat: 'stars', r1: n.zh || n.b, r2: `${n.b} · ${CON_ZH(n.c)}`, rm: n.mag + '等' }));
  } else if (atlasCat === 'cons') {
    items = Object.keys(CON_INFO).filter(d => !s || [CON_INFO[d].zh, CON_INFO[d].name, d].join(' ').toLowerCase().includes(s))
      .sort((a, b) => conSeasonSort(a) - conSeasonSort(b))
      .map(d => ({ key: d, cat: 'cons', r1: CON_INFO[d].zh, r2: CON_INFO[d].name, rm: '' }));
  } else {
    items = DEEPSKY.filter(m => !s || [m.id, m.zh, CON_ZH(m.c), (M_TYPES[m.t] || {}).zh].join(' ').toLowerCase().includes(s))
      .map(m => ({ key: m.id, cat: 'messier', r1: m.id + (m.zh ? ' ' + m.zh : ''), r2: `${(M_TYPES[m.t] || {}).zh || ''} · ${CON_ZH(m.c)}`, rm: m.mag == null ? '' : m.mag + '等' }));
  }
  const lbl = { stars: '亮星', cons: '星座', messier: '深空天体' }[atlasCat] || '';
  const cnt = $('#atlas-count');
  if (cnt) cnt.textContent = searchText ? `${lbl} · 匹配 ${items.length} 条` : `${lbl} · 共 ${items.length} 条`;
  rows.innerHTML = items.map(it =>
    `<div class="row ${atlasSel && atlasSel.key === it.key ? 'sel' : ''}" data-key="${it.key}" data-cat="${it.cat}">
      <span class="r1">${it.r1}</span><span class="r2">${it.r2}</span><span class="rm">${it.rm}</span></div>`).join('')
    || '<div class="empty">没有匹配的结果</div>';
}
function renderAtlasDetail() {
  const el = $('#atlas-detail');
  if (!atlasSel) { el.innerHTML = '<div class="empty">← 从左侧选择一个天体查看详情</div>'; return; }
  if (atlasSel.cat === 'stars') {
    const n = NAMED.find(n => n.k === atlasSel.key); if (!n) return;
    el.innerHTML = `
      <h3>${n.zh || n.b}</h3><div class="sub">${n.en ? n.en + ' · ' : ''}${n.b} · ${CON_ZH(n.c)}</div>
      <table>
        <tr><td>视星等</td><td>${n.mag}${n.vari ? '（变星）' : ''}</td></tr>
        <tr><td>距离</td><td>${n.d || '—'}</td></tr>
        <tr><td>坐标</td><td>J2000 ${fmtRa(n.ra)}, ${n.dec.toFixed(1)}°</td></tr>
      </table>
      ${n.note ? `<div class="note">${n.note}</div>` : ''}
      <div class="btnrow"><button onclick="appLocate('named','${n.k}')">📍 在星图中居中定位</button></div>`;
  } else if (atlasSel.cat === 'cons') {
    const des = atlasSel.key, info = CON_INFO[des];
    const named = NAMED.filter(n => n.c === des).sort((a, b) => a.mag - b.mag);
    const bm = bestMonth(info.label[0], info.label[1], state.lat, state.lon);
    el.innerHTML = `
      <h3>${info.zh}</h3><div class="sub">${info.name} (${des})</div>
      <canvas id="concanvas" width="420" height="300"></canvas>
      <table>
        <tr><td>最佳观测</td><td>${bm.month}月前后（${bm.season}季星空，21时仰角最高约 ${bm.alt.toFixed(0)}°）</td></tr>
        <tr><td>命名亮星</td><td>${named.length ? named.slice(0, 8).map(n => n.zh || n.b).join('、') : '—'}</td></tr>
      </table>
      <div class="btnrow"><button onclick="appLocate('__con','${des}')">📍 在星图中居中显示</button></div>
      <div class="note">在星图中打开「连线」后可看到它的完整图形（含暗星）。</div>`;
    const cv = $('#concanvas');
    if (cv) {   // 按显示尺寸×DPI 建画布，避免高 DPI 下发虚、右侧标签被 420px 画布裁掉
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = Math.max(240, Math.min(430, el.clientWidth - 48));
      const ch = Math.round(cw * 0.714);
      cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
      cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
      cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
      drawConFigure(des, cv);
    }
  } else {
    const m = DEEPSKY.find(m => m.id === atlasSel.key); if (!m) return;
    const bm = bestMonth(m.ra, m.dec, state.lat, state.lon);
    el.innerHTML = `
      <h3>${m.id}${m.zh ? ' · ' + m.zh : ''}</h3>
      <div class="sub">${(M_TYPES[m.t] || {}).zh || ''} · ${CON_ZH(m.c)}</div>
      ${photoFigure(m.id)}
      <table>
        <tr><td>视星等</td><td>${m.mag == null ? '—' : m.mag}</td></tr>
        <tr><td>距离</td><td>${m.d || '—'}</td></tr>
        <tr><td>坐标</td><td>J2000 ${m.ra == null ? '—' : fmtRa(m.ra) + ', ' + m.dec.toFixed(1) + '°'}</td></tr>
        <tr><td>最佳观测</td><td>${bm.month}月前后（${bm.season}季，21时最高约 ${bm.alt.toFixed(0)}°）</td></tr>
      </table>
      ${m.note ? `<div class="note">${m.note}</div>` : ''}
      <div class="btnrow"><button onclick="appLocate('messier','${m.id}')">📍 在星图中居中定位</button></div>`;
  }
}
// 星座小图：以连线图形质心为中心的方位等距投影。
// 直接用 RA/Dec 线性映射在跨 0h（仙女座、飞马座）和近天极（小熊座）时会把图形拉断、拉歪，
// 这里把每个点投到以质心为球心的切平面上，用「角距」当半径——形状和角距都对得上，也不会改到源数据。
function drawConFigure(des, cv) {
  const segs = (CON_LINES[des] || []).map(seg => seg.map(([r, d]) => [r, d]));   // 深拷贝，绝不改 CON_LINES
  const pts = segs.flat();
  if (!pts.length) return;
  const c2 = cv.getContext('2d');
  const W = cv.clientWidth || cv.width, H = cv.clientHeight || cv.height;
  c2.clearRect(0, 0, W, H);
  const V = (ra, dec) => {
    const a = ra * 15 * D2R, d = dec * D2R;
    return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  };
  const sum = [0, 0, 0];
  for (const [ra, dec] of pts) { const v = V(ra, dec); sum[0] += v[0]; sum[1] += v[1]; sum[2] += v[2]; }
  const sn = Math.hypot(sum[0], sum[1], sum[2]);
  const ctr = sn > 1e-9 ? sum.map(v => v / sn) : [1, 0, 0];
  const raC = Math.atan2(ctr[1], ctr[0]);
  const west = [Math.sin(raC), -Math.cos(raC), 0];   // 屏幕右＝西：赤经增大朝左（仰望星空的习惯）
  let up = [
    west[1] * ctr[2] - west[2] * ctr[1],
    west[2] * ctr[0] - west[0] * ctr[2],
    west[0] * ctr[1] - west[1] * ctr[0],
  ];
  const un = Math.hypot(up[0], up[1], up[2]);
  up = un > 1e-9 ? up.map(v => v / un) : [0, 0, 1];
  const proj = ([ra, dec]) => {
    const v = V(ra, dec);
    const th = Math.acos(clamp(v[0] * ctr[0] + v[1] * ctr[1] + v[2] * ctr[2], -1, 1));
    const x = v[0] * west[0] + v[1] * west[1] + v[2] * west[2];
    const y = v[0] * up[0] + v[1] * up[1] + v[2] * up[2];
    const l = Math.hypot(x, y);
    return l < 1e-9 ? [0, 0] : [x / l * th, y / l * th];
  };
  const P = pts.map(proj);
  let minX = 9, maxX = -9, minY = 9, maxY = -9;
  for (const [x, y] of P) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const padX = (maxX - minX) * 0.08 + 0.02, padY = (maxY - minY) * 0.08 + 0.02;
  const sc = Math.min(W / (maxX - minX + padX * 2), H / (maxY - minY + padY * 2));
  const mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
  const XY = p => { const [x, y] = proj(p); return [W / 2 + (x - mx) * sc, H / 2 - (y - my) * sc]; };
  c2.strokeStyle = 'rgba(110,150,255,0.7)'; c2.lineWidth = 1.4;
  for (const seg of segs) {
    c2.beginPath();
    seg.forEach((p, i) => { const [x, y] = XY(p); i ? c2.lineTo(x, y) : c2.moveTo(x, y); });
    c2.stroke();
  }
  c2.fillStyle = '#fff';
  for (const p of pts) { const [x, y] = XY(p); c2.beginPath(); c2.arc(x, y, 2.4, 0, Math.PI * 2); c2.fill(); }
  c2.fillStyle = '#eef1ff'; c2.font = '12px system-ui'; c2.textAlign = 'left';
  for (const n of NAMED.filter(n => n.c === des)) {
    const [x, y] = XY([n.ra, n.dec]);
    const t = n.zh || n.b, tw = c2.measureText(t).width;
    let lx = x + 5, ly = y - 4;
    if (lx + tw > W - 2) lx = x - 5 - tw;
    if (ly < 11) ly = y + 14;
    if (lx < 2 || ly > H - 2) continue;
    c2.fillText(t, lx, ly);
  }
}
// ---------- 测验 ----------
const quizCanvas = $('#quizsky'), qctx = quizCanvas.getContext('2d');
const quiz = { mode: 'star', cur: null, score: { n: 0, c: 0 }, streak: 0, locked: false };
const QSTATS_KEY = 'shixing-quiz-v1';
function loadStats() { try { return JSON.parse(localStorage.getItem(QSTATS_KEY)) || {}; } catch { return {}; } }
function saveStats(s) { try { localStorage.setItem(QSTATS_KEY, JSON.stringify(s)); } catch {} }
function renderStats() {
  const st = loadStats()[quiz.mode] || { n: 0, c: 0, best: 0 };
  const acc = st.n ? Math.round(st.c / st.n * 100) : 0;
  $('#quiz-stats').innerHTML =
    `<span class="stat">已答 <b>${st.n}</b></span>` +
    `<span class="stat acc">正确率 <b>${acc}%</b></span>` +
    `<span class="stat hot">本轮连对 <b>${quiz.streak}</b></span>` +
    `<span class="stat">最高连对 <b>${st.best || 0}</b></span>`;
}
$$('.quiz-modes button').forEach(b => b.onclick = () => {
  $$('.quiz-modes button').forEach(x => x.classList.toggle('on', x === b));
  quiz.mode = b.dataset.mode; quiz.streak = 0; renderStats(); nextQuestion();
});
function sizeQuizCanvas() {
  const w = quizCanvas.clientWidth || 500, dpr = window.devicePixelRatio || 1;
  quizCanvas.width = w * dpr; quizCanvas.height = w * dpr;
  qctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (quiz.cur) redrawQuiz();
}
function redrawQuiz() {
  const w = quizCanvas.clientWidth || 500, h = w;
  qctx.clearRect(0, 0, w, h);
  if (quiz.mode === 'con' && quiz.cur && quiz.cur.correct) { drawConFigure(quiz.cur.correct, quizCanvas); return; }
  quizScene = computeScene(quizState(), w, h);
  renderScene(qctx, quizScene, { ...state, opts: quizState().opts, sel: null, highlight: null }, w, h);
}
function quizState() {
  // 测验图固定「天顶全景」（zoom 1 + 视角在天顶 → 整个地平线上方的天空都在圆内）、正立（无 roll）
  return { simMs: state.simMs, lat: state.lat, lon: state.lon, zoom: 1,
    viewAlt: VIEW_ALT_MAX, viewAz: 180,
    opts: { lines: quiz.mode === 'star', names: true, starNames: false, messier: false, messierLabels: false, planets: quiz.mode === 'star', planetNames: false, grid: false, ast: false } };
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }
// 仅取最佳观测月份（bestMonth 已按北京时间 21:00 计算）
function bmMonth(m) { return bestMonth(m.ra, m.dec, state.lat, state.lon).month; }
// 测验用的星座集合：北半球（中低纬）肉眼可见、形态可辨认的常见星座。
// 南天-only（南十字、南极座这类在北半球常年看不到的）不进题库，选项也不出。
const QUIZ_CONS = Object.keys(CON_LINES).filter(d => {
  const info = CON_INFO[d];
  if (!info) return false;
  const dec = info.label[1];
  // 图形质心赤纬 > -45°（可延伸到南半球低空），保证在北纬 30–40° 有机会升到 8° 以上
  return dec > -45;
});
function nextQuestion() {
  quiz.locked = false; quiz.answered = null;
  $('#quiz-feedback').innerHTML = '';
  $('#quiz-next').classList.add('hidden');
  if (quiz.mode === 'star') {
    // 只出当前地平线上方 8° 以上的亮星（否则图上根本没有它）
    const pos = ensurePositions(state);
    const pool = NAMED.filter(n => n.zh && n.mag <= 2.2 && toAltAz(n.ra, n.dec, pos.lst, state.lat).alt > 8);
    const pick = pool.length ? pool : NAMED.filter(n => n.zh && n.mag <= 2.2);
    quiz.cur = { target: pick[Math.floor(Math.random() * pick.length)] };
    const t = quiz.cur.target;
    $('#quiz-question').innerHTML = `在左侧星图上点击 <b>【${t.zh}】</b>（${t.b}）`;
    $('#quiz-options').innerHTML =
      `<div class="quiz-hint">
        <div class="qh-row"><span>星等</span><b>${t.mag}</b></div>
        <div class="qh-row"><span>所在星座</span><b>${CON_ZH(t.c)}</b></div>
        ${t.d ? `<div class="qh-row"><span>距离</span><b>${t.d}</b></div>` : ''}
        ${t.note ? `<div class="qh-note">${t.note}</div>` : ''}
        <div class="qh-tip">在左侧星图上找到它并点击（星图画出完整星空，候选星都亮于 2.2 等，可按亮度与星座形状推断）</div>
      </div>`;
    quizCanvas.style.display = '';
    $('#quizphoto').classList.add('hidden');
    redrawQuiz();
  } else if (quiz.mode === 'con') {
    const desigs = QUIZ_CONS;
    const correct = desigs[Math.floor(Math.random() * desigs.length)];
    const opts = shuffle([correct, ...shuffle(desigs.filter(d => d !== correct)).slice(0, 3)]);
    quiz.cur = { correct, opts };
    $('#quiz-question').innerHTML = `这是哪个星座的图形？`;
    quizCanvas.style.display = '';
    $('#quizphoto').classList.add('hidden');
    drawConFigure(correct, quizCanvas);
    $('#quiz-options').innerHTML = opts.map(o => `<button data-k="${o}">${CON_INFO[o].zh}</button>`).join('');
    $('#quiz-options').onclick = e => answerCon(e);
  } else {
    // 看图认深空：只考有官方配图的 45 个天体，照片就是题面；
    // 提示只保留月份（类型/星座会直接把答案漏给认识图的人）。
    const pool = (typeof PHOTOS !== 'undefined' ? Object.keys(PHOTOS) : [])
      .map(k => DEEPSKY.find(m => m.id === k)).filter(m => m && m.ra != null);
    const correct = pool[Math.floor(Math.random() * pool.length)];
    const sameType = pool.filter(m => m.t === correct.t && m.id !== correct.id);
    const others = pool.filter(m => m.t !== correct.t);
    const distract = shuffle(sameType).slice(0, 3);
    while (distract.length < 3 && others.length) distract.push(others.splice(Math.floor(Math.random() * others.length), 1)[0]);
    const opts = shuffle([correct, ...distract]);
    quiz.cur = { correct, opts };
    const p = PHOTOS[correct.id];
    const img = $('#quizphoto');
    quizCanvas.style.display = 'none';
    img.classList.remove('hidden');
    img.src = p.src1280;
    img.alt = '深空天体照片（答对后显示名称）';
    $('#quiz-question').innerHTML = `看图认天体，它是哪一个？（提示：最佳观测 ${bmMonth(correct)}月）`;
    $('#quiz-options').innerHTML = opts.map(o => `<button data-k="${o.id}">${o.id}</button>`).join('');
    $('#quiz-options').onclick = e => answerMessier(e);
  }
  renderStats();
}
$('#quizsky').addEventListener('click', e => {
  if (quiz.mode !== 'star' || quiz.locked || !quizScene) return;
  const r = quizCanvas.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const t = quiz.cur.target;
  const tn = quizScene.named.find(n => n.ref.k === t.k);
  if (!tn || tn.alt < -2) { nextQuestion(); return; }
  const d = Math.hypot(mx - tn.x, my - tn.y);
  const ok = d <= 16;
  quiz.locked = true;
  recordAnswer(ok);
  const fb = $('#quiz-feedback');
  fb.innerHTML = `<div style="color:${ok ? 'var(--ok)' : 'var(--bad)'};font-weight:bold">${ok ? '✔ 答对了！' : `✘ 差了约 ${Math.round(angularSep(mx, my, tn.x, tn.y))}°`}</div>
    <div class="note"><b>${t.zh}</b>（${t.b}，${t.mag}等，${t.d || ''}）${t.note ? '<br>' + t.note : ''}</div>`;
  // 在图上标注
  qctx.save();
  qctx.strokeStyle = ok ? '#5ddba0' : '#ff7a7a'; qctx.lineWidth = 2.2;
  qctx.beginPath(); qctx.arc(tn.x, tn.y, 16, 0, Math.PI * 2); qctx.stroke();
  if (!ok) {
    qctx.strokeStyle = '#ff7a7a';
    qctx.beginPath(); qctx.moveTo(mx - 8, my - 8); qctx.lineTo(mx + 8, my + 8); qctx.moveTo(mx + 8, my - 8); qctx.lineTo(mx - 8, my + 8); qctx.stroke();
  }
  qctx.fillStyle = ok ? '#5ddba0' : '#ff7a7a'; qctx.font = 'bold 14px system-ui';
  qctx.fillText(t.zh, tn.x + 18, tn.y - 10);
  qctx.restore();
  $('#quiz-next').classList.remove('hidden');
});
function angularSep(mx, my, x, y) {
  // 屏幕距离 → 角距（球极投影反解）
  return 2 * Math.atan(Math.hypot(mx - x, my - y) / Math.max(quizScene.Rp, 1)) * R2D;
}
function answerCon(e) {
  if (quiz.locked) return;
  const b = e.target.closest('button'); if (!b) return;
  quiz.locked = true;
  const ok = b.dataset.k === quiz.cur.correct;
  recordAnswer(ok);
  $$('#quiz-options button').forEach(x => {
    if (x.dataset.k === quiz.cur.correct) x.classList.add('ok');
    else if (x === b) x.classList.add('bad');
    else x.disabled = true;
  });
  const des = quiz.cur.correct;
  const named = NAMED.filter(n => n.c === des).sort((a, b) => a.mag - b.mag).slice(0, 3);
  $('#quiz-feedback').innerHTML = `<div style="color:${ok ? 'var(--ok)' : 'var(--bad)'};font-weight:bold">${ok ? '✔ 答对了！' : '✘ 是 ' + CON_INFO[des].zh}</div>
    <div class="note"><b>${CON_INFO[des].zh}</b>（${CON_INFO[des].name}）${named.length ? ' · 标志亮星：' + named.map(n => n.zh || n.b).join('、') : ''}</div>`;
  $('#quiz-next').classList.remove('hidden');
}
function answerMessier(e) {
  if (quiz.locked) return;
  const b = e.target.closest('button'); if (!b) return;
  quiz.locked = true;
  const ok = b.dataset.k === quiz.cur.correct.id;
  recordAnswer(ok);
  $$('#quiz-options button').forEach(x => {
    if (x.dataset.k === quiz.cur.correct.id) x.classList.add('ok');
    else if (x === b) x.classList.add('bad');
    else x.disabled = true;
  });
  const m = quiz.cur.correct;
  // 照片已在题面显示，反馈只给结论与说明；照片可点开大图（此刻不再泄题）
  const img = $('#quizphoto');
  img.alt = PHOTOS[m.id] ? PHOTOS[m.id].title : '';
  $('#quiz-feedback').innerHTML =
    `<div style="color:${ok ? 'var(--ok)' : 'var(--bad)'};font-weight:bold">${ok ? '✔ 答对了！' : '✘ 正确答案是 ' + m.id}</div>
    <div class="note"><b>${m.id}${m.zh ? ' · ' + m.zh : ''}</b>（${(M_TYPES[m.t] || {}).zh} · ${CON_ZH(m.c)} · ${m.mag == null ? '?' : m.mag}等 · ${m.d || ''}）${m.note ? '<br>' + m.note : ''}</div>`;
  $('#quiz-next').classList.remove('hidden');
}
function recordAnswer(ok) {
  quiz.score.n++; if (ok) { quiz.score.c++; quiz.streak++; } else quiz.streak = 0;
  const all = loadStats();
  const s = all[quiz.mode] || { n: 0, c: 0, best: 0 };
  s.n++; if (ok) s.c++; s.best = Math.max(s.best, quiz.streak);
  all[quiz.mode] = s; saveStats(all);
  renderStats();
}
$('#quiz-next').onclick = nextQuestion;

// ---------- 关于 ----------
$('#aboutcontent').innerHTML = `
<div class="hero">
  <h2>识星 · 星空学习台</h2>
  <p>一个完全离线的认星工具：交互星图 + 88 星座 + 110 个梅西耶 + 15 个著名 NGC 天体 + 行星月亮，配图鉴、45 张官方配图与三种测验模式。</p>
  <div class="chips">
    <span>5044 颗肉眼可见恒星</span><span>88 星座连线与边界</span><span>110 梅西耶 + 15 NGC</span>
    <span>45 张官方配图</span><span>五行星 + 月亮</span><span>零依赖 · 离线可用</span><span>构建 ${BUILD_VER}</span>
  </div>
</div>
<p class="tip">上面最后一枚标签是<b>当前构建版本</b>。若你刚改过代码/数据却发现行为没变，多半是浏览器还在用缓存：按 <b>Ctrl+F5</b>（或 Ctrl+Shift+R）强制刷新，版本号会随即变化——以此确认自己跑的是哪一版。</p>
<h3>快速上手</h3>
<table>
  <tr><th>想做什么</th><th>怎么做</th></tr>
  <tr><td>看今晚的星空</td><td>选好城市，保持「实时」勾选。初始为<b>朝南平视</b>（视角高 38°、放大 3×，视场约 74°），地平线压在画面下缘——与站在户外抬头所见一致。</td></tr>
  <tr><td>转动视角看别处</td><td>按住拖动＝平移天空：<b>左右拖</b>＝转方位（东西方向转过去），<b>上下拖</b>＝抬高/降低视角。视角高度角到 +89.6°（天顶）或 −80° 就<b>彻底停住</b>，绝不会翻到天顶另一侧；地平线始终保持水平，不会出现画面倾斜或上下颠倒。近天顶时左右拖动会让星空绕天顶旋转（这就是"抬头转圈"的感觉）。双击星图（或点右下角 ⌂ 按钮）立刻复位成正立朝南。</td></tr>
  <tr><td>放大看细节</td><td>滚轮缩放 1×–8×，以<b>光标位置</b>为锚点固定不动（不是以屏幕中心缩放）；触屏双指捏合缩放（中点锚定）；也可用星图右下角的 ＋ / －，点 ⌂ 复位。</td></tr>
  <tr><td>找一颗星/深空天体</td><td>在「图鉴」里搜索，点「📍 在星图中居中定位」——星图会自动把目标转到正中并放大，若此刻不可见会自动跳到最佳观测时间。</td></tr>
  <tr><td>看真实照片</td><td>「图鉴」→「深空天体」，选中梅西耶或 NGC 对象；详情页顶部是官方大图，点图片可全屏查看，图下有 credit 和原图来源。</td></tr>
  <tr><td>模拟某晚的星空</td><td>取消「实时」，设定日期时间；或按播放键让时间流动（×600 常用，可看星星东升西落）。</td></tr>
  <tr><td>自测认星</td><td>「测验」→ 认亮星：按提示在左侧大星图上点击目标星；认星座（北半球可见的 63 个）与「看图认深空」（45 个有官方配图的对象）是四选一。</td></tr>
</table>
<h3>认星学习路线</h3>
<div class="note">
① 先认<b>北斗七星</b>（大熊座）→ 勺口两星连线延长5倍找到<b>北极星</b>，确定方位。<br>
② 四季三角形/六边形：「四季图形」开关可叠加显示——夏季大三角、冬季六边形、春季大三角。<br>
③ 按季节认几个标志星座：春·狮子座 / 夏·天蝎座+人马座（茶壶）/ 秋·飞马四边形+仙女座 / 冬·猎户座。<br>
④ 顺星座认梅西耶：猎户腰带下→M42；昴星团→M45；仙女座ν星旁→M31；武仙座「石键」→M13。<br>
⑤ 测验模式刷「认亮星」，把 2 等以上亮星全部记住，你就超过绝大多数人了。
</div>
<h3>数据与精度说明</h3>
<table>
  <tr><td>恒星</td><td>5044颗肉眼可见恒星（至6.5等），J2000 坐标，数据源 d3-celestial（源自 HYG/鲲鹏星表）。</td></tr>
  <tr><td>星座</td><td>IAU 88星座连线与边界（d3-celestial），中文名已核对为简体。</td></tr>
  <tr><td>深空天体</td><td>110 个梅西耶 + 15 个著名 NGC/IC，坐标/星等与 dsos.14 星表交叉校准（星表缺失的条目用手工坐标并标注）。</td></tr>
  <tr><td>配图</td><td>45 张来自 ESA/Hubble 与 NOIRLab 官方图库，均按 CC BY 4.0 使用；图下保留原始 credit，完整清单见 <a href="assets/photos/CREDITS.md" target="_blank">CREDITS.md</a>。</td></tr>
  <tr><td>行星</td><td>JPL 近似轨道根数（适用 1800–2050 年），位置误差通常小于 1°，足够肉眼认星。</td></tr>
  <tr><td>月亮</td><td>低精度算法，误差约1°；月相按照亮比例以半椭圆明暗界线绘制。</td></tr>
  <tr><td>时间</td><td>按北京时间（UTC+8）处理；恒星时采用平恒星时公式，未做章动/光行差修正（影响&lt;0.5°）。</td></tr>
  <tr><td>星图</td><td>球极投影（保角），默认朝南平视、竖直视场约 74°；拖动为方位-高度模型（左右转方位、上下抬降视角，地平线始终水平，不会翻到天顶另一侧），缩放 1×–8×。</td></tr>
</table>
<h3>图片与署名</h3>
<div class="note">
45 张配图来自 ESA/Hubble 与 NOIRLab 官方图库，均按 <b>CC BY 4.0</b> 使用。页面内每张图都保留原始 credit，点击「原图 ↗」可回到官方页面；完整清单（对象、标题、credit、许可、原图地址）见
<a href="assets/photos/CREDITS.md" target="_blank">assets/photos/CREDITS.md</a>。图片仅作学习与展示用途，不代表 NASA/ESA/NOIRLab 对本工具的认可。
</div>
<p class="tip">本工具用于学习，坐标精度不代表专业观测水准；实际目视时注意留 20 分钟让眼睛适应黑暗。若界面数据与真实星空有出入，以 Stellarium 等专业软件为准。</p>`;

// ---------- 启动 ----------
sizeCanvas();
renderAtlas();
nextQuestion();
renderStats();
requestAnimationFrame(tick);
