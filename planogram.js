// ═══════════════════════════════════════════════════════════════════
//  РМК · ПЛАНОГРАММА МАГАЗИНА
//  Торговый зал — 3D + 2D, склад — 2D. Шкафы → полки → места → товар.
//  Остатки и продажи — живые из РМК (stock_units), цвет места = статус остатка.
//  Хранение: backend ?action=planogram-get / planogram-save (app_state planogram:<wh>).
// ═══════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const API = 'https://1c-sync-barcodes.vercel.app/api/pos';
const SECRET = 'TySog2bN1bMJHsssoTvyCZO3IKOef1z0';
const LS_AUTH = 'orto_admin_rmk_auth';

// Магазины. Сейчас работаем по Айни; остальные подключаются добавлением строки.
const STORES = [
  { wh: '5ca2d3e6-29c1-4d1a-aeee-832fa513e2e2', name: 'Ортосалон «Айни»', active: true },
  { wh: '19db06fa-deb5-47db-acd7-486c5bc679d0', name: 'Ортосалон «Сиёма»', active: false },
  { wh: 'f9a506e7-c706-439e-aad3-dbfa9104fed2', name: 'Ортосалон «Баракат»', active: false },
  { wh: '8f0bf6e3-1ffc-4267-8f4b-1e79179dd2a7', name: 'Ортосалон «Сити-Молл»', active: false },
];

const TYPES = {
  wall:    { label: 'Настенный стеллаж', shelves: true,  w: 2.4, d: 0.4, h: 2.4, n: 6, m: 6, color: '#f8fafc', zone: 'hall' },
  island:  { label: 'Островная витрина', shelves: true,  w: 1.4, d: 0.8, h: 1.3, n: 3, m: 4, color: '#ffffff', zone: 'hall' },
  table:   { label: 'Стол-подиум',       shelves: true,  w: 1.2, d: 0.7, h: 0.75, n: 1, m: 4, color: '#f5f0e8', zone: 'hall' },
  rack:    { label: 'Стеллаж склада',    shelves: true,  w: 2.0, d: 0.5, h: 2.2, n: 5, m: 8, color: '#e2e8f0', zone: 'stock' },
  cash:    { label: 'Касса',             shelves: false, w: 1.8, d: 0.7, h: 1.0, color: '#ffffff' },
  bench:   { label: 'Пуф / скамья',      shelves: false, w: 1.4, d: 0.45, h: 0.45, color: '#94a3b8' },
  fitting: { label: 'Примерочная',       shelves: false, w: 1.2, d: 1.2, h: 2.2, color: '#e0e7ff' },
  mirror:  { label: 'Зеркало',           shelves: false, w: 0.6, d: 0.08, h: 1.8, color: '#dbeafe' },
  plant:   { label: 'Растение',          shelves: false, w: 0.5, d: 0.5, h: 1.3, color: '#16a34a' },
};
const ST_COLOR = { ok: '#16a34a', low: '#f59e0b', out: '#dc2626', slow: '#64748b', empty: '#cbd5e1' };
const ST_LABEL = { ok: 'Хорошо', low: 'Мало остатков', out: 'Нет в магазине', slow: 'Нет продаж 30 дн.', empty: 'Пустое место' };
const CATS = ['Женская обувь', 'Мужская обувь', 'Детская обувь', 'Обувь для мальчиков', 'Обувь для девочек', 'Ортопедические стельки', 'Ортопедические товары', 'Аксессуары', 'Акция / скидки'];

// ─────────── helpers ───────────
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const fmt = (n) => (Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const uid = (p) => (p || 'x') + Math.random().toString(36).slice(2, 9);
const clone = (o) => JSON.parse(JSON.stringify(o));
async function api(path, opts) {
  const res = await fetch(API + path, { ...(opts || {}), headers: { 'Content-Type': 'application/json', 'X-Provision-Secret': SECRET } });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.ok === false) throw new Error(d.error || `HTTP ${res.status}`);
  return d;
}
let toastT = null;
function toast(msg, err) {
  const t = $('pgToast'); t.textContent = msg; t.className = 'pg-toast show' + (err ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'pg-toast'; }, 2600);
}

// ─────────── auth (тот же вход, что в РМК Администратор) ───────────
let USER = '';
try { const a = JSON.parse(localStorage.getItem(LS_AUTH) || 'null'); USER = a && a.user || ''; } catch (_) {}
if (!USER) { location.href = 'admin-rmk.html'; }

// ─────────── state ───────────
const S = {
  wh: STORES[0].wh, layout: null, version: null, dirty: false,
  zone: 'hall', view: '3d', edit: false, shapeEdit: false,
  sel: null,            // {k:'fx',fid} | {k:'slot',fid,si,ki}
  products: new Map(),  // productId -> {id,name,here,sizes,sold30,sold7,photo,category,price}
  detail: {},           // productId -> warehouses[]
};

// ─────────── default layout (Айни, по эскизу) ───────────
function mkShelves(n, m) { return Array.from({ length: n }, () => ({ slots: Array.from({ length: m }, () => ({ p: null, q: 1 })) })); }
function mkFx(type, o) {
  const t = TYPES[type];
  const fx = { id: uid('f'), zone: o.zone || t.zone || 'hall', type, name: o.name || t.label, category: o.category || '', x: o.x, y: o.y, w: o.w || t.w, d: o.d || t.d, h: o.h || t.h, rot: o.rot || 0 };
  if (t.shelves) fx.shelves = mkShelves(o.n || t.n, o.m || t.m);
  return fx;
}
function defaultLayout() {
  return {
    zones: {
      hall: { name: 'Торговый зал', polygon: [[0, 0], [12, 0], [12, 7.5], [0, 7.5]], wallH: 3.0, door: { edge: 2, t: 0.5, w: 1.8 } },
      stock: { name: 'Склад', polygon: [[0, 0], [5, 0], [5, 3.5], [0, 3.5]], door: { edge: 2, t: 0.8, w: 0.9 } },
    },
    fixtures: [
      mkFx('wall', { name: 'Секция A-1', category: 'Женская обувь', x: 0.22, y: 1.9, w: 2.8, rot: 270 }),
      mkFx('wall', { name: 'Секция A-2', category: 'Женская обувь', x: 0.22, y: 4.9, w: 2.8, rot: 270 }),
      mkFx('wall', { name: 'Секция B-1', category: 'Детская обувь', x: 3.4, y: 0.22, w: 2.6, rot: 0 }),
      mkFx('wall', { name: 'Секция B-2', category: 'Детская обувь', x: 6.3, y: 0.22, w: 2.6, rot: 0 }),
      mkFx('wall', { name: 'Секция D-1', category: 'Ортопедические стельки', x: 9.6, y: 0.22, w: 2.2, n: 5, m: 5, rot: 0 }),
      mkFx('wall', { name: 'Секция C-1', category: 'Мужская обувь', x: 11.78, y: 2.0, w: 2.8, rot: 90 }),
      mkFx('wall', { name: 'Секция C-2', category: 'Мужская обувь', x: 11.78, y: 5.0, w: 2.8, rot: 90 }),
      mkFx('island', { name: 'Остров I-1', category: 'Ортопедические товары', x: 4.4, y: 3.6 }),
      mkFx('island', { name: 'Остров I-2', category: 'Акция / скидки', x: 7.6, y: 3.6 }),
      mkFx('cash', { name: 'Касса', x: 2.2, y: 6.6, rot: 180 }),
      mkFx('bench', { name: 'Пуф', x: 6.0, y: 5.4 }),
      mkFx('bench', { name: 'Пуф', x: 9.8, y: 2.6, rot: 90 }),
      mkFx('mirror', { name: 'Зеркало', x: 11.9, y: 6.8, rot: 90 }),
      mkFx('plant', { name: 'Растение', x: 0.5, y: 7.0 }),
      mkFx('plant', { name: 'Растение', x: 11.4, y: 0.5 }),
      mkFx('rack', { zone: 'stock', name: 'Стеллаж S-1', x: 1.2, y: 0.3, rot: 0 }),
      mkFx('rack', { zone: 'stock', name: 'Стеллаж S-2', x: 3.6, y: 0.3, rot: 0 }),
      mkFx('rack', { zone: 'stock', name: 'Стеллаж S-3', x: 4.72, y: 2.1, w: 2.4, rot: 90 }),
    ],
  };
}

// ─────────── статусы и агрегаты ───────────
function slotStatus(slot) {
  if (!slot || !slot.p) return 'empty';
  const p = S.products.get(slot.p);
  if (!p || !p.here) return 'out';
  if (p.here <= 2) return 'low';
  if (!p.sold30) return 'slow';
  return 'ok';
}
function zoneFx(zone) { return S.layout.fixtures.filter(f => f.zone === zone); }
function fxById(id) { return S.layout.fixtures.find(f => f.id === id); }
function fxStats(fx) {
  const ids = new Set(); let empty = 0, low = 0, out = 0, slots = 0;
  (fx.shelves || []).forEach(sh => sh.slots.forEach(sl => {
    slots++; const st = slotStatus(sl);
    if (st === 'empty') empty++; else ids.add(sl.p);
    if (st === 'low') low++; if (st === 'out') out++;
  }));
  let pairs = 0, sold30 = 0;
  ids.forEach(id => { const p = S.products.get(id); if (p) { pairs += p.here || 0; sold30 += p.sold30 || 0; } });
  return { models: ids.size, pairs, sold30, empty, low, out, slots };
}
function placedIds(zone) {
  const s = new Set();
  S.layout.fixtures.forEach(f => { if (zone && f.zone !== zone) return; (f.shelves || []).forEach(sh => sh.slots.forEach(sl => { if (sl.p) s.add(sl.p); })); });
  return s;
}
function worstStatus(list) {
  const order = ['out', 'low', 'slow', 'ok', 'empty'];
  let best = 'empty';
  list.forEach(st => { if (order.indexOf(st) < order.indexOf(best)) best = st; });
  return best;
}
function polyArea(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a / 2); }
function polyBounds(pts) { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }; }
function fxCorners(f) {
  const a = f.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [[-f.w / 2, -f.d / 2], [f.w / 2, -f.d / 2], [f.w / 2, f.d / 2], [-f.w / 2, f.d / 2]].map(([lx, ly]) => [f.x + lx * c - ly * s, f.y + lx * s + ly * c]);
}

// ─────────── загрузка ───────────
async function loadAll() {
  $('pgLoading').style.display = 'flex';
  try {
    const g = await api(`?action=planogram-get&wh=${S.wh}`);
    S.layout = g.layout || defaultLayout();
    S.version = g.layout ? g.layout.version : null;
    if (!g.layout) setDirty(true);
    await loadStock();
  } catch (e) {
    toast('Ошибка загрузки: ' + e.message, true);
    if (!S.layout) S.layout = defaultLayout();
  }
  $('pgLoading').style.display = 'none';
  renderAll(true);
}
async function loadStock() {
  const ids = [...placedIds()].join(',');
  const d = await api(`?action=planogram-data&wh=${S.wh}${ids ? '&ids=' + ids : ''}`);
  S.products = new Map((d.products || []).map(p => [p.id, p]));
}
function setDirty(v) {
  S.dirty = v;
  const b = $('pgSave');
  b.disabled = !v; b.classList.toggle('dirty', v);
  b.textContent = v ? '💾 Сохранить' : 'Сохранено';
}
async function save() {
  const b = $('pgSave'); b.disabled = true; b.textContent = 'Сохраняю…';
  try {
    const lay = clone(S.layout); delete lay.version; delete lay.updatedAt; delete lay.updatedBy;
    const d = await api('?action=planogram-save', { method: 'POST', body: JSON.stringify({ wh: S.wh, layout: lay, version: S.version, by: USER }) });
    S.version = d.layout.version;
    setDirty(false); toast('Планограмма сохранена');
  } catch (e) {
    setDirty(true); toast('Не сохранено: ' + e.message, true);
  }
}
window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
function changed(rebuild3d = true) { setDirty(true); renderAll(rebuild3d); }

// ═══════════════════════ 3D ═══════════════════════
const G = { renderer: null, label: null, scene: null, cam: null, ctl: null, root: null, walls: [], pick: [], tex: new Map(), drag: null, built: false };
function init3d() {
  const host = $('pg3d');
  G.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  G.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  G.renderer.shadowMap.enabled = true;
  G.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  G.renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(G.renderer.domElement);
  G.label = new CSS2DRenderer();
  G.label.domElement.style.position = 'absolute'; G.label.domElement.style.inset = '0'; G.label.domElement.style.pointerEvents = 'none';
  host.appendChild(G.label.domElement);
  G.scene = new THREE.Scene();
  G.cam = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  G.ctl = new OrbitControls(G.cam, G.renderer.domElement);
  G.ctl.enableDamping = true; G.ctl.maxPolarAngle = 1.38; G.ctl.minDistance = 2; G.ctl.maxDistance = 40;
  G.scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe6ee, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.35);
  sun.position.set(8, 14, 6); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15 });
  G.sun = sun; G.scene.add(sun); G.scene.add(sun.target);
  const ro = new ResizeObserver(resize3d); ro.observe(host);
  bind3dPointer();
  (function loop() {
    requestAnimationFrame(loop);
    if (S.view !== '3d' || S.zone !== 'hall') return;
    G.ctl.update();
    updateWallFade();
    G.renderer.render(G.scene, G.cam);
    G.label.render(G.scene, G.cam);
  })();
}
function resize3d() {
  const host = $('pg3d'); const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  G.renderer.setSize(w, h); G.label.setSize(w, h);
  G.cam.aspect = w / h; G.cam.updateProjectionMatrix();
}
const MAT = {};
function mat(color, o) {
  const k = color + JSON.stringify(o || {});
  if (!MAT[k]) MAT[k] = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.02, ...(o || {}) });
  return MAT[k];
}
function floorTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#efe7da'; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = '#ded3c2'; x.lineWidth = 3; x.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function photoTex(url) {
  if (!url) return null;
  if (G.tex.has(url)) return G.tex.get(url);
  const t = new THREE.TextureLoader().load(url, () => {}, undefined, () => {});
  t.colorSpace = THREE.SRGBColorSpace;
  G.tex.set(url, t);
  return t;
}
function build3d(resetCam) {
  if (!G.scene) return;
  if (G.root) {
    G.root.traverse(o => { if (o.isCSS2DObject && o.element && o.element.parentNode) o.element.parentNode.removeChild(o.element); });
    G.scene.remove(G.root);
  }
  G.root = new THREE.Group(); G.scene.add(G.root);
  G.walls = []; G.pick = [];
  const z = S.layout.zones.hall;
  const pts = z.polygon;
  // пол
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, -y)));
  const fg = new THREE.ShapeGeometry(shape);
  const ft = floorTexture(); ft.repeat.set(1 / 0.6, 1 / 0.6);
  const floor = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ map: ft, roughness: 0.6 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.userData.floor = true;
  // UV по метрам
  const uv = fg.attributes.uv, pos = fg.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i), pos.getY(i));
  G.root.add(floor); G.floor = floor;
  // стены
  const H = z.wallH || 3; const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
    if (len < 0.05) return;
    const segs = [];
    const door = z.door && z.door.edge === i ? z.door : null;
    if (door) {
      const c0 = door.t * len - door.w / 2, c1 = door.t * len + door.w / 2;
      if (c0 > 0.05) segs.push([0, c0]);
      if (c1 < len - 0.05) segs.push([c1, len]);
    } else segs.push([0, len]);
    const ux = dx / len, uy = dy / len;
    let nx = -uy, ny = ux; // нормаль
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; } // наружу
    segs.forEach(([a, b]) => {
      const l = b - a; const m = new THREE.Mesh(new THREE.BoxGeometry(l, H, 0.14), new THREE.MeshStandardMaterial({ color: '#e9edf3', roughness: 0.9, transparent: true, opacity: 1 }));
      const sx = p[0] + ux * (a + l / 2) + nx * 0.07, sy = p[1] + uy * (a + l / 2) + ny * 0.07;
      m.position.set(sx, H / 2, sy); m.rotation.y = -Math.atan2(dy, dx);
      m.castShadow = false; m.receiveShadow = true;
      m.userData.wall = { nx, ny, x: sx, y: sy };
      G.root.add(m); G.walls.push(m);
    });
    if (door) {
      // стеклянная дверь + надпись «Вход»
      const dx0 = p[0] + ux * door.t * len, dy0 = p[1] + uy * door.t * len;
      const glass = new THREE.Mesh(new THREE.BoxGeometry(door.w, 2.2, 0.03), new THREE.MeshStandardMaterial({ color: '#bfdbfe', transparent: true, opacity: 0.35 }));
      glass.position.set(dx0 + nx * 0.07, 1.1, dy0 + ny * 0.07); glass.rotation.y = -Math.atan2(dy, dx);
      G.root.add(glass);
      const el = document.createElement('div'); el.className = 'pg-label'; el.innerHTML = '<b>⬆ Вход</b>';
      el.style.pointerEvents = 'none';
      const lo = new CSS2DObject(el); lo.position.set(dx0 + nx * 0.6, 0.1, dy0 + ny * 0.6); G.root.add(lo);
    }
  });
  // мебель
  zoneFx('hall').forEach(fx => G.root.add(buildFx(fx)));
  // свет/тень по центру
  G.sun.position.set(cx + 6, 14, cy + 4); G.sun.target.position.set(cx, 0, cy);
  if (resetCam || !G.built) {
    const b = polyBounds(pts); const span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
    const host = $('pg3d'); const asp = host.clientWidth && host.clientHeight ? host.clientWidth / host.clientHeight : 1.5;
    const k = asp < 1 ? 1.9 : asp < 1.3 ? 1.35 : 1;
    G.cam.position.set(cx - span * 0.15 * k, span * 0.95 * k, b.y1 + span * 0.75 * k);
    G.ctl.target.set(cx, 0.6, cy); G.ctl.update();
  }
  G.built = true;
}
function buildFx(fx) {
  const t = TYPES[fx.type] || TYPES.wall;
  const g = new THREE.Group();
  g.position.set(fx.x, 0, fx.y); g.rotation.y = -fx.rot * Math.PI / 180;
  g.userData.fid = fx.id;
  const sel = S.sel && S.sel.fid === fx.id;
  const add = (geo, m, x, y, z, pickable = true) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; if (pickable) { o.userData.fid = fx.id; G.pick.push(o); } g.add(o); return o; };
  const W = fx.w, D = fx.d, Hh = fx.h;
  if (t.shelves) {
    const frame = mat(fx.type === 'rack' ? '#94a3b8' : '#f1f5f9');
    const wood = mat(fx.type === 'rack' ? '#cbd5e1' : '#e7dccb');
    const n = (fx.shelves || []).length;
    if (fx.type === 'wall' || fx.type === 'rack') {
      add(new THREE.BoxGeometry(W, Hh, 0.04), mat(fx.type === 'rack' ? '#e2e8f0' : '#fbfaf7'), 0, Hh / 2, -D / 2 + 0.02);
      add(new THREE.BoxGeometry(0.04, Hh, D), frame, -W / 2 + 0.02, Hh / 2, 0);
      add(new THREE.BoxGeometry(0.04, Hh, D), frame, W / 2 - 0.02, Hh / 2, 0);
      add(new THREE.BoxGeometry(W, 0.12, D), frame, 0, 0.06, 0);
      if (fx.type === 'wall') { // подсветка-карниз
        add(new THREE.BoxGeometry(W, 0.06, D * 0.9), mat('#ffffff', { emissive: '#fff7e6', emissiveIntensity: 0.6 }), 0, Hh - 0.03, 0);
      }
    } else if (fx.type === 'island') {
      add(new THREE.BoxGeometry(W, 0.3, D), mat('#ffffff'), 0, 0.15, 0);
      add(new THREE.BoxGeometry(0.04, Hh, D * 0.9), frame, 0, Hh / 2, 0);
    } else if (fx.type === 'table') {
      add(new THREE.BoxGeometry(W * 0.9, Hh - 0.04, D * 0.9), mat('#ffffff'), 0, (Hh - 0.04) / 2, 0);
    }
    // полки + места
    const base = fx.type === 'island' ? 0.3 : (fx.type === 'table' ? Hh : 0.12);
    const span = fx.type === 'table' ? 0 : (Hh - base - 0.15);
    (fx.shelves || []).forEach((sh, si) => {
      const y = fx.type === 'table' ? Hh : base + (n > 1 ? span * si / (n - 1) : 0) + (si === 0 && fx.type !== 'island' ? 0.08 : 0);
      if (fx.type !== 'table' && !(fx.type === 'island' && si === 0)) add(new THREE.BoxGeometry(W - 0.06, 0.025, D * 0.92), wood, 0, y, 0.0);
      const m = sh.slots.length || 1;
      const cw = (W - 0.08) / m;
      sh.slots.forEach((sl, ki) => {
        const st = slotStatus(sl);
        const x = -W / 2 + 0.04 + cw * (ki + 0.5);
        const sw = Math.min(0.3, cw * 0.86);
        const zf = fx.type === 'island' || fx.type === 'table' ? 0 : D * 0.08;
        const isSel = S.sel && S.sel.k === 'slot' && S.sel.fid === fx.id && S.sel.si === si && S.sel.ki === ki;
        const ud = { fid: fx.id, si, ki, slot: true };
        // цветная планка статуса
        const strip = add(new THREE.BoxGeometry(sw, 0.014, 0.05), mat(ST_COLOR[st], { emissive: ST_COLOR[st], emissiveIntensity: 0.35 }), x, y + 0.02, zf + D * 0.36);
        strip.userData = ud;
        if (sl.p) {
          const p = S.products.get(sl.p);
          const tex = p && p.photo ? photoTex(p.photo) : null;
          if (tex) {
            const ph = add(new THREE.PlaneGeometry(sw, sw * 0.72), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide }), x, y + 0.03 + sw * 0.36, zf + D * 0.12);
            ph.userData = ud; ph.castShadow = false;
            if (fx.type === 'island' || fx.type === 'table') { const ph2 = ph.clone(); ph2.rotation.y = Math.PI; ph2.position.z = zf - D * 0.12; ph2.userData = ud; g.add(ph2); G.pick.push(ph2); }
          } else {
            const shoe = add(new THREE.BoxGeometry(sw * 0.8, 0.09, Math.min(0.24, D * 0.6)), mat(ST_COLOR[st] === '#cbd5e1' ? '#64748b' : '#334155'), x, y + 0.06, zf);
            shoe.userData = ud;
          }
        } else {
          const e = add(new THREE.BoxGeometry(sw * 0.8, 0.004, Math.min(0.22, D * 0.55)), mat('#e2e8f0', { transparent: true, opacity: 0.7 }), x, y + 0.016, zf);
          e.userData = ud;
        }
        if (isSel) {
          const box = new THREE.Mesh(new THREE.BoxGeometry(sw * 1.08, sw * 0.82, Math.min(0.3, D * 0.8)), new THREE.MeshBasicMaterial({ color: '#2563eb', wireframe: true }));
          box.position.set(x, y + 0.03 + sw * 0.4, zf); g.add(box);
        }
      });
    });
    // подпись секции
    const stt = fxStats(fx);
    const worst = worstStatus((fx.shelves || []).flatMap(sh => sh.slots.map(slotStatus)).filter(s => s !== 'empty'));
    const el = document.createElement('div');
    el.className = 'pg-label' + (sel ? ' sel' : '');
    el.innerHTML = `<b><span class="dot" style="background:${ST_COLOR[worst]}"></span>${esc(fx.category || fx.name)}</b><small>${esc(fx.name)} · ${stt.models} мод. · ${stt.pairs} пар</small>`;
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); select({ k: 'fx', fid: fx.id }); });
    const lo = new CSS2DObject(el); lo.position.set(0, Hh + 0.35, 0); g.add(lo);
  } else if (fx.type === 'cash') {
    add(new THREE.BoxGeometry(W, Hh, D), mat('#ffffff'), 0, Hh / 2, 0);
    add(new THREE.BoxGeometry(W + 0.06, 0.05, D + 0.06), mat('#d6c7b0'), 0, Hh + 0.025, 0);
    add(new THREE.BoxGeometry(0.5, 0.32, 0.04), mat('#1e293b'), -W * 0.2, Hh + 0.22, -D * 0.15);
    add(new THREE.BoxGeometry(0.15, 0.04, 0.4), mat('#2563eb', { emissive: '#2563eb', emissiveIntensity: 0.5 }), 0, Hh / 2, D / 2 + 0.01);
  } else if (fx.type === 'bench') {
    add(new THREE.BoxGeometry(W, Hh * 0.75, D), mat('#cbd5e1'), 0, Hh * 0.375, 0);
    add(new THREE.BoxGeometry(W, Hh * 0.25, D), mat('#64748b'), 0, Hh * 0.875, 0);
  } else if (fx.type === 'fitting') {
    const cm = new THREE.MeshStandardMaterial({ color: '#c7d2fe', transparent: true, opacity: 0.55 });
    add(new THREE.BoxGeometry(W, Hh, 0.04), cm, 0, Hh / 2, -D / 2);
    add(new THREE.BoxGeometry(0.04, Hh, D), cm, -W / 2, Hh / 2, 0);
    add(new THREE.BoxGeometry(0.04, Hh, D), cm, W / 2, Hh / 2, 0);
  } else if (fx.type === 'mirror') {
    add(new THREE.BoxGeometry(W, Hh, D), mat('#e0f2fe', { metalness: 0.6, roughness: 0.15 }), 0, Hh / 2 + 0.2, 0);
  } else if (fx.type === 'plant') {
    add(new THREE.CylinderGeometry(W * 0.32, W * 0.26, 0.4, 16), mat('#e7e5e4'), 0, 0.2, 0);
    add(new THREE.SphereGeometry(W * 0.55, 14, 12), mat('#22a35a'), 0, 0.4 + W * 0.6, 0);
    add(new THREE.SphereGeometry(W * 0.4, 14, 12), mat('#2fb866'), W * 0.15, 0.4 + W * 1.05, 0.05);
  }
  if (sel) {
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W + 0.08, Hh + 0.08, D + 0.08)), new THREE.LineBasicMaterial({ color: '#2563eb' }));
    outline.position.y = Hh / 2 + 0.02; g.add(outline);
    const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(W, D) * 0.62, Math.max(W, D) * 0.66, 48), new THREE.MeshBasicMaterial({ color: '#2563eb', transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; g.add(ring);
  }
  return g;
}
const _v = new THREE.Vector3();
function updateWallFade() {
  const c = G.cam.position;
  G.walls.forEach(w => {
    const u = w.userData.wall;
    const outside = (c.x - u.x) * u.nx + (c.z - u.y) * u.ny > 0;
    const op = outside ? 0.1 : 1;
    if (w.material.opacity !== op) { w.material.opacity = op; w.material.depthWrite = op === 1; }
  });
}
function bind3dPointer() {
  const el = G.renderer.domElement;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let down = null;
  const setNdc = (e) => { const r = el.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, G.cam); };
  el.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
    if (!S.edit) return;
    setNdc(e);
    const hit = ray.intersectObjects(G.pick, false)[0];
    if (hit && hit.object.userData.fid) {
      const fx = fxById(hit.object.userData.fid);
      const p = new THREE.Vector3(); ray.ray.intersectPlane(plane, p);
      G.drag = { fx, ox: fx.x - p.x, oy: fx.y - p.z, moved: false };
      G.ctl.enabled = false;
      el.setPointerCapture(e.pointerId);
    }
  });
  el.addEventListener('pointermove', (e) => {
    if (!G.drag) return;
    setNdc(e);
    const p = new THREE.Vector3(); if (!ray.ray.intersectPlane(plane, p)) return;
    const f = G.drag.fx;
    f.x = Math.round((p.x + G.drag.ox) * 20) / 20; f.y = Math.round((p.z + G.drag.oy) * 20) / 20;
    G.drag.moved = true;
    const grp = G.root.children.find(o => o.userData && o.userData.fid === f.id);
    if (grp) grp.position.set(f.x, 0, f.y);
  });
  el.addEventListener('pointerup', (e) => {
    const moved = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5;
    if (G.drag) {
      const d = G.drag; G.drag = null; G.ctl.enabled = true;
      if (d.moved) { S.sel = { k: 'fx', fid: d.fx.id }; changed(true); return; }
    }
    if (moved) return;
    setNdc(e);
    const hit = ray.intersectObjects(G.pick, false)[0];
    if (!hit) { select(null); return; }
    const u = hit.object.userData;
    if (u.slot) select({ k: 'slot', fid: u.fid, si: u.si, ki: u.ki });
    else if (u.fid) select({ k: 'fx', fid: u.fid });
  });
}

// ═══════════════════════ 2D ═══════════════════════
function svgPlan(host, opts) {
  const zone = S.layout.zones[S.zone === 'hall' || opts.forceHall ? (opts.forceHall ? 'hall' : S.zone) : S.zone];
  const zkey = opts.forceHall ? 'hall' : S.zone;
  const pts = zone.polygon;
  const b = polyBounds(pts);
  const pad = opts.mini ? 0.4 : 1.2;
  const vb = [b.x0 - pad, b.y0 - pad, (b.x1 - b.x0) + pad * 2, (b.y1 - b.y0) + pad * 2];
  const NS = 'http://www.w3.org/2000/svg';
  const FS = Math.max(vb[2], vb[3]) / 52; // базовый размер шрифта под масштаб помещения
  let h = `<svg xmlns="${NS}" viewBox="${vb.join(' ')}" preserveAspectRatio="xMidYMid meet">`;
  h += `<defs><pattern id="g1${opts.mini ? 'm' : ''}" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="#e2e8f0" stroke-width="0.02"/></pattern></defs>`;
  if (!opts.mini) h += `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="url(#g1)"/>`;
  h += `<polygon points="${pts.map(p => p.join(',')).join(' ')}" fill="${zkey === 'hall' ? '#f3ece1' : '#eef2f7'}" stroke="#334155" stroke-width="${opts.mini ? 0.12 : 0.14}" stroke-linejoin="round"/>`;
  // дверь
  if (zone.door) {
    const i = zone.door.edge, p = pts[i], q = pts[(i + 1) % pts.length];
    if (p && q) {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]), ux = (q[0] - p[0]) / len, uy = (q[1] - p[1]) / len;
      const c = zone.door.t * len;
      const a = [p[0] + ux * (c - zone.door.w / 2), p[1] + uy * (c - zone.door.w / 2)], bb = [p[0] + ux * (c + zone.door.w / 2), p[1] + uy * (c + zone.door.w / 2)];
      h += `<line x1="${a[0]}" y1="${a[1]}" x2="${bb[0]}" y2="${bb[1]}" stroke="#f8fafc" stroke-width="0.2"/><line x1="${a[0]}" y1="${a[1]}" x2="${bb[0]}" y2="${bb[1]}" stroke="#60a5fa" stroke-width="0.06" stroke-dasharray="0.15 0.08"/>`;
      if (!opts.mini) {
        const ccx = pts.reduce((s2, v) => s2 + v[0], 0) / pts.length, ccy = pts.reduce((s2, v) => s2 + v[1], 0) / pts.length;
        const mx = (a[0] + bb[0]) / 2, my = (a[1] + bb[1]) / 2; const dl = Math.hypot(ccx - mx, ccy - my) || 1;
        h += `<text x="${mx + (ccx - mx) / dl * FS * 1.4}" y="${my + (ccy - my) / dl * FS * 1.4}" font-size="${FS * 1.05}" text-anchor="middle" dominant-baseline="middle" fill="#2563eb" font-weight="700">⬆ Вход</text>`;
      }
    }
  }
  // размеры стен
  if (!opts.mini) {
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length]; const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
      const ang = Math.atan2(q[1] - p[1], q[0] - p[0]) * 180 / Math.PI;
      const a2 = (ang > 90 || ang < -90) ? ang + 180 : ang;
      const nx = -(q[1] - p[1]) / len, ny = (q[0] - p[0]) / len;
      const cx = pts.reduce((s, v) => s + v[0], 0) / pts.length, cy = pts.reduce((s, v) => s + v[1], 0) / pts.length;
      const sg = ((mx - cx) * nx + (my - cy) * ny) > 0 ? 1 : -1;
      h += `<text x="${mx + nx * sg * FS * 1.4}" y="${my + ny * sg * FS * 1.4}" font-size="${FS * 0.85}" fill="#64748b" text-anchor="middle" dominant-baseline="middle" transform="rotate(${a2} ${mx + nx * sg * FS * 1.4} ${my + ny * sg * FS * 1.4})">${fmt(r2(len))} м</text>`;
    });
  }
  // мебель
  zoneFx(zkey).forEach(fx => {
    const t = TYPES[fx.type] || TYPES.wall;
    const sel = S.sel && S.sel.fid === fx.id;
    const fill = t.shelves ? (fx.type === 'rack' ? '#cbd5e1' : '#ffffff') : (fx.type === 'plant' ? '#bbf7d0' : fx.type === 'bench' ? '#cbd5e1' : fx.type === 'cash' ? '#dbeafe' : '#e0e7ff');
    h += `<g data-fid="${fx.id}" transform="translate(${fx.x} ${fx.y}) rotate(${fx.rot})" style="cursor:${S.edit ? 'move' : 'pointer'}">`;
    if (fx.type === 'plant') h += `<circle r="${fx.w / 2}" fill="${fill}" stroke="#16a34a" stroke-width="0.04"/>`;
    else h += `<rect x="${-fx.w / 2}" y="${-fx.d / 2}" width="${fx.w}" height="${fx.d}" rx="0.04" fill="${fill}" stroke="${sel ? '#2563eb' : '#64748b'}" stroke-width="${sel ? 0.07 : 0.03}"/>`;
    if (t.shelves && fx.shelves && fx.shelves.length) {
      // колонки мест: худший статус по всем полкам в этой колонке
      const m = Math.max(...fx.shelves.map(s => s.slots.length));
      const cw = (fx.w - 0.06) / m;
      for (let k = 0; k < m; k++) {
        const st = worstStatus(fx.shelves.map(s => slotStatus(s.slots[k])).filter(Boolean).filter(x => x !== 'empty')) ;
        const allEmpty = fx.shelves.every(s => !s.slots[k] || !s.slots[k].p);
        h += `<rect x="${-fx.w / 2 + 0.03 + k * cw + cw * 0.08}" y="${fx.d / 2 - 0.13}" width="${cw * 0.84}" height="0.09" rx="0.02" fill="${allEmpty ? '#e2e8f0' : ST_COLOR[st]}"/>`;
      }
    }
    if (!opts.mini && fx.type !== 'plant' && fx.type !== 'mirror') {
      const label = fx.name.length > 16 ? fx.name.slice(0, 15) + '…' : fx.name;
      const fs = Math.min(FS, fx.w / (label.length * 0.62), fx.d * 0.62 + FS * 0.25);
      const rotBack = (fx.rot % 360 + 360) % 360;
      const flip = rotBack > 90 && rotBack < 270 ? 180 : 0;
      h += `<text x="0" y="${t.shelves ? -0.02 : 0.05}" font-size="${fs}" text-anchor="middle" dominant-baseline="middle" fill="#0f172a" font-weight="700" transform="rotate(${flip})" pointer-events="none">${esc(label)}</text>`;
    }
    if (sel && S.edit && !opts.mini) {
      h += `<line x1="0" y1="${-fx.d / 2}" x2="0" y2="${-fx.d / 2 - 0.45}" stroke="#2563eb" stroke-width="0.03"/><circle data-rot="${fx.id}" cx="0" cy="${-fx.d / 2 - 0.5}" r="0.13" fill="#fff" stroke="#2563eb" stroke-width="0.05" style="cursor:grab"/>`;
    }
    h += `</g>`;
  });
  // редактор формы
  if (S.shapeEdit && !opts.mini) {
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      h += `<circle data-mid="${i}" cx="${(p[0] + q[0]) / 2}" cy="${(p[1] + q[1]) / 2}" r="0.14" fill="#fff" stroke="#16a34a" stroke-width="0.04" style="cursor:copy"/><text x="${(p[0] + q[0]) / 2}" y="${(p[1] + q[1]) / 2 + 0.06}" font-size="0.2" text-anchor="middle" fill="#16a34a" pointer-events="none">+</text>`;
    });
    pts.forEach((p, i) => { h += `<circle data-vx="${i}" cx="${p[0]}" cy="${p[1]}" r="0.17" fill="${S.vsel === i ? '#2563eb' : '#fff'}" stroke="#2563eb" stroke-width="0.05" style="cursor:grab"/>`; });
  }
  h += `</svg>`;
  host.innerHTML = h;
  const svg = host.querySelector('svg');
  if (opts.mini) {
    svg.addEventListener('click', (e) => {
      const g = e.target.closest('[data-fid]');
      if (g) { select({ k: 'fx', fid: g.dataset.fid }); return; }
      setView('2d');
    });
    return;
  }
  bind2d(svg, pts);
}
function bind2d(svg, pts) {
  const toPt = (e) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const m = svg.getScreenCTM().inverse(); const r = p.matrixTransform(m); return [r.x, r.y]; };
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    const [x, y] = toPt(e);
    const vx = e.target.getAttribute('data-vx'), mid = e.target.getAttribute('data-mid'), rot = e.target.getAttribute('data-rot');
    if (vx != null) { S.vsel = Number(vx); drag = { k: 'vx', i: Number(vx) }; svg.setPointerCapture(e.pointerId); renderPanel(); return; }
    if (mid != null) {
      const i = Number(mid), p = pts[i], q = pts[(i + 1) % pts.length];
      pts.splice(i + 1, 0, [r2((p[0] + q[0]) / 2), r2((p[1] + q[1]) / 2)]);
      const z = S.layout.zones[S.zone]; if (z.door && z.door.edge > i) z.door.edge++;
      S.vsel = i + 1; changed(true); return;
    }
    if (rot) { const fx = fxById(rot); drag = { k: 'rot', fx }; svg.setPointerCapture(e.pointerId); return; }
    const g = e.target.closest('[data-fid]');
    if (g) {
      const fx = fxById(g.dataset.fid);
      if (!S.sel || S.sel.fid !== fx.id || S.sel.k !== 'fx') { S.sel = { k: 'fx', fid: fx.id }; }
      if (S.edit) { drag = { k: 'fx', fx, ox: fx.x - x, oy: fx.y - y, moved: false }; svg.setPointerCapture(e.pointerId); }
      render2d(); renderPanel(); hint();
      return;
    }
    select(null);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [x, y] = toPt(e);
    if (drag.k === 'fx') {
      drag.fx.x = Math.round((x + drag.ox) * 20) / 20; drag.fx.y = Math.round((y + drag.oy) * 20) / 20; drag.moved = true;
      const g = svg.querySelector(`[data-fid="${drag.fx.id}"]`); if (g) g.setAttribute('transform', `translate(${drag.fx.x} ${drag.fx.y}) rotate(${drag.fx.rot})`);
    } else if (drag.k === 'rot') {
      const a = Math.atan2(y - drag.fx.y, x - drag.fx.x) * 180 / Math.PI + 90;
      drag.fx.rot = ((Math.round(a / 15) * 15) % 360 + 360) % 360; drag.moved = true;
      const g = svg.querySelector(`[data-fid="${drag.fx.id}"]`); if (g) g.setAttribute('transform', `translate(${drag.fx.x} ${drag.fx.y}) rotate(${drag.fx.rot})`);
    } else if (drag.k === 'vx') {
      pts[drag.i] = [Math.round(x * 20) / 20, Math.round(y * 20) / 20]; drag.moved = true;
      render2dKeep(svg);
    }
  });
  svg.addEventListener('pointerup', () => {
    if (drag && drag.moved) { drag = null; changed(true); return; }
    drag = null;
  });
}
let rafKeep = 0;
function render2dKeep() { cancelAnimationFrame(rafKeep); rafKeep = requestAnimationFrame(() => render2d()); }
function render2d() {
  if (S.view === '2d' || S.zone === 'stock') svgPlan($('pg2d'), {});
  if (S.zone === 'hall') svgPlan($('pgInset'), { mini: true, forceHall: true });
}

// ═══════════════════════ панель ═══════════════════════
function stat(label, val) { return `<div class="pg-stat"><small>${label}</small><b>${val}</b></div>`; }
function prodThumb(p, cls) { return p && p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy">` : `<div class="ph">👟</div>`; }
function renderPanel() {
  const P = $('pgPanel');
  const sel = S.sel;
  if (sel && sel.k === 'slot') return renderSlotPanel(P, sel);
  if (sel && sel.k === 'fx') return renderFxPanel(P, fxById(sel.fid));
  return renderZonePanel(P);
}
function renderZonePanel(P) {
  const z = S.layout.zones[S.zone];
  const fxs = zoneFx(S.zone);
  const area = polyArea(z.polygon);
  let h = `<h3>${esc(z.name)}</h3><div class="pg-sub">${esc(STORES.find(s => s.wh === S.wh).name)} · ${fmt(r2(area))} м² · ${fxs.length} объектов</div>`;
  if (S.edit) {
    h += `<h4>Помещение</h4>
      <div class="pg-grid2">
        <div class="pg-f"><label>Название зоны</label><input id="zName" value="${esc(z.name)}"></div>
        ${S.zone === 'hall' ? `<div class="pg-f"><label>Высота стен, м</label><input id="zH" type="number" step="0.1" value="${z.wallH || 3}"></div>` : '<div></div>'}
      </div>
      <div class="pg-row" style="margin-top:8px">
        <button class="pg-btn sm ${S.shapeEdit ? 'pri' : ''}" id="zShape">✏️ ${S.shapeEdit ? 'Готово: форма' : 'Изменить форму'}</button>
        ${S.shapeEdit && S.vsel != null ? `<button class="pg-btn sm danger" id="zDelV">Удалить точку ${S.vsel + 1}</button>` : ''}
        <button class="pg-btn sm" id="zRect">▭ Прямоугольник</button>
      </div>
      ${S.shapeEdit ? `<div class="pg-info">Тяните синие точки — углы помещения. Зелёный «+» на стене добавляет новый угол (для Г-образной или сложной формы). Размеры стен подписаны на плане.</div>` : ''}
      ${S.shapeEdit && S.vsel != null ? `<div class="pg-grid2" style="margin-top:8px"><div class="pg-f"><label>Точка ${S.vsel + 1}: X, м</label><input id="vX" type="number" step="0.05" value="${z.polygon[S.vsel][0]}"></div><div class="pg-f"><label>Y, м</label><input id="vY" type="number" step="0.05" value="${z.polygon[S.vsel][1]}"></div></div>` : ''}
      <h4>Вход</h4>
      <div class="pg-grid3">
        <div class="pg-f"><label>Стена №</label><select id="dEdge">${z.polygon.map((_, i) => `<option value="${i}" ${z.door && z.door.edge === i ? 'selected' : ''}>${i + 1}</option>`).join('')}<option value="-1" ${!z.door ? 'selected' : ''}>нет</option></select></div>
        <div class="pg-f"><label>Позиция, %</label><input id="dT" type="number" min="0" max="100" step="1" value="${z.door ? Math.round(z.door.t * 100) : 50}"></div>
        <div class="pg-f"><label>Ширина, м</label><input id="dW" type="number" step="0.1" value="${z.door ? z.door.w : 1}"></div>
      </div>
      <h4>Добавить объект</h4>
      <div class="pg-add">${Object.entries(TYPES).filter(([k, t]) => S.zone === 'stock' ? ['rack', 'wall', 'table'].includes(k) : k !== 'rack').map(([k, t]) => `<button class="pg-btn sm" data-addfx="${k}">＋ ${esc(t.label)}</button>`).join('')}</div>`;
  } else {
    h += `<div class="pg-info">Нажмите на шкаф или место на полке, чтобы увидеть товар и остатки. Включите «Редактирование», чтобы двигать шкафы, менять полки и форму помещения.</div>`;
  }
  // список секций
  h += `<h4>Секции и шкафы</h4><div class="pg-list">`;
  fxs.filter(f => TYPES[f.type].shelves).forEach(f => {
    const st = fxStats(f);
    h += `<div class="pg-li" data-fx="${f.id}"><div class="ph">${f.type === 'rack' ? '🗄' : f.type === 'island' ? '🔲' : '🧱'}</div><div class="t"><b>${esc(f.name)}</b><small>${esc(f.category || TYPES[f.type].label)} · ${st.models} мод. · ${st.pairs} пар${st.empty ? ` · пусто ${st.empty}` : ''}</small></div><div class="n">${st.out ? `<span class="pg-pill out">${st.out}</span>` : ''}${st.low ? ` <span class="pg-pill low">${st.low}</span>` : ''}</div></div>`;
  });
  h += `</div>`;
  // не выставлено
  const placed = placedIds();
  const notPlaced = [...S.products.values()].filter(p => p.here > 0 && !placed.has(p.id)).sort((a, b) => (b.sold30 - a.sold30) || (b.here - a.here));
  h += `<h4>В наличии, но не выставлено (${notPlaced.length})</h4><div class="pg-list">${notPlaced.slice(0, 12).map(p => `<div class="pg-li" title="${esc(p.name)}">${prodThumb(p)}<div class="t"><b>${esc(p.name)}</b><small>${esc(p.category || '')} · продано 30 дн.: ${p.sold30}</small></div><div class="n">${p.here} пар</div></div>`).join('') || '<div class="pg-empty">Всё выставлено</div>'}</div>`;
  if (notPlaced.length > 12) h += `<button class="pg-btn sm" id="zAllNp" style="margin-top:6px">Показать все ${notPlaced.length}</button>`;
  P.innerHTML = h;
  P.querySelectorAll('[data-fx]').forEach(el => el.addEventListener('click', () => select({ k: 'fx', fid: el.dataset.fx })));
  P.querySelectorAll('[data-addfx]').forEach(el => el.addEventListener('click', () => addFx(el.dataset.addfx)));
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  on('zName', 'change', (e) => { z.name = e.target.value.trim() || z.name; changed(false); });
  on('zH', 'change', (e) => { z.wallH = Math.max(2, Math.min(6, Number(e.target.value) || 3)); changed(true); });
  on('zShape', 'click', () => { S.shapeEdit = !S.shapeEdit; S.vsel = null; if (S.shapeEdit) setView('2d'); renderAll(false); });
  on('zDelV', 'click', () => {
    if (z.polygon.length <= 3) return toast('Минимум 3 угла', true);
    z.polygon.splice(S.vsel, 1); if (z.door && z.door.edge >= z.polygon.length) z.door.edge = 0; S.vsel = null; changed(true);
  });
  on('zRect', 'click', () => {
    const w = Number(prompt('Ширина помещения, м:', '12')); const d = Number(prompt('Глубина помещения, м:', '7.5'));
    if (!(w > 1 && d > 1)) return;
    z.polygon = [[0, 0], [w, 0], [w, d], [0, d]]; if (z.door) z.door.edge = Math.min(z.door.edge, 3); changed(true);
  });
  on('vX', 'change', (e) => { z.polygon[S.vsel][0] = Number(e.target.value) || 0; changed(true); });
  on('vY', 'change', (e) => { z.polygon[S.vsel][1] = Number(e.target.value) || 0; changed(true); });
  const doorUpd = () => {
    const ed = Number($('dEdge').value);
    if (ed < 0) z.door = null; else z.door = { edge: ed, t: Math.max(0, Math.min(1, (Number($('dT').value) || 50) / 100)), w: Math.max(0.6, Number($('dW').value) || 1) };
    changed(true);
  };
  ['dEdge', 'dT', 'dW'].forEach(id => on(id, 'change', doorUpd));
  on('zAllNp', 'click', () => openNotPlaced(notPlaced));
}
function addFx(type) {
  const z = S.layout.zones[S.zone]; const b = polyBounds(z.polygon);
  const fx = mkFx(type, { zone: S.zone, x: r2((b.x0 + b.x1) / 2), y: r2((b.y0 + b.y1) / 2) });
  const same = S.layout.fixtures.filter(f => f.type === type && f.zone === S.zone).length + 1;
  if (TYPES[type].shelves) fx.name = (type === 'rack' ? 'Стеллаж S-' : type === 'island' ? 'Остров I-' : type === 'table' ? 'Подиум T-' : 'Секция N-') + same;
  S.layout.fixtures.push(fx);
  S.sel = { k: 'fx', fid: fx.id };
  changed(true);
  toast('Добавлено: ' + fx.name + ' — перетащите на место');
}
function renderFxPanel(P, fx) {
  if (!fx) { S.sel = null; return renderZonePanel(P); }
  const t = TYPES[fx.type];
  const st = fxStats(fx);
  let h = `<div class="pg-crumb"><a id="bkZone">${esc(S.layout.zones[fx.zone].name)}</a> › ${esc(fx.name)}</div>`;
  h += `<h3>${esc(fx.name)}</h3><div class="pg-sub">${esc(t.label)}${fx.category ? ' · ' + esc(fx.category) : ''} · ${fmt(fx.w)}×${fmt(fx.d)}×${fmt(fx.h)} м</div>`;
  if (t.shelves) h += `<div class="pg-stats">${stat('Моделей', st.models)}${stat('Пар в магазине', st.pairs)}${stat('Продано 30 дн.', st.sold30)}${stat('Пустых мест', st.empty)}${stat('Мало', st.low)}${stat('Нет в наличии', st.out)}</div>`;
  if (S.edit) {
    h += `<h4>Параметры</h4>
    <div class="pg-grid2">
      <div class="pg-f"><label>Название</label><input id="fName" value="${esc(fx.name)}"></div>
      <div class="pg-f"><label>Категория</label><input id="fCat" list="pgCats" value="${esc(fx.category || '')}"><datalist id="pgCats">${CATS.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
    </div>
    <div class="pg-grid3" style="margin-top:8px">
      <div class="pg-f"><label>Ширина, м</label><input id="fW" type="number" step="0.05" value="${fx.w}"></div>
      <div class="pg-f"><label>Глубина, м</label><input id="fD" type="number" step="0.05" value="${fx.d}"></div>
      <div class="pg-f"><label>Высота, м</label><input id="fH" type="number" step="0.05" value="${fx.h}"></div>
      <div class="pg-f"><label>X, м</label><input id="fX" type="number" step="0.05" value="${fx.x}"></div>
      <div class="pg-f"><label>Y, м</label><input id="fY" type="number" step="0.05" value="${fx.y}"></div>
      <div class="pg-f"><label>Поворот, °</label><input id="fR" type="number" step="15" value="${fx.rot}"></div>
    </div>
    <div class="pg-actions">
      <button class="pg-btn" id="fRot">↻ Повернуть 90°</button>
      <button class="pg-btn" id="fDup">⧉ Дублировать</button>
      <button class="pg-btn danger" id="fDel">🗑 Удалить</button>
      <button class="pg-btn" id="fDone">✓ Готово</button>
    </div>`;
  }
  if (t.shelves) {
    h += `<h4>Полки и места ${S.edit ? '' : '<span class="pg-sub" style="text-transform:none;letter-spacing:0">(нажмите на место)</span>'}</h4><div class="pg-shelves">`;
    for (let si = fx.shelves.length - 1; si >= 0; si--) {
      const sh = fx.shelves[si];
      h += `<div class="pg-shelf"><div class="pg-shelf-h"><span>Полка ${si + 1}${si === fx.shelves.length - 1 ? ' (верх)' : si === 0 ? ' (низ)' : ''} · ${sh.slots.length} мест</span>
        ${S.edit ? `<span class="pg-row"><button class="pg-mini" data-sm="${si}" title="Убрать место">−</button><button class="pg-mini" data-sp="${si}" title="Добавить место">+</button><button class="pg-mini" data-sdel="${si}" title="Удалить полку">✕</button></span>` : ''}</div>
        <div class="pg-cells" style="grid-template-columns:repeat(${sh.slots.length},1fr)">${sh.slots.map((sl, ki) => {
          const stt = slotStatus(sl); const p = sl.p && S.products.get(sl.p);
          const isSel = S.sel && S.sel.k === 'slot' && S.sel.si === si && S.sel.ki === ki;
          return `<div class="pg-cell ${sl.p ? '' : 'empty'} ${isSel ? 'sel' : ''}" data-si="${si}" data-ki="${ki}" title="${esc(p ? p.name + ' — ' + (p.here || 0) + ' пар' : 'Пустое место')}" style="--c:${ST_COLOR[stt]};${p && p.photo ? `background-image:url('${esc(p.photo)}')` : ''}"></div>`;
        }).join('')}</div></div>`;
    }
    h += `</div>`;
    if (S.edit) h += `<div class="pg-row" style="margin-top:8px"><button class="pg-btn sm" id="shAdd">＋ Добавить полку</button><button class="pg-btn sm" id="shAll">Мест на всех полках…</button></div>`;
  }
  P.innerHTML = h;
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  on('bkZone', 'click', () => select(null));
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  on('fName', 'change', (e) => { fx.name = e.target.value.trim() || fx.name; changed(true); });
  on('fCat', 'change', (e) => { fx.category = e.target.value.trim(); changed(true); });
  on('fW', 'change', (e) => { fx.w = Math.max(0.2, num(e.target.value, fx.w)); changed(true); });
  on('fD', 'change', (e) => { fx.d = Math.max(0.05, num(e.target.value, fx.d)); changed(true); });
  on('fH', 'change', (e) => { fx.h = Math.max(0.2, num(e.target.value, fx.h)); changed(true); });
  on('fX', 'change', (e) => { fx.x = num(e.target.value, fx.x); changed(true); });
  on('fY', 'change', (e) => { fx.y = num(e.target.value, fx.y); changed(true); });
  on('fR', 'change', (e) => { fx.rot = ((num(e.target.value, fx.rot) % 360) + 360) % 360; changed(true); });
  on('fRot', 'click', () => { fx.rot = (fx.rot + 90) % 360; changed(true); });
  on('fDup', 'click', () => { const c = clone(fx); c.id = uid('f'); c.x = r2(c.x + 0.4); c.y = r2(c.y + 0.4); c.name = fx.name + ' (копия)'; (c.shelves || []).forEach(sh => sh.slots.forEach(sl => { sl.p = null; })); S.layout.fixtures.push(c); S.sel = { k: 'fx', fid: c.id }; changed(true); });
  on('fDel', 'click', () => {
    const n = fxStats(fx).models;
    if (!confirm(`Удалить «${fx.name}»?${n ? `\nНа нём привязано моделей: ${n} — привязки удалятся.` : ''}`)) return;
    S.layout.fixtures = S.layout.fixtures.filter(f => f.id !== fx.id); S.sel = null; changed(true);
  });
  on('fDone', 'click', () => select(null));
  on('shAdd', 'click', () => { const m = fx.shelves.length ? fx.shelves[fx.shelves.length - 1].slots.length : (TYPES[fx.type].m || 4); fx.shelves.push({ slots: Array.from({ length: m }, () => ({ p: null, q: 1 })) }); changed(true); });
  on('shAll', 'click', () => {
    const m = Number(prompt('Сколько мест (пар) на каждой полке?', String(fx.shelves[0] ? fx.shelves[0].slots.length : 6)));
    if (!(m >= 1 && m <= 30)) return;
    fx.shelves.forEach(sh => { while (sh.slots.length < m) sh.slots.push({ p: null, q: 1 }); if (sh.slots.length > m) { const cut = sh.slots.slice(m).filter(s => s.p).length; if (cut && !confirm(`На полке убираются места с товаром (${cut}). Продолжить?`)) return; sh.slots.length = m; } });
    changed(true);
  });
  P.querySelectorAll('[data-sp]').forEach(b => b.addEventListener('click', () => { const sh = fx.shelves[Number(b.dataset.sp)]; if (sh.slots.length >= 30) return; sh.slots.push({ p: null, q: 1 }); changed(true); }));
  P.querySelectorAll('[data-sm]').forEach(b => b.addEventListener('click', () => {
    const sh = fx.shelves[Number(b.dataset.sm)]; if (sh.slots.length <= 1) return;
    const last = sh.slots[sh.slots.length - 1]; if (last.p && !confirm('На последнем месте есть товар. Убрать место?')) return;
    sh.slots.pop(); changed(true);
  }));
  P.querySelectorAll('[data-sdel]').forEach(b => b.addEventListener('click', () => {
    const si = Number(b.dataset.sdel); const sh = fx.shelves[si];
    if (fx.shelves.length <= 1) return toast('Должна остаться хотя бы одна полка', true);
    const n = sh.slots.filter(s => s.p).length;
    if (n && !confirm(`На полке ${si + 1} привязано товаров: ${n}. Удалить полку?`)) return;
    fx.shelves.splice(si, 1); if (S.sel && S.sel.k === 'slot') S.sel = { k: 'fx', fid: fx.id }; changed(true);
  }));
  P.querySelectorAll('.pg-cell').forEach(c => c.addEventListener('click', () => select({ k: 'slot', fid: fx.id, si: Number(c.dataset.si), ki: Number(c.dataset.ki) })));
}
function sizesHTML(sizes) {
  const ks = Object.keys(sizes || {}).sort((a, b) => (parseFloat(a) || 999) - (parseFloat(b) || 999) || a.localeCompare(b));
  return ks.length ? `<div class="pg-sizes">${ks.map(k => `<span class="pg-size">${esc(k)}: <b>${sizes[k]}</b></span>`).join('')}</div>` : '<div class="pg-empty">нет размеров</div>';
}
function suggestions(fx, excludeId) {
  const placed = placedIds();
  const cat = (fx.category || '').toLowerCase();
  const all = [...S.products.values()].filter(p => p.here > 2 && !placed.has(p.id) && p.id !== excludeId);
  const catMatch = (p) => {
    const c = (p.category || '').toLowerCase();
    if (!cat) return true;
    if (cat.includes('жен')) return c.includes('жен');
    if (cat.includes('муж')) return c.includes('муж');
    if (cat.includes('дет')) return c.includes('мальч') || c.includes('девоч') || c.includes('дет');
    return true;
  };
  const sc = (p) => (p.sold30 || 0) * 3 + (p.here || 0);
  const a = all.filter(catMatch).sort((x, y) => sc(y) - sc(x));
  return (a.length ? a : all.sort((x, y) => sc(y) - sc(x))).slice(0, 6);
}
function renderSlotPanel(P, sel) {
  const fx = fxById(sel.fid);
  const sh = fx && fx.shelves && fx.shelves[sel.si];
  const sl = sh && sh.slots[sel.ki];
  if (!sl) { S.sel = fx ? { k: 'fx', fid: fx.id } : null; return renderPanel(); }
  const st = slotStatus(sl);
  const p = sl.p ? S.products.get(sl.p) : null;
  let h = `<div class="pg-crumb"><a id="bkZone">${esc(S.layout.zones[fx.zone].name)}</a> › <a id="bkFx">${esc(fx.name)}</a> › Полка ${sel.si + 1} · место ${sel.ki + 1}</div>`;
  if (sl.p) {
    h += `<div class="pg-prod">${p && p.photo ? `<img src="${esc(p.photo)}" alt="">` : '<div class="ph">👟</div>'}<div>
      <h3 style="font-size:15.5px">${esc(p ? p.name : 'Товар не найден')}</h3>
      <div class="pg-sub">${esc(p && p.category || '')}${p && p.price ? ' · ' + fmt(p.price) + ' с.' : ''}</div>
      <div style="margin-top:6px"><span class="pg-pill ${st}">${ST_LABEL[st]}</span></div></div></div>
      <div class="pg-stats">${stat('В этом магазине', (p ? p.here : 0) + ' пар')}${stat('Продано 7 дн.', p ? p.sold7 : 0)}${stat('Продано 30 дн.', p ? p.sold30 : 0)}</div>
      <h4>Размеры в этом магазине</h4>${sizesHTML(p && p.sizes)}
      <h4>Остатки на других складах</h4><div id="slOther"><div class="pg-empty">⏳ загружаю…</div></div>
      <div class="pg-grid2" style="margin-top:10px"><div class="pg-f"><label>Пар на этом месте (выставлено)</label><input id="slQ" type="number" min="1" max="20" value="${sl.q || 1}"></div><div></div></div>`;
    if (st === 'low' || st === 'out') h += `<div class="pg-note">⚠ ${st === 'out' ? 'Этой модели нет в магазине' : 'Осталось мало пар'} — стоит перевести модель в скидки или привезти, а на это место поставить модель с большим остатком.</div>`;
    if (st === 'slow') h += `<div class="pg-note">Модель есть, но за 30 дней не продавалась на этом магазине — кандидат на скидку или перенос на более видное место.</div>`;
    h += `<div class="pg-actions"><button class="pg-btn pri" id="slSet">🔁 Заменить товар</button><button class="pg-btn danger" id="slClr">Убрать с места</button></div>`;
  } else {
    h += `<h3>Пустое место</h3><div class="pg-sub">${esc(fx.name)}${fx.category ? ' · ' + esc(fx.category) : ''}</div>
      <div class="pg-actions"><button class="pg-btn pri" id="slSet" style="grid-column:span 2">＋ Привязать товар</button></div>`;
  }
  const sug = suggestions(fx, sl.p);
  if (!sl.p || st === 'low' || st === 'out' || st === 'slow') {
    h += `<h4>Предлагаем поставить сюда</h4><div class="pg-list">${sug.map(s => `<div class="pg-li" data-put="${s.id}">${prodThumb(s)}<div class="t"><b>${esc(s.name)}</b><small>продано 30 дн.: ${s.sold30} · не выставлена</small></div><div class="n">${s.here} пар</div></div>`).join('') || '<div class="pg-empty">Нет подходящих моделей с остатком &gt; 2</div>'}</div>`;
  }
  // соседние места этой полки
  h += `<h4>Полка ${sel.si + 1}</h4><div class="pg-cells" style="grid-template-columns:repeat(${sh.slots.length},1fr)">${sh.slots.map((s2, ki) => { const pp = s2.p && S.products.get(s2.p); return `<div class="pg-cell ${s2.p ? '' : 'empty'} ${ki === sel.ki ? 'sel' : ''}" data-ki="${ki}" style="--c:${ST_COLOR[slotStatus(s2)]};${pp && pp.photo ? `background-image:url('${esc(pp.photo)}')` : ''}" title="${esc(pp ? pp.name : 'Пусто')}"></div>`; }).join('')}</div>`;
  P.innerHTML = h;
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  on('bkZone', 'click', () => select(null));
  on('bkFx', 'click', () => select({ k: 'fx', fid: fx.id }));
  on('slSet', 'click', () => openPicker(fx, sl));
  on('slClr', 'click', () => { sl.p = null; sl.q = 1; changed(true); });
  on('slQ', 'change', (e) => { sl.q = Math.max(1, Math.min(20, Number(e.target.value) || 1)); changed(false); });
  P.querySelectorAll('[data-put]').forEach(el => el.addEventListener('click', () => assign(sl, el.dataset.put)));
  P.querySelectorAll('.pg-cells .pg-cell').forEach(c => c.addEventListener('click', () => select({ k: 'slot', fid: fx.id, si: sel.si, ki: Number(c.dataset.ki) })));
  if (sl.p) loadDetail(sl.p);
}
async function loadDetail(pid) {
  const box = () => $('slOther');
  const show = (ws) => {
    const el = box(); if (!el) return;
    const others = ws.filter(w => w.id !== S.wh);
    el.innerHTML = others.length ? `<div class="pg-list">${others.map(w => `<div class="pg-li" style="cursor:default"><div class="t"><b>${esc(w.name)}</b>${sizesHTML(w.sizes)}</div><div class="n">${w.total} пар</div></div>`).join('')}</div>` : '<div class="pg-empty">На других складах нет</div>';
  };
  if (S.detail[pid]) return show(S.detail[pid]);
  try { const d = await api(`?action=planogram-product&id=${pid}`); S.detail[pid] = d.warehouses || []; show(S.detail[pid]); }
  catch (e) { const el = box(); if (el) el.innerHTML = `<div class="pg-empty">Не загрузилось: ${esc(e.message)}</div>`; }
}
async function assign(sl, pid, prodStub) {
  sl.p = pid; sl.q = sl.q || 1;
  if (!S.products.has(pid)) {
    if (prodStub) S.products.set(pid, { ...prodStub, here: 0, sizes: {}, sold30: 0, sold7: 0 });
    loadStock().then(() => renderAll(true)).catch(() => {});
  }
  closeModal();
  changed(true);
  toast('Товар привязан к месту');
}

// ─────────── модалки ───────────
function closeModal() { const m = $('pgModal'); m.hidden = true; m.innerHTML = ''; }
$('pgModal').addEventListener('click', (e) => { if (e.target.id === 'pgModal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
function openPicker(fx, sl) {
  const m = $('pgModal'); m.hidden = false;
  const placed = placedIds();
  const local = [...S.products.values()].filter(p => p.here > 0).sort((a, b) => ((placed.has(a.id) ? 1 : 0) - (placed.has(b.id) ? 1 : 0)) || (b.sold30 - a.sold30) || (b.here - a.here));
  m.innerHTML = `<div class="pg-mbox"><h3>Привязать товар к месту</h3>
    <div class="pg-sub" style="margin-bottom:8px">${esc(fx.name)} · полка ${S.sel.si + 1}, место ${S.sel.ki + 1}. Введите название, артикул или отсканируйте штрихкод пары.</div>
    <input class="pg-search" id="pkQ" placeholder="Поиск: название / артикул / штрихкод" autocomplete="off">
    <div class="pg-mlist" id="pkList"></div>
    <div class="pg-row" style="justify-content:flex-end;margin-top:10px"><button class="pg-btn" id="pkClose">Закрыть</button></div></div>`;
  const list = $('pkList');
  const row = (p, extra) => `<div class="pg-li" data-pid="${p.id}">${prodThumb(p)}<div class="t"><b>${esc(p.name)}</b><small>${esc(p.category || '')}${extra || ''}</small></div><div class="n">${p.here != null ? p.here + ' пар' : ''}</div></div>`;
  const draw = (arr, remote) => {
    list.innerHTML = arr.length ? arr.slice(0, 60).map(p => row(p, placed.has(p.id) ? ' · уже на витрине' : (p.sold30 != null ? ` · продано 30 дн.: ${p.sold30}` : ''))).join('') : `<div class="pg-empty">${remote ? 'Ничего не найдено' : 'Нет товаров в наличии'}</div>`;
    list.querySelectorAll('[data-pid]').forEach(el => el.addEventListener('click', () => {
      const pid = el.dataset.pid; const stub = Array.isArray(remote) ? remote.find(x => x.id === pid) : null;
      assign(sl, pid, stub);
    }));
  };
  draw(local);
  let t = null;
  const q = $('pkQ'); q.focus();
  const run = async () => {
    const v = q.value.trim().toLowerCase();
    if (!v) return draw(local);
    const loc = local.filter(p => (p.name || '').toLowerCase().includes(v) || (p.sku || '').toLowerCase().includes(v));
    if (loc.length && !/^\d{8,14}$/.test(v)) draw(loc);
    try {
      const d = await api(`?action=planogram-search&q=${encodeURIComponent(q.value.trim())}`);
      const arr = (d.products || []).map(r => S.products.get(r.id) || { ...r, here: 0 });
      const merged = [...loc, ...arr.filter(a => !loc.find(l => l.id === a.id))];
      draw(merged, d.products || []);
      if (/^\d{8,14}$/.test(v) && arr.length === 1) assign(sl, arr[0].id, d.products[0]);
    } catch (e) { if (!loc.length) list.innerHTML = `<div class="pg-empty">Ошибка поиска: ${esc(e.message)}</div>`; }
  };
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 300); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(t); run(); } });
  $('pkClose').addEventListener('click', closeModal);
}
function openNotPlaced(arr) {
  const m = $('pgModal'); m.hidden = false;
  m.innerHTML = `<div class="pg-mbox"><h3>В наличии, но не выставлено (${arr.length})</h3><div class="pg-sub">Отсортировано по продажам за 30 дней. Выберите пустое место на полке, затем «Привязать товар».</div>
    <div class="pg-mlist"><div class="pg-list">${arr.map(p => `<div class="pg-li" style="cursor:default">${prodThumb(p)}<div class="t"><b>${esc(p.name)}</b><small>${esc(p.category || '')} · продано 30 дн.: ${p.sold30}</small></div><div class="n">${p.here} пар</div></div>`).join('')}</div></div>
    <div class="pg-row" style="justify-content:flex-end;margin-top:10px"><button class="pg-btn" id="npClose">Закрыть</button></div></div>`;
  $('npClose').addEventListener('click', closeModal);
}

// ═══════════════════════ общий рендер ═══════════════════════
function renderKpis() {
  const fxs = zoneFx(S.zone).filter(f => TYPES[f.type].shelves);
  let slots = 0, empty = 0, low = 0, out = 0; const ids = new Set();
  fxs.forEach(f => f.shelves.forEach(sh => sh.slots.forEach(sl => { slots++; const st = slotStatus(sl); if (st === 'empty') empty++; else ids.add(sl.p); if (st === 'low') low++; if (st === 'out') out++; })));
  let pairs = 0; ids.forEach(id => { const p = S.products.get(id); if (p) pairs += p.here || 0; });
  const placed = placedIds();
  const notPlaced = [...S.products.values()].filter(p => p.here > 0 && !placed.has(p.id));
  const totalHere = [...S.products.values()].reduce((a, p) => a + (p.here || 0), 0);
  $('pgKpis').innerHTML = `
    <div class="pg-kpi"><small>Моделей ${S.zone === 'hall' ? 'на витрине' : 'на складе'}</small><b>${ids.size}</b></div>
    <div class="pg-kpi"><small>Пар этих моделей в магазине</small><b>${fmt(pairs)}</b></div>
    <div class="pg-kpi"><small>Мест на полках</small><b>${slots}</b></div>
    <div class="pg-kpi ${empty ? 'warn' : ''}"><small>Пустых мест</small><b>${empty}</b></div>
    <div class="pg-kpi ${low ? 'warn' : ''}"><small>Мало остатков (≤2)</small><b>${low}</b></div>
    <div class="pg-kpi ${out ? 'bad' : ''}"><small>Нет в магазине</small><b>${out}</b></div>
    <div class="pg-kpi click" id="kNp"><small>В наличии, не выставлено</small><b>${notPlaced.length}</b></div>
    <div class="pg-kpi"><small>Всего пар в магазине</small><b>${fmt(totalHere)}</b></div>`;
  $('kNp').addEventListener('click', () => openNotPlaced(notPlaced.sort((a, b) => (b.sold30 - a.sold30) || (b.here - a.here))));
}
function hint() {
  const el = $('pgHint');
  let t = '';
  if (S.shapeEdit) t = 'Форма помещения: тяните синие углы, «+» на стене — добавить угол';
  else if (S.edit) t = S.view === '3d' && S.zone === 'hall' ? 'Перетаскивайте шкафы мышью/пальцем · вращение камеры — по пустому месту' : 'Перетаскивайте шкафы · синий кружок — поворот';
  el.textContent = t; el.style.display = t ? 'block' : 'none';
}
function renderAll(rebuild3d) {
  if (!S.layout) return;
  const stage = $('pgStage');
  const is3d = S.zone === 'hall' && S.view === '3d';
  stage.classList.toggle('v2d', !is3d);
  document.querySelectorAll('#pgViewSeg button').forEach(b => { b.classList.toggle('on', b.dataset.view === (S.zone === 'hall' ? S.view : '2d')); b.disabled = S.zone !== 'hall' && b.dataset.view === '3d'; });
  document.querySelectorAll('#pgZoneSeg button').forEach(b => b.classList.toggle('on', b.dataset.zone === S.zone));
  if (is3d && rebuild3d !== false) build3d(false);
  render2d();
  renderPanel();
  renderKpis();
  hint();
  if (is3d) setTimeout(resize3d, 0);
}
function select(sel) {
  S.sel = sel;
  if (sel && sel.k === 'fx' && S.view === '3d') {/* камера остаётся */}
  renderAll(true);
}
function setView(v) { S.view = v; if (v === '3d') S.shapeEdit = false; renderAll(true); }

// ─────────── шапка ───────────
$('pgStore').innerHTML = STORES.map(s => `<option value="${s.wh}" ${s.active ? '' : 'disabled'}>${esc(s.name)}${s.active ? '' : ' — скоро'}</option>`).join('');
$('pgStore').addEventListener('change', (e) => {
  if (S.dirty && !confirm('Есть несохранённые изменения. Перейти без сохранения?')) { e.target.value = S.wh; return; }
  S.wh = e.target.value; S.sel = null; S.layout = null; G.built = false; loadAll();
});
document.querySelectorAll('#pgZoneSeg button').forEach(b => b.addEventListener('click', () => { S.zone = b.dataset.zone; S.sel = null; S.shapeEdit = false; if (S.zone === 'hall' && !S.view) S.view = '3d'; renderAll(true); }));
document.querySelectorAll('#pgViewSeg button').forEach(b => b.addEventListener('click', () => { if (!b.disabled) setView(b.dataset.view); }));
$('pgEdit').addEventListener('change', (e) => { S.edit = e.target.checked; if (!S.edit) S.shapeEdit = false; renderAll(true); });
$('pgSave').addEventListener('click', save);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (S.dirty) save(); }
  if (e.key === 'Delete' && S.edit && S.sel && S.sel.k === 'fx' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { const b = $('fDel'); if (b) b.click(); }
});

if (USER) {
  try { init3d(); } catch (e) { console.error(e); toast('3D недоступно на этом устройстве — открыт 2D план', true); S.view = '2d'; }
  loadAll();
}
