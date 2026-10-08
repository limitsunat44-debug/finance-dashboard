// ═══════════════════════════════════════════════════════════════════
//  РМК · ПЛАНОГРАММА МАГАЗИНА
//  Торговый зал — 3D + 2D, склад — 2D. Шкафы → полки → места → товар.
//  Остатки и продажи — живые из РМК (stock_units), цвет места = статус остатка.
//  Хранение: backend ?action=planogram-get / planogram-save (app_state planogram:<wh>).
// ═══════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
const ST_COLOR = { ok: '#16a34a', low: '#f59e0b', out: '#dc2626', restock: '#7c3aed', slow: '#64748b', empty: '#cbd5e1' };
const ST_LABEL = { ok: 'Хорошо', low: 'Мало остатков', out: 'Нет в магазине', restock: 'Нет на витрине — есть на складе', slow: 'Нет продаж 30 дн.', empty: 'Пустое место' };
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

// ─────────── QR полок ───────────
// id полки = <id шкафа>-<номер полки, 1 = нижняя>. QR открывает состав полки (shelf.html),
// а касса РМК по этому QR включает привязку товара к полке.
const SHELF_URL = 'https://finance-orto.vercel.app/s';
const shelfSid = (fx, si) => `${fx.id}-${si + 1}`;
const shelfUrl = (fx, si) => `${SHELF_URL}/${S.wh.slice(0, 8)}/${shelfSid(fx, si)}`;
const shelfPos = (fx, si) => { const n = (fx.shelves || []).length; return n > 1 ? (si === 0 ? ' · низ' : si === n - 1 ? ' · верх' : '') : ''; };
const shelfName = (fx, si) => `${fx.name} · Полка ${si + 1}`;
const storeName = () => (STORES.find(s => s.wh === S.wh) || {}).name || '';
const QRM = new Map();
function qrMatrix(text) {
  if (QRM.has(text)) return QRM.get(text);
  if (!window.qrcode) return null;
  const q = window.qrcode(0, 'L'); q.addData(text); q.make();
  const n = q.getModuleCount(); const m = [];
  for (let r = 0; r < n; r++) { const row = []; for (let c = 0; c < n; c++) row.push(q.isDark(r, c)); m.push(row); }
  QRM.set(text, m); return m;
}
function drawQr(ctx, text, x, y, size) {
  const m = qrMatrix(text); if (!m) return;
  const n = m.length + 2; const cell = Math.max(1, Math.floor(size / n)); const off = Math.floor((size - cell * n) / 2) + cell;
  ctx.fillStyle = '#fff'; ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#000';
  m.forEach((row, r) => row.forEach((d, c) => { if (d) ctx.fillRect(x + off + c * cell, y + off + r * cell, cell, cell); }));
}
const QRURL = new Map();
function qrDataUrl(text) {
  if (QRURL.has(text)) return QRURL.get(text);
  const c = document.createElement('canvas'); c.width = c.height = 240;
  drawQr(c.getContext('2d'), text, 0, 0, 240);
  const u = c.toDataURL('image/png'); QRURL.set(text, u); return u;
}
function fitFont(ctx, text, maxW, size, weight) {
  let s = size;
  do { ctx.font = `${weight} ${s}px Manrope, Arial, sans-serif`; if (ctx.measureText(text).width <= maxW) break; s -= 1; } while (s > 6);
  return s;
}
// Этикетка 40×52 мм: сверху название шкафа и «Полка N», ниже QR, внизу магазин и код полки. k — пикселей на мм.
function labelCanvas(fx, si, k) {
  const W = 40, H = 52;
  const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = '#0f172a'; x.lineWidth = Math.max(1, k * 0.35);
  x.strokeRect(k * 0.6, k * 0.6, c.width - k * 1.2, c.height - k * 1.2);
  x.textAlign = 'center'; x.textBaseline = 'alphabetic'; x.fillStyle = '#0f172a';
  fitFont(x, fx.name, k * 35, Math.round(k * 4.4), 700); x.fillText(fx.name, c.width / 2, k * 6.6);
  const t2 = `Полка ${si + 1}${shelfPos(fx, si)}`;
  fitFont(x, t2, k * 35, Math.round(k * 6.2), 800); x.fillText(t2, c.width / 2, k * 13.8);
  drawQr(x, shelfUrl(fx, si), Math.round(k * 5), Math.round(k * 15.2), Math.round(k * 30));
  x.fillStyle = '#475569';
  const t3 = `${storeName()} · ${shelfSid(fx, si)}`;
  fitFont(x, t3, k * 36, Math.round(k * 2.4), 600); x.fillText(t3, c.width / 2, k * 49.4);
  return c;
}
function fileSafe(s) { return String(s).replace(/[\\/:*?"<>|«»]+/g, '').replace(/\s+/g, ' ').trim(); }
function downloadPng(fx, si) {
  const c = labelCanvas(fx, si, 16);
  c.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = fileSafe(`QR ${fx.name} - полка ${si + 1}.png`); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, 'image/png');
}
let jspdfP = null;
function loadJsPdf() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (!jspdfP) jspdfP = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'; s.onload = () => res(window.jspdf.jsPDF); s.onerror = () => { jspdfP = null; rej(new Error('Не загрузилась библиотека PDF')); }; document.head.appendChild(s); });
  return jspdfP;
}
// A4: сетка 4×5 этикеток 40×52 мм, пунктир — линии реза.
async function downloadPdf(list, title) {
  if (!list.length) return toast('Нет полок для печати', true);
  toast('Готовлю PDF с QR полок…');
  try {
    const JsPDF = await loadJsPdf();
    const doc = new JsPDF({ unit: 'mm', format: 'a4' });
    doc.setProperties({ title: `QR полок — ${title}`, author: 'РМК · Планограмма' });
    const LW = 40, LH = 52, GX = 5, GY = 4, CO = 4, RO = 5;
    const mx = (210 - (CO * LW + (CO - 1) * GX)) / 2, my = (297 - (RO * LH + (RO - 1) * GY)) / 2;
    list.forEach(([fx, si], i) => {
      const k = i % (CO * RO); if (i && !k) doc.addPage();
      const x = mx + (k % CO) * (LW + GX), y = my + Math.floor(k / CO) * (LH + GY);
      doc.addImage(labelCanvas(fx, si, 12).toDataURL('image/png'), 'PNG', x, y, LW, LH, undefined, 'FAST');
      doc.setDrawColor(170); doc.setLineWidth(0.15); doc.setLineDashPattern([1, 1], 0); doc.rect(x - 1, y - 1, LW + 2, LH + 2); doc.setLineDashPattern([], 0);
    });
    doc.save(fileSafe(`QR полок - ${title}.pdf`));
  } catch (e) { toast('PDF не создан: ' + e.message, true); }
}
// ─────────── журнал привязок ───────────
const fmtTs = (iso) => { try { return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return iso || ''; } };
const LOG_ACT = { bind: ['📍', 'Привязал(а) пару'], move: ['↪️', 'Перенёс(ла) пару'], unbind: ['✖', 'Отвязал(а) пару'], remove: ['🗑', 'Убрал(а) модель'], edit: ['✏️', 'Изменил(а) планограмму в редакторе'] };
function logRow(e, withShelf) {
  const [ico, t] = LOG_ACT[e.act] || ['•', e.act];
  const what = e.act === 'edit' ? `версия ${e.v || ''}` : `${esc(e.name || '')}${e.size && e.size !== '—' ? ' · р. ' + esc(e.size) : ''}${e.bc ? ' · №' + esc(String(e.bc).split(',').map(x => x.slice(-6)).join(', ')) : ''}`;
  return `<div class="pg-log"><div class="pg-log-ico">${ico}</div><div class="pg-log-t"><b>${esc(e.by || '—')}</b> <span>${t}</span><small>${what}${withShelf && e.shelf ? ` → <b>${esc(e.shelf)}</b>` : ''}${e.from ? ` (с: ${esc(e.from)})` : ''}${e.warn ? `<br>⚠ ${esc(e.warn)}` : ''}${e.restored ? '<br><i>восстановлено по истории версий</i>' : ''}</small></div><div class="pg-log-ts">${fmtTs(e.ts)}</div></div>`;
}
async function openLog() {
  const m = $('pgModal'); m.hidden = false;
  m.innerHTML = `<div class="pg-mbox"><h3>Журнал привязок полок</h3><div class="pg-sub" style="margin-bottom:8px">${esc(storeName())} · кто и когда привязал пару к полке, отвязал или изменил планограмму. Время — Душанбе/Ташкент.</div>
    <input class="pg-search" id="lgQ" placeholder="Фильтр: продавец, товар, полка, цифры штрихкода" autocomplete="off">
    <div class="pg-mlist" id="lgList"><div class="pg-empty">⏳ загружаю…</div></div>
    <div class="pg-row" style="justify-content:flex-end;margin-top:10px"><button class="pg-btn" id="lgClose">Закрыть</button></div></div>`;
  $('lgClose').addEventListener('click', closeModal);
  let all = [];
  const draw = () => {
    const v = $('lgQ').value.trim().toLowerCase();
    const arr = v ? all.filter(e => [e.by, e.name, e.shelf, e.bc, e.size].join(' ').toLowerCase().includes(v)) : all;
    $('lgList').innerHTML = arr.length ? arr.slice(0, 500).map(e => logRow(e, true)).join('') : '<div class="pg-empty">Записей нет</div>';
  };
  $('lgQ').addEventListener('input', draw);
  try { const d = await api(`?action=planogram-log&wh=${S.wh}&limit=2000`); all = d.entries || []; draw(); }
  catch (e) { $('lgList').innerHTML = `<div class="pg-empty">Не загрузилось: ${esc(e.message)}</div>`; }
}
async function loadShelfLog(fx, si) {
  const el = $('sqLog'); if (!el) return;
  try {
    const d = await api(`?action=planogram-log&wh=${S.wh}&s=${shelfSid(fx, si)}&limit=50`);
    const box = $('sqLog'); if (!box) return;
    S.shelfLog = {}; (d.entries || []).slice().reverse().forEach(e => { if ((e.act === 'bind' || e.act === 'move') && e.bc) S.shelfLog[e.bc] = e; });
    box.innerHTML = (d.entries || []).length ? d.entries.map(e => logRow(e, false)).join('') : '<div class="pg-empty">Привязок с кассы по этой полке ещё не было</div>';
    document.querySelectorAll('[data-ubc]').forEach(c => { const e = S.shelfLog[c.dataset.ubc]; if (e) c.title += ` · привязал(а) ${e.by || '—'} ${fmtTs(e.ts)}`; });
  } catch (e) { const box = $('sqLog'); if (box) box.innerHTML = `<div class="pg-empty">Журнал не загрузился: ${esc(e.message)}</div>`; }
}
function shelvesOf(fxs) { const out = []; fxs.forEach(fx => (fx.shelves || []).forEach((_, si) => out.push([fx, si]))); return out; }
// модели «нет на витрине — есть на складе»: привязанная сканом пара продана/ушла, а модель ещё есть в магазине
function restockSlots() {
  const out = [];
  zoneFx('hall').forEach(fx => (fx.shelves || []).forEach((sh, si) => sh.slots.forEach((sl, ki) => { if (slotStatus(sl) === 'restock') out.push({ fx, si, ki, sl, p: S.products.get(sl.p) }); })));
  return out;
}
function stockPlace(pid) {
  for (const fx of zoneFx('stock')) for (let si = 0; si < (fx.shelves || []).length; si++) if (fx.shelves[si].slots.some(s => s.p === pid)) return `${fx.name} · полка ${si + 1}`;
  return '';
}
function notOnDisplay() {
  const hall = placedIds('hall');
  return [...S.products.values()].filter(p => p.here > 0 && !hall.has(p.id)).sort((a, b) => (b.sold30 - a.sold30) || (b.here - a.here));
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
  units: {},            // штрихкод привязанной сканом пары -> {st, here, size}
  showQr: localStorage.getItem('pg_show_qr') !== '0',
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
  if (Array.isArray(slot.u) && slot.u.length) {
    const live = slot.u.filter(bc => S.units[bc] && S.units[bc].here).length;
    if (!live) return p && p.here > 0 ? 'restock' : 'out';
  }
  if (!p || !p.here) return 'out';
  if (p.here <= 2) return 'low';
  if (!p.sold30) return 'slow';
  return 'ok';
}
function zoneFx(zone) { return S.layout.fixtures.filter(f => f.zone === zone); }
function fxById(id) { return S.layout.fixtures.find(f => f.id === id); }
function fxStats(fx) {
  const ids = new Set(); let empty = 0, low = 0, out = 0, slots = 0, restock = 0;
  (fx.shelves || []).forEach(sh => sh.slots.forEach(sl => {
    slots++; const st = slotStatus(sl);
    if (st === 'empty') empty++; else ids.add(sl.p);
    if (st === 'low') low++; if (st === 'out') out++; if (st === 'restock') restock++;
  }));
  let pairs = 0, sold30 = 0;
  ids.forEach(id => { const p = S.products.get(id); if (p) { pairs += p.here || 0; sold30 += p.sold30 || 0; } });
  return { models: ids.size, pairs, sold30, empty, low, out, slots, restock };
}
function placedIds(zone) {
  const s = new Set();
  S.layout.fixtures.forEach(f => { if (zone && f.zone !== zone) return; (f.shelves || []).forEach(sh => sh.slots.forEach(sl => { if (sl.p) s.add(sl.p); })); });
  return s;
}
function worstStatus(list) {
  const order = ['out', 'restock', 'low', 'slow', 'ok', 'empty'];
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
  S.units = d.units || {};
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
if (/[?&]debug=1/.test(location.search)) window.__pg = { G, S };
const SHARED_GEO = new Set();
function init3d() {
  const host = $('pg3d');
  G.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  G.renderer.setPixelRatio(Math.min(window.devicePixelRatio, innerWidth < 900 ? 1.75 : 2));
  G.renderer.shadowMap.enabled = true;
  G.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  G.renderer.outputColorSpace = THREE.SRGBColorSpace;
  G.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  G.renderer.toneMappingExposure = 1.02;
  host.appendChild(G.renderer.domElement);
  G.label = new CSS2DRenderer();
  G.label.domElement.style.position = 'absolute'; G.label.domElement.style.inset = '0'; G.label.domElement.style.pointerEvents = 'none';
  host.appendChild(G.label.domElement);
  G.scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(G.renderer);
  G.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  G.scene.environmentIntensity = 0.45;
  G.cam = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
  G.ctl = new OrbitControls(G.cam, G.renderer.domElement);
  G.ctl.enableDamping = true; G.ctl.maxPolarAngle = 1.32; G.ctl.minDistance = 2; G.ctl.maxDistance = 45;
  G.scene.add(new THREE.HemisphereLight(0xffffff, 0xe7ecf3, 0.55));
  const sun = new THREE.DirectionalLight(0xfffaf2, 2.1);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 0.5, far: 60 });
  G.sun = sun; G.scene.add(sun); G.scene.add(sun.target);
  const fill = new THREE.DirectionalLight(0xe8f0ff, 0.35); fill.position.set(-10, 8, -6); G.scene.add(fill);
  const ro = new ResizeObserver(resize3d); ro.observe(host);
  bind3dPointer();
  (function loop() {
    requestAnimationFrame(loop);
    if (S.view !== '3d' || S.zone !== 'hall') return;
    G.ctl.update();
    updateWallFade();
    G.renderer.render(G.scene, G.cam);
    G.label.render(G.scene, G.cam);
    if ((G.fr = (G.fr || 0) + 1) % 8 === 0) declutter();
  })();
}
function declutter() {
  const els = [...document.querySelectorAll('#pg3d .pg-cat')];
  els.forEach(e => { e.style.marginTop = '0px'; });
  const rs = els.map(e => ({ e, r: e.getBoundingClientRect() })).sort((a, b) => a.r.top - b.r.top);
  for (let i = 0; i < rs.length; i++) for (let j = 0; j < i; j++) {
    const A = rs[j].r, B = rs[i].r;
    if (A.left < B.right && B.left < A.right && A.top < B.bottom && B.top < A.bottom) {
      const dy = A.bottom - B.top + 6; rs[i].e.style.marginTop = dy + 'px';
      rs[i].r = rs[i].e.getBoundingClientRect();
    }
  }
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
  if (!MAT[k]) MAT[k] = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.0, ...(o || {}) });
  return MAT[k];
}
function pmat(key, make) { if (!MAT[key]) MAT[key] = make(); return MAT[key]; }
const TEX = {};
function canvasTex(key, w, h, draw, repeat) {
  if (TEX[key]) return TEX[key];
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  TEX[key] = t; return t;
}
function floorTex() {
  // глянцевая светлая плитка 60×60 (текстура = 1.2×1.2 м)
  return canvasTex('floor', 512, 512, (x, w, h) => {
    const tones = ['#f2ece2', '#efe8dc', '#f3eee6', '#ede5d8'];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      x.fillStyle = tones[i * 2 + j]; x.fillRect(i * 256, j * 256, 256, 256);
      const g = x.createLinearGradient(i * 256, j * 256, i * 256 + 256, j * 256 + 256);
      g.addColorStop(0, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(0,0,0,.025)');
      x.fillStyle = g; x.fillRect(i * 256, j * 256, 256, 256);
    }
    x.strokeStyle = '#d3c8b8'; x.lineWidth = 4;
    for (let k = 0; k <= 2; k++) { x.beginPath(); x.moveTo(k * 256, 0); x.lineTo(k * 256, h); x.stroke(); x.beginPath(); x.moveTo(0, k * 256); x.lineTo(w, k * 256); x.stroke(); }
  }, true);
}
function woodTex() {
  return canvasTex('wood', 256, 256, (x, w, h) => {
    x.fillStyle = '#d8bf9c'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { x.strokeStyle = `rgba(${120 + Math.random() * 40},${85 + Math.random() * 30},${50},${0.08 + Math.random() * 0.1})`; x.lineWidth = 1 + Math.random() * 2; const y = Math.random() * h; x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(w * 0.3, y + 6 * Math.random(), w * 0.6, y - 6 * Math.random(), w, y + 3); x.stroke(); }
  }, true);
}
function pegTex() {
  return canvasTex('peg', 128, 128, (x, w, h) => {
    x.fillStyle = '#f8fafc'; x.fillRect(0, 0, w, h); x.fillStyle = '#cbd5e1';
    for (let i = 8; i < w; i += 16) for (let j = 8; j < h; j += 16) { x.beginPath(); x.arc(i, j, 2.2, 0, 7); x.fill(); }
  }, true);
}
function blobTex() {
  return canvasTex('blob', 128, 128, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(15,23,42,.55)'); g.addColorStop(0.6, 'rgba(15,23,42,.25)'); g.addColorStop(1, 'rgba(15,23,42,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  });
}
function posterTex(i) {
  const P = [
    { bg1: '#eef6ff', bg2: '#dbeafe', t1: 'КОМФОРТ', t2: 'ПОДДЕРЖКА', t3: 'КАЖДЫЙ ДЕНЬ', ic: '🦶' },
    { bg1: '#fff7ed', bg2: '#ffedd5', t1: 'ЗДОРОВЫЕ', t2: 'СТОПЫ', t3: 'С ДЕТСТВА', ic: '👟' },
    { bg1: '#f0fdf4', bg2: '#dcfce7', t1: 'ОРТОПЕДИЯ', t2: 'ДЛЯ ВСЕЙ', t3: 'СЕМЬИ', ic: '✚' },
  ][i % 3];
  return canvasTex('poster' + (i % 3), 256, 384, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, P.bg1); g.addColorStop(1, P.bg2);
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.font = '120px sans-serif'; x.textAlign = 'center'; x.fillStyle = '#7c3aed'; x.globalAlpha = 0.85; x.fillText(P.ic, w / 2, 170); x.globalAlpha = 1;
    x.fillStyle = '#1e293b'; x.font = 'bold 30px Manrope, sans-serif';
    x.fillText(P.t1, w / 2, 260); x.fillText(P.t2, w / 2, 298); x.fillText(P.t3, w / 2, 336);
  });
}
function logoTex() {
  const st = STORES.find(s => s.wh === S.wh); const nm = (st ? st.name : '').replace(/^Ортосалон\s*/, '');
  return canvasTex('logo' + S.wh, 512, 256, (x, w, h) => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#2563eb'; const r = 26, X = 40, Y = 64, S2 = 128;
    x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + S2, Y, X + S2, Y + S2, r); x.arcTo(X + S2, Y + S2, X, Y + S2, r); x.arcTo(X, Y + S2, X, Y, r); x.arcTo(X, Y, X + S2, Y, r); x.fill();
    x.fillStyle = '#fff'; x.font = 'bold 44px Manrope, sans-serif'; x.textAlign = 'center'; x.fillText('РМК', X + S2 / 2, Y + 82);
    x.textAlign = 'left'; x.fillStyle = '#0f172a'; x.font = 'bold 50px Manrope, sans-serif'; x.fillText('Ортосалон', 196, 120);
    x.fillStyle = '#475569'; x.font = '36px Manrope, sans-serif'; x.fillText(nm || 'Smart Store', 196, 168);
  });
}
function photoTex(url) {
  if (!url) return null;
  if (G.tex.has(url)) return G.tex.get(url);
  const t = new THREE.TextureLoader().load(url, () => {}, undefined, () => {});
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  G.tex.set(url, t);
  return t;
}
// ── обувь: процедурная пара, цвет — средний цвет фото товара ──
let SHOE = null;
function shoeGeo() {
  if (SHOE) return SHOE;
  const sole = new RoundedBoxGeometry(0.086, 0.022, 0.25, 2, 0.008); sole.translate(0, 0.011, 0);
  const toe = new THREE.SphereGeometry(1, 18, 12); toe.scale(0.042, 0.034, 0.088); toe.translate(0, 0.034, 0.045);
  const mid = new THREE.SphereGeometry(1, 18, 12); mid.scale(0.043, 0.046, 0.085); mid.translate(0, 0.046, -0.035);
  const collar = new THREE.CylinderGeometry(0.035, 0.041, 0.05, 18); collar.translate(0, 0.078, -0.078);
  const upper = mergeGeometries([toe, mid, collar]);
  SHOE = { sole, upper }; SHARED_GEO.add(sole); SHARED_GEO.add(upper);
  return SHOE;
}
const PMAT = new Map();
function prodMat(p) {
  if (PMAT.has(p.id)) return PMAT.get(p.id);
  const m = new THREE.MeshStandardMaterial({ color: '#3f444c', roughness: 0.5, metalness: 0.05 });
  PMAT.set(p.id, m);
  if (p.photo) {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 48; const x = c.getContext('2d');
        x.drawImage(img, 0, 0, 48, 48); const d = x.getImageData(6, 6, 36, 36).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const R = d[i], Gg = d[i + 1], B = d[i + 2];
          if (d[i + 3] < 128) continue;
          if (Math.min(R, Gg, B) > 222) continue; // белый фон
          r += R; g += Gg; b += B; n++;
        }
        if (n > 25) m.color.setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
      } catch (_) {}
    };
    img.src = p.photo;
  }
  return m;
}
const isShoe = (p) => /обув|кед|ботин|туфл|сандал|кросс|сапог|тапоч|шлеп|мокас|балет|босонож/i.test((p.category || '') + ' ' + (p.name || ''));
function shoePair(p, ud, s) {
  const { sole, upper } = shoeGeo();
  const g = new THREE.Group();
  const um = prodMat(p);
  const sm = mat('#f1f5f9', { roughness: 0.6 });
  [[-0.05, 0.02, 0.12], [0.05, -0.02, -0.12]].forEach(([x, z, ry]) => {
    const a = new THREE.Mesh(sole, sm); const b = new THREE.Mesh(upper, um);
    [a, b].forEach(m => { m.position.set(x, 0, z); m.rotation.y = ry; m.castShadow = true; m.userData = ud; g.add(m); G.pick.push(m); });
  });
  g.scale.setScalar(s);
  return g;
}
function prodBox(p, ud, w, both) {
  const tex = p.photo ? photoTex(p.photo) : null;
  const side = mat('#e2e8f0');
  const front = tex ? pmat('ph:' + p.photo, () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 })) : mat('#94a3b8');
  const bw = Math.min(0.2, w), bh = bw * 1.15, bd = 0.07;
  const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), [side, side, side, side, front, both ? front : side]);
  m.position.y = bh / 2; m.castShadow = true; m.userData = ud; G.pick.push(m);
  return m;
}
// ── сборка сцены ──
function disposeRoot() {
  if (!G.root) return;
  G.root.traverse(o => {
    if (o.isCSS2DObject && o.element && o.element.parentNode) o.element.parentNode.removeChild(o.element);
    if (o.geometry && !SHARED_GEO.has(o.geometry)) o.geometry.dispose();
  });
  G.scene.remove(G.root);
}
function build3d(resetCam) {
  if (!G.scene) return;
  disposeRoot();
  G.root = new THREE.Group(); G.scene.add(G.root);
  G.walls = []; G.pick = []; G.backs = []; G.tool = null;
  const z = S.layout.zones.hall;
  const pts = z.polygon;
  const H = z.wallH || 3, T = 0.22, LOW = 0.7;
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const b = polyBounds(pts); const span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  // земля с мягкой тенью здания
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 4, span * 4), new THREE.ShadowMaterial({ opacity: 0.12 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(cx, -0.16, cy); ground.receiveShadow = true; G.root.add(ground);
  // цоколь
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, -y)));
  const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.15, bevelEnabled: false }), mat('#c9d0da'));
  slab.rotation.x = -Math.PI / 2; slab.position.y = -0.155; slab.castShadow = true; G.root.add(slab);
  // пол — глянцевая плитка
  const fg = new THREE.ShapeGeometry(shape);
  const uv = fg.attributes.uv, pos = fg.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 1.2, pos.getY(i) / 1.2);
  const floor = new THREE.Mesh(fg, pmat('floorMat', () => new THREE.MeshPhysicalMaterial({ map: floorTex(), roughness: 0.22, clearcoat: 0.7, clearcoatRoughness: 0.12, metalness: 0 })));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.userData.floor = true;
  G.root.add(floor); G.floor = floor;
  // стены: нижний пояс всегда, верх прячется, если стена между камерой и залом
  const wallM = mat('#f3f1ed', { roughness: 0.92 });
  const outM = mat('#dfe3ea', { roughness: 0.9 });
  const capM = mat('#4b5563', { roughness: 0.6 });
  const wallFx = zoneFx('hall').filter(f => f.type === 'wall' || f.type === 'mirror' || f.type === 'rack');
  let posterN = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
    if (len < 0.05) return;
    const ux = dx / len, uy = dy / len;
    let nx = -uy, ny = ux;
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
    const door = z.door && z.door.edge === i ? z.door : null;
    const segs = [];
    let d0 = null, d1 = null;
    if (door) {
      d0 = door.t * len - door.w / 2; d1 = door.t * len + door.w / 2;
      if (d0 > 0.02) segs.push([-T, d0]); else d0 = 0;
      if (d1 < len - 0.02) segs.push([d1, len + T]); else d1 = len;
    } else segs.push([-T, len + T]);
    const ang = -Math.atan2(dy, dx);
    const at = (s, off, y) => new THREE.Vector3(p[0] + ux * s + nx * off, y, p[1] + uy * s + ny * off);
    const entry = { u: { nx, ny, x: mx + nx * T / 2, y: my + ny * T / 2 }, upper: new THREE.Group(), capLow: new THREE.Group() };
    entry.capLow.visible = false;
    const box = (l, h, t, s, off, y, m, grp) => { const o = new THREE.Mesh(new THREE.BoxGeometry(l, h, t), m); o.position.copy(at(s, off, y)); o.rotation.y = ang; o.castShadow = true; o.receiveShadow = true; (grp || G.root).add(o); return o; };
    segs.forEach(([a, c]) => {
      const l = c - a, sMid = (a + c) / 2;
      box(l, LOW, T, sMid, T / 2, LOW / 2, outM);
      // внутренняя облицовка нижнего пояса
      box(l - (a < 0 ? 0 : 0), LOW, 0.005, sMid, 0.002, LOW / 2, wallM);
      box(l + 0.02, 0.06, T + 0.02, sMid, T / 2, LOW + 0.03, capM, entry.capLow);
      box(l, H - LOW, T, sMid, T / 2, LOW + (H - LOW) / 2, outM, entry.upper);
      box(l, H - LOW, 0.005, sMid, 0.002, LOW + (H - LOW) / 2, wallM, entry.upper);
      box(l + 0.02, 0.08, T + 0.02, sMid, T / 2, H + 0.04, capM, entry.upper);
      // трековые светильники
      const s0 = Math.max(0, a), s1 = Math.min(len, c);
      if (s1 - s0 > 0.6) {
        box(s1 - s0 - 0.2, 0.03, 0.03, (s0 + s1) / 2, -0.32, H - 0.12, mat('#111827'), entry.upper);
        for (let s = s0 + 0.5; s < s1 - 0.3; s += 1.1) {
          const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.12, 12), mat('#1f2937', { roughness: 0.4 }));
          sp.position.copy(at(s, -0.32, H - 0.2)); sp.rotation.set(0.5 * (1), ang, 0, 'YXZ'); entry.upper.add(sp);
          const lens = new THREE.Mesh(new THREE.CircleGeometry(0.03, 12), mat('#fff7e0', { emissive: '#fff3c4', emissiveIntensity: 1.5 }));
          lens.position.copy(at(s, -0.32, H - 0.265)); lens.rotation.set(-Math.PI / 2 + 0.5, ang, 0, 'YXZ'); entry.upper.add(lens);
        }
      }
    });
    // постеры в свободных промежутках стены
    const occ = wallFx.map(f => {
      const dist = Math.abs((f.x - p[0]) * nx + (f.y - p[1]) * ny); if (dist > 0.6) return null;
      const s = (f.x - p[0]) * ux + (f.y - p[1]) * uy; const hw = Math.abs(f.w / 2 * Math.cos((f.rot * Math.PI / 180) - Math.atan2(dy, dx))) + Math.abs(f.d / 2 * Math.sin((f.rot * Math.PI / 180) - Math.atan2(dy, dx)));
      return [s - hw, s + hw];
    }).filter(Boolean);
    if (door) occ.push([d0 - 0.2, d1 + 0.2]);
    occ.sort((A, B) => A[0] - B[0]);
    let cur = 0.3; const gaps = [];
    occ.forEach(([a1, b1]) => { if (a1 - cur >= 0.9) gaps.push([cur, a1]); cur = Math.max(cur, b1); });
    if (len - 0.3 - cur >= 0.9) gaps.push([cur, len - 0.3]);
    gaps.forEach(([g0, g1]) => {
      const s = (g0 + g1) / 2;
      const fr = new THREE.Mesh(new THREE.BoxGeometry(0.74, 1.08, 0.03), mat('#1f2937'));
      fr.position.copy(at(s, -0.02, 1.75)); fr.rotation.y = ang; entry.upper.add(fr);
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.04), pmat('posterM' + (posterN % 3), () => new THREE.MeshStandardMaterial({ map: posterTex(posterN), roughness: 0.5 })));
      pm.position.copy(at(s, -0.037, 1.75)); pm.rotation.y = ang + Math.PI; entry.upper.add(pm);
      // постер смотрит внутрь зала (нормаль -n)
      pm.lookAt(at(s, -1, 1.75));
      fr.lookAt(at(s, -1, 1.75));
      posterN++;
    });
    if (door) {
      const sm = (d0 + d1) / 2, dw = d1 - d0;
      const frameM = mat('#9ca3af', { metalness: 0.7, roughness: 0.3 });
      box(dw, H - 2.25, T, sm, T / 2, 2.25 + (H - 2.25) / 2, outM, entry.upper);
      box(dw + 0.02, 0.08, T + 0.02, sm, T / 2, H + 0.04, capM, entry.upper);
      box(dw, 0.06, 0.08, sm, T / 2, 2.22, frameM);
      box(0.06, 2.25, 0.08, d0 + 0.03, T / 2, 1.125, frameM);
      box(0.06, 2.25, 0.08, d1 - 0.03, T / 2, 1.125, frameM);
      box(0.04, 2.2, 0.06, sm, T / 2, 1.1, frameM);
      const glass = pmat('glass', () => new THREE.MeshPhysicalMaterial({ color: '#dbeafe', transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0, clearcoat: 1 }));
      [d0 + dw / 4, d1 - dw / 4].forEach(s => { const gl = new THREE.Mesh(new THREE.BoxGeometry(dw / 2 - 0.08, 2.15, 0.015), glass); gl.position.copy(at(s, T / 2, 1.1)); gl.rotation.y = ang; G.root.add(gl); });
      [sm - 0.1, sm + 0.1].forEach(s => { const hd = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 8), frameM); hd.position.copy(at(s, T / 2 - 0.05, 1.05)); G.root.add(hd); });
      const matM = new THREE.Mesh(new THREE.BoxGeometry(dw * 0.9, 0.012, 0.7), mat('#374151', { roughness: 1 }));
      matM.position.copy(at(sm, T + 0.4, 0.006)); matM.rotation.y = ang; matM.receiveShadow = true; G.root.add(matM);
      const el = document.createElement('div'); el.className = 'pg-label pg-door'; el.innerHTML = '<b>⬆ Вход</b>'; el.style.pointerEvents = 'none';
      const lo = new CSS2DObject(el); lo.position.copy(at(sm, T + 0.9, 0.05)); G.root.add(lo);
    }
    G.root.add(entry.upper); G.root.add(entry.capLow);
    G.walls.push(entry);
  });
  // мебель
  zoneFx('hall').forEach(fx => G.root.add(buildFx(fx)));
  // метки категорий (как на референсе) — одна на категорию
  addCategoryLabels();
  // свет
  G.sun.position.set(cx + span * 0.35, span * 1.3, cy + span * 0.55); G.sun.target.position.set(cx, 0, cy);
  const sc = G.sun.shadow.camera; sc.left = -span * 0.8; sc.right = span * 0.8; sc.top = span * 0.8; sc.bottom = -span * 0.8; sc.far = span * 4; sc.updateProjectionMatrix();
  if (resetCam || !G.built) {
    const host = $('pg3d'); const asp = host.clientWidth && host.clientHeight ? host.clientWidth / host.clientHeight : 1.5;
    const k = asp < 1 ? 1.75 : asp < 1.3 ? 1.25 : 0.97;
    G.cam.position.set(cx - span * 0.42 * k, span * 1.05 * k, b.y1 + span * 0.62 * k);
    G.ctl.target.set(cx, 0.4, cy); G.ctl.update();
  }
  G.built = true;
}
const CAT_IC = [
  [/жен/i, '👠', '#fde7ef'], [/муж/i, '👞', '#e0ecff'], [/дев|мальч|дет/i, '👟', '#fee2e2'],
  [/стельк/i, '🦶', '#dff7fb'], [/ортопед/i, '✚', '#d9f5ef'], [/акц|скид/i, '%', '#fef3c7'],
];
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return n + ' ' + (m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c); };
// Плашка категории — над каждой группой соседних шкафов этой категории (а не в средней точке всех шкафов).
function fxBox(f) { const sw = f.rot % 180 !== 0; const w = sw ? f.d : f.w, d = sw ? f.w : f.d; return { x0: f.x - w / 2, x1: f.x + w / 2, y0: f.y - d / 2, y1: f.y + d / 2 }; }
function catClusters(fs) {
  const par = fs.map((_, i) => i); const find = (i) => par[i] === i ? i : (par[i] = find(par[i]));
  for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
    if ((fs[i].type === 'island') !== (fs[j].type === 'island')) continue;
    const a = fxBox(fs[i]), b = fxBox(fs[j]);
    const gx = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1)), gy = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
    if (Math.max(gx, gy) < 0.6) par[find(i)] = find(j);
  }
  const g = {}; fs.forEach((f, i) => { (g[find(i)] = g[find(i)] || []).push(f); });
  return Object.values(g);
}
function addCategoryLabels() {
  const groups = {};
  zoneFx('hall').filter(f => TYPES[f.type].shelves && f.category).forEach(f => { (groups[f.category] = groups[f.category] || []).push(f); });
  Object.entries(groups).forEach(([cat, all]) => catClusters(all).forEach(fs => {
    const ids = new Set(); fs.forEach(f => f.shelves.forEach(sh => sh.slots.forEach(sl => { if (sl.p) ids.add(sl.p); })));
    let pairs = 0; ids.forEach(id => { const p = S.products.get(id); if (p) pairs += p.here || 0; });
    const bx = fs.map(fxBox); const x = (Math.min(...bx.map(b => b.x0)) + Math.max(...bx.map(b => b.x1))) / 2, y = (Math.min(...bx.map(b => b.y0)) + Math.max(...bx.map(b => b.y1))) / 2, hh = Math.max(...fs.map(f => f.h));
    const ic = CAT_IC.find(([re]) => re.test(cat)) || [null, '▦', '#eef2f7'];
    const el = document.createElement('div'); el.className = 'pg-cat';
    el.title = fs.map(f => f.name).join(', ');
    el.innerHTML = `<span class="ic" style="background:${ic[2]}">${ic[1]}</span><span><b>${esc(cat)}</b><small>${plural(ids.size, 'модель', 'модели', 'моделей')} · ${pairs} пар</small></span>`;
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); select({ k: 'fx', fid: fs[0].id }); });
    const lo = new CSS2DObject(el); lo.position.set(x, hh + 0.55, y); G.root.add(lo);
  }));
}
function blob(g, w, d) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.35, d + 0.35), pmat('blobM', () => new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false, opacity: 0.55 })));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.004; m.renderOrder = 1; g.add(m);
}
function buildFx(fx) {
  const t = TYPES[fx.type] || TYPES.wall;
  const g = new THREE.Group();
  g.position.set(fx.x, 0, fx.y); g.rotation.y = -fx.rot * Math.PI / 180;
  g.userData.fid = fx.id;
  const sel = S.sel && S.sel.fid === fx.id;
  const add = (geo, m, x, y, z, pickable = true) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; if (pickable) { o.userData.fid = fx.id; G.pick.push(o); } g.add(o); return o; };
  const RB = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r || 0.02, w / 2.1, h / 2.1, d / 2.1));
  const W = fx.w, D = fx.d, Hh = fx.h;
  const white = mat('#fbfbfa', { roughness: 0.45 });
  const woodM = pmat('woodM', () => new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.6 }));
  const led = mat('#ffffff', { emissive: '#fff6e0', emissiveIntensity: 1.2 });
  blob(g, W, D);
  if (t.shelves) {
    const n = (fx.shelves || []).length;
    let base, top, slotZ = 0, both = false, tagZ = D / 2;
    if (fx.type === 'wall' || fx.type === 'rack') {
      const isRack = fx.type === 'rack';
      const frameM = isRack ? mat('#94a3b8', { metalness: 0.5, roughness: 0.4 }) : white;
      const back = add(new THREE.BoxGeometry(W - 0.06, Hh - 0.1, 0.03), isRack ? mat('#e2e8f0') : woodM, 0, Hh / 2, -D / 2 + 0.02);
      G.backs.push({ mesh: back, g, rot: fx.rot });
      add(RB(0.04, Hh, D), frameM, -W / 2 + 0.02, Hh / 2, 0);
      add(RB(0.04, Hh, D), frameM, W / 2 - 0.02, Hh / 2, 0);
      add(RB(W, 0.07, D + 0.02), frameM, 0, Hh - 0.035, 0.01);
      if (!isRack) add(new THREE.BoxGeometry(W - 0.1, 0.012, 0.02), led, 0, Hh - 0.075, D / 2 - 0.03, false);
      // нижний отсек с коробками
      base = isRack ? 0.12 : 0.44;
      add(RB(W, isRack ? 0.1 : 0.06, D), frameM, 0, isRack ? 0.05 : 0.03, 0);
      if (!isRack) {
        add(new THREE.BoxGeometry(W - 0.06, 0.025, D * 0.95), white, 0, 0.42, 0);
        const cols = ['#f97316', '#ffffff', '#fb923c', '#facc15', '#ffffff', '#ea580c'];
        const nb = Math.max(1, Math.floor((W - 0.08) / 0.3)); const bw = (W - 0.08) / nb;
        for (let r = 0; r < 2; r++) for (let k = 0; k < nb; k++) {
          const c = cols[(k * 2 + r + Math.round(fx.x * 3)) % cols.length];
          add(new THREE.BoxGeometry(bw - 0.02, 0.16, D * 0.75), mat(c, { roughness: 0.8 }), -W / 2 + 0.04 + bw * (k + 0.5), 0.07 + r * 0.17, 0.0, false);
        }
      }
      top = Hh - 0.22; slotZ = D * 0.04;
    } else if (fx.type === 'island') {
      add(RB(W, 0.32, D, 0.03), white, 0, 0.16, 0);
      add(RB(W + 0.02, 0.035, D + 0.02, 0.012), woodM, 0, 0.335, 0);
      const peg = pmat('pegM', () => { const tx = pegTex().clone(); tx.needsUpdate = true; tx.repeat.set(4, 4); return new THREE.MeshStandardMaterial({ map: tx, roughness: 0.5 }); });
      add(RB(W * 0.88, Hh - 0.35, 0.05, 0.01), peg, 0, 0.35 + (Hh - 0.35) / 2, 0);
      add(RB(W * 0.92, 0.04, 0.09, 0.01), white, 0, Hh, 0);
      base = 0.355; top = Hh - 0.2; both = true; slotZ = D * 0.22;
    } else {
      add(RB(W * 0.94, Hh - 0.04, D * 0.94, 0.04), white, 0, (Hh - 0.04) / 2, 0);
      add(RB(W, 0.04, D, 0.015), woodM, 0, Hh - 0.02, 0);
      base = Hh; top = Hh; slotZ = 0; both = true;
    }
    (fx.shelves || []).forEach((sh, si) => {
      const y = n > 1 ? base + (top - base) * si / (n - 1) : base;
      const isBaseLevel = (fx.type === 'island' && si === 0) || fx.type === 'table';
      if (!isBaseLevel) {
        if (fx.type === 'island') {
          add(new THREE.BoxGeometry(W * 0.86, 0.02, D * 0.95), white, 0, y, 0);
        } else {
          add(new THREE.BoxGeometry(W - 0.07, 0.02, D * 0.92), white, 0, y, 0.0);
          if (fx.type === 'wall') add(new THREE.BoxGeometry(W - 0.1, 0.008, 0.012), led, 0, y - 0.016, D * 0.42, false);
        }
      }
      const m = sh.slots.length || 1;
      const cw = (W - 0.1) / m;
      sh.slots.forEach((sl, ki) => {
        const st = slotStatus(sl);
        const x = -W / 2 + 0.05 + cw * (ki + 0.5);
        const ud = { fid: fx.id, si, ki, slot: true };
        const isSel = S.sel && S.sel.k === 'slot' && S.sel.fid === fx.id && S.sel.si === si && S.sel.ki === ki;
        const yy = y + 0.011;
        const sides = both ? [1, -1] : [1];
        sides.forEach(sd => {
          const zf = sd * slotZ;
          const p = sl.p ? S.products.get(sl.p) : null;
          if (p) {
            let o;
            if (isShoe(p)) { o = shoePair(p, ud, Math.min(1.3, cw / 0.19, (D * 0.9) / 0.25)); o.rotation.y = (sd > 0 ? 0 : Math.PI) + 0.32; }
            else { o = prodBox(p, ud, cw * 0.8, both); if (sd < 0) o.rotation.y = Math.PI; }
            o.position.set(x, yy, zf); g.add(o);
          } else if (sl.p) {
            const o = add(new THREE.BoxGeometry(cw * 0.6, 0.08, 0.18), mat('#94a3b8'), x, yy + 0.04, zf); o.userData = ud;
          } else {
            const e = new THREE.Mesh(new THREE.PlaneGeometry(cw * 0.78, Math.min(0.24, D * 0.5)), pmat('emptySlot' + (S.edit ? 1 : 0), () => new THREE.MeshBasicMaterial({ color: '#94a3b8', transparent: true, opacity: S.edit ? 0.32 : 0.12, depthWrite: false })));
            e.rotation.x = -Math.PI / 2; e.position.set(x, yy + 0.002, zf); e.userData = ud; g.add(e); G.pick.push(e);
          }
          // ценник-статус на кромке полки
          const tz = fx.type === 'island' || fx.type === 'table' ? sd * (D / 2 - 0.01) : D / 2 - 0.01;
          const tag = add(new THREE.BoxGeometry(0.075, 0.03, 0.006), mat(ST_COLOR[st], { emissive: ST_COLOR[st], emissiveIntensity: st === 'empty' ? 0 : 0.45 }), x, y - 0.002, tz);
          tag.userData = ud; tag.castShadow = false;
          if (isSel) {
            const hb = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(cw * 0.95, 0.2, Math.min(0.32, D * 0.85))), new THREE.LineBasicMaterial({ color: '#2563eb' }));
            hb.position.set(x, yy + 0.1, zf); g.add(hb);
          }
        });
      });
      if (S.showQr) {
        const key = 'qrM' + shelfSid(fx, si) + '|' + fx.name + '|' + n;
        const qm = pmat(key, () => { const tx = new THREE.CanvasTexture(labelCanvas(fx, si, 6)); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4; return new THREE.MeshBasicMaterial({ map: tx, toneMapped: false }); });
        const qw = Math.min(0.12, W * 0.1), qh = qw * 1.3;
        const qp = new THREE.Mesh(new THREE.PlaneGeometry(qw, qh), qm);
        qp.position.set(-W / 2 + 0.02 + qw / 2 + 0.012, y - qh / 2 - 0.012, D / 2 + 0.014);
        qp.userData = { fid: fx.id, si, qr: true }; g.add(qp); G.pick.push(qp);
      }
    });
    if (sel) {
      const el = document.createElement('div');
      el.className = 'pg-label' + (sel ? ' sel' : '');
      const stt = fxStats(fx);
      el.innerHTML = `<b>${esc(fx.name)}</b><small>${stt.models} мод. · ${stt.pairs} пар</small>`;
      el.addEventListener('pointerdown', (e) => { e.stopPropagation(); select({ k: 'fx', fid: fx.id }); });
      const lo = new CSS2DObject(el); lo.position.set(0, Hh + 0.18, 0); g.add(lo);
    }
  } else if (fx.type === 'cash') {
    add(RB(W, Hh - 0.04, D, 0.05), white, 0, (Hh - 0.04) / 2, 0);
    add(RB(W + 0.04, 0.04, D + 0.04, 0.015), woodM, 0, Hh - 0.02, 0);
    const lp = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(W * 0.6, 1.0), Math.min(W * 0.3, 0.5)), pmat('logoM' + S.wh, () => new THREE.MeshStandardMaterial({ map: logoTex(), roughness: 0.5 })));
    lp.position.set(0, Hh * 0.52, D / 2 + 0.003); g.add(lp);
    add(new THREE.BoxGeometry(0.46, 0.3, 0.025), mat('#111827', { roughness: 0.3 }), -W * 0.18, Hh + 0.27, -D * 0.12);
    add(new THREE.PlaneGeometry(0.42, 0.26), mat('#1e3a8a', { emissive: '#3b82f6', emissiveIntensity: 0.35 }), -W * 0.18, Hh + 0.27, -D * 0.12 - 0.014).rotation.y = Math.PI;
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8), mat('#374151'), -W * 0.18, Hh + 0.06, -D * 0.12 - 0.02);
    add(new THREE.BoxGeometry(0.18, 0.012, 0.1), mat('#374151'), -W * 0.18, Hh + 0.006, -D * 0.12);
    add(RB(0.08, 0.03, 0.15, 0.01), mat('#1f2937'), W * 0.22, Hh + 0.015, -D * 0.05);
  } else if (fx.type === 'bench') {
    add(RB(W, Hh * 0.55, D, 0.02), woodM, 0, Hh * 0.275, 0);
    add(RB(W - 0.02, Hh * 0.45, D - 0.02, 0.06), mat('#6b7280', { roughness: 0.95 }), 0, Hh * 0.55 + Hh * 0.225, 0);
  } else if (fx.type === 'fitting') {
    const cm = mat('#e5e7eb');
    add(new THREE.BoxGeometry(W, Hh, 0.04), cm, 0, Hh / 2, -D / 2);
    add(new THREE.BoxGeometry(0.04, Hh, D), cm, -W / 2, Hh / 2, 0);
    add(new THREE.BoxGeometry(0.04, Hh, D), cm, W / 2, Hh / 2, 0);
    add(new THREE.BoxGeometry(W, 0.03, 0.03), mat('#9ca3af'), 0, Hh - 0.1, D / 2);
    add(new THREE.BoxGeometry(W * 0.5, Hh - 0.3, 0.03), mat('#94a3b8', { roughness: 1 }), -W * 0.22, Hh / 2 - 0.05, D / 2);
  } else if (fx.type === 'mirror') {
    add(RB(W, Hh, D, 0.02), mat('#1f2937'), 0, Hh / 2 + 0.15, 0);
    add(new THREE.PlaneGeometry(W - 0.06, Hh - 0.06), pmat('mirrorM', () => new THREE.MeshStandardMaterial({ color: '#e0f2fe', metalness: 1, roughness: 0.04 })), 0, Hh / 2 + 0.15, D / 2 + 0.002);
  } else if (fx.type === 'plant') {
    const R = W / 2;
    add(new THREE.CylinderGeometry(R * 0.62, R * 0.48, 0.38, 20), mat('#f5f5f4', { roughness: 0.5 }), 0, 0.19, 0);
    add(new THREE.CylinderGeometry(R * 0.58, R * 0.58, 0.02, 20), mat('#3f2d1d'), 0, 0.375, 0);
    add(new THREE.CylinderGeometry(0.012, 0.016, Hh - 0.4, 6), mat('#4d3b24'), 0, 0.38 + (Hh - 0.4) / 2, 0);
    const greens = ['#2f8f46', '#3aa655', '#25793a', '#46b363'];
    const leafG = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < 22; i++) {
      const a = i * 2.39996, hgt = 0.5 + (Hh - 0.55) * ((i * 0.618) % 1);
      const rr = R * (0.35 + 0.65 * (1 - Math.abs(hgt - Hh * 0.7) / Hh));
      const lf = new THREE.Mesh(leafG, mat(greens[i % 4], { roughness: 0.55 }));
      lf.scale.set(R * 0.42, 0.012, R * 0.2);
      lf.position.set(Math.cos(a) * rr * 0.6, hgt, Math.sin(a) * rr * 0.6);
      lf.rotation.set(0, -a, 0.45 + 0.3 * ((i * 0.37) % 1));
      lf.castShadow = true; lf.userData.fid = fx.id; G.pick.push(lf); g.add(lf);
    }
  }
  if (sel) addGizmo(g, fx, W, D, Hh);
  return g;
}
function addGizmo(g, fx, W, D, Hh) {
  const blue = '#2563eb';
  const bx = new THREE.BoxGeometry(W + 0.12, Hh + 0.1, D + 0.12);
  const ln = new THREE.LineSegments(new THREE.EdgesGeometry(bx), new THREE.LineDashedMaterial({ color: blue, dashSize: 0.08, gapSize: 0.05 }));
  ln.computeLineDistances(); ln.position.y = (Hh + 0.1) / 2; g.add(ln);
  const hm = new THREE.MeshBasicMaterial({ color: '#ffffff' }), hr = new THREE.MeshBasicMaterial({ color: blue });
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sz]) => [0, Hh + 0.1].forEach(yy => {
    const o = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), hr); o.position.set(sx * (W + 0.12) / 2, yy, sz * (D + 0.12) / 2); g.add(o);
    const i = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), hm); i.position.copy(o.position); i.position.y += 0.001; g.add(i);
  }));
  if (S.edit) {
    g.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, Hh + 0.12, 0), 0.6, 0x3b82f6, 0.16, 0.1));
    g.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(W / 2 + 0.08, 0.15, D / 2 + 0.06), 0.55, 0xef4444, 0.15, 0.09));
    const R = Math.max(W, D) / 2 + 0.25;
    const arc = new THREE.Mesh(new THREE.TorusGeometry(R, 0.018, 8, 40, Math.PI / 3), new THREE.MeshBasicMaterial({ color: blue }));
    arc.rotation.x = -Math.PI / 2; arc.rotation.z = Math.PI * 0.55; arc.position.y = 0.03; g.add(arc);
    const tb = $('pgTools');
    tb.innerHTML = `<button data-a="move"><i>✥</i>Переместить</button><button data-a="rot"><i>↻</i>Повернуть</button><button data-a="dup"><i>⧉</i>Дублировать</button><button data-a="del" class="del"><i>🗑</i>Удалить</button>`;
    tb.querySelectorAll('button').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); fxAction(fx, b.dataset.a); }));
    G.tool = { g, off: new THREE.Vector3(0, 0, D / 2 + 0.45) };
  }
}
function fxAction(fx, a) {
  if (a === 'move') return toast('Зажмите объект и тяните по полу');
  if (a === 'rot') { fx.rot = (fx.rot + 90) % 360; return changed(true); }
  if (a === 'dup') { const c = clone(fx); c.id = uid('f'); c.x = r2(c.x + 0.4); c.y = r2(c.y + 0.4); c.name = fx.name + ' (копия)'; (c.shelves || []).forEach(sh => sh.slots.forEach(sl => { sl.p = null; delete sl.u; })); S.layout.fixtures.push(c); S.sel = { k: 'fx', fid: c.id }; return changed(true); }
  if (a === 'del') {
    const n = fxStats(fx).models;
    if (!confirm(`Удалить «${fx.name}»?${n ? `\nНа нём привязано моделей: ${n} — привязки удалятся.` : ''}`)) return;
    S.layout.fixtures = S.layout.fixtures.filter(f => f.id !== fx.id); S.sel = null; changed(true);
  }
}
function updateWallFade() {
  const c = G.cam.position;
  G.walls.forEach(w => {
    const u = w.u;
    const outside = (c.x - u.x) * u.nx + (c.z - u.y) * u.ny > 0.3;
    if (w.upper.visible === outside) { w.upper.visible = !outside; w.capLow.visible = outside; }
  });
  (G.backs || []).forEach(b => {
    const a = -b.rot * Math.PI / 180; const fxv = Math.sin(a), fzv = Math.cos(a);
    const away = (c.x - b.g.position.x) * fxv + (c.z - b.g.position.z) * fzv < 0;
    b.mesh.visible = !away;
  });
  const tb = $('pgTools');
  if (G.tool) {
    const v = G.tool.g.localToWorld(G.tool.off.clone()).project(G.cam);
    const host = $('pg3d');
    if (v.z < 1) { tb.style.display = 'flex'; tb.style.left = ((v.x + 1) / 2 * host.clientWidth) + 'px'; tb.style.top = ((1 - v.y) / 2 * host.clientHeight) + 'px'; }
    else tb.style.display = 'none';
  } else if (tb.style.display !== 'none') tb.style.display = 'none';
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
    if (e.button && e.button !== 0) return;
    setNdc(e);
    const hit = ray.intersectObjects(G.pick, false)[0];
    if (hit && hit.object.userData.fid) {
      const fx = fxById(hit.object.userData.fid);
      const p = new THREE.Vector3(); ray.ray.intersectPlane(plane, p);
      G.drag = { fx, ox: fx.x - p.x, oy: fx.y - p.z, moved: false };
      G.ctl.enabled = false;
      e.stopImmediatePropagation();
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
    }
  }, { capture: true });
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
      const d = G.drag; G.drag = null; G.ctl.enabled = true; el.style.cursor = '';
      if (d.moved) { S.sel = { k: 'fx', fid: d.fx.id }; changed(true); return; }
    }
    if (moved) return;
    setNdc(e);
    const hit = ray.intersectObjects(G.pick, false)[0];
    if (!hit) { select(null); return; }
    const u = hit.object.userData;
    if (u.qr) select({ k: 'shelf', fid: u.fid, si: u.si });
    else if (u.slot) select({ k: 'slot', fid: u.fid, si: u.si, ki: u.ki });
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
    h += `<g data-fid="${fx.id}" transform="translate(${fx.x} ${fx.y}) rotate(${fx.rot})" style="cursor:move">`;
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
      if (S.showQr && !opts.mini && window.qrcode) {
        const n = fx.shelves.length, step = (fx.w - 0.06) / n, qs = Math.min(0.3, step * 0.82);
        fx.shelves.forEach((_, si) => {
          const qx = -fx.w / 2 + 0.03 + (si + 0.5) * step - qs / 2, qy = fx.d / 2 + 0.05;
          const isS = S.sel && S.sel.k === 'shelf' && S.sel.fid === fx.id && S.sel.si === si;
          h += `<rect x="${qx - 0.015}" y="${qy - 0.015}" width="${qs + 0.03}" height="${qs + 0.03 + qs * 0.34}" rx="0.02" fill="#fff" stroke="${isS ? '#2563eb' : '#94a3b8'}" stroke-width="${isS ? 0.035 : 0.012}" data-qrsi="${si}" style="cursor:pointer"/>`;
          h += `<image href="${qrDataUrl(shelfUrl(fx, si))}" x="${qx}" y="${qy}" width="${qs}" height="${qs}" data-qrsi="${si}" style="cursor:pointer;image-rendering:pixelated"/>`;
          h += `<text x="${qx + qs / 2}" y="${qy + qs + qs * 0.22}" font-size="${qs * 0.24}" text-anchor="middle" dominant-baseline="middle" fill="#0f172a" font-weight="700" pointer-events="none">П${si + 1}</text>`;
        });
      }
    }
    if (!opts.mini && fx.type !== 'plant' && fx.type !== 'mirror') {
      const label = fx.name.length > 16 ? fx.name.slice(0, 15) + '…' : fx.name;
      const fs = Math.min(FS, fx.w / (label.length * 0.62), fx.d * 0.62 + FS * 0.25);
      const rotBack = (fx.rot % 360 + 360) % 360;
      const flip = rotBack > 90 && rotBack < 270 ? 180 : 0;
      h += `<text x="0" y="${t.shelves ? -0.02 : 0.05}" font-size="${fs}" text-anchor="middle" dominant-baseline="middle" fill="#0f172a" font-weight="700" transform="rotate(${flip})" pointer-events="none">${esc(label)}</text>`;
    }
    if (sel && !opts.mini) {
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
    const qsi = e.target.getAttribute('data-qrsi');
    if (qsi != null) { const gq = e.target.closest('[data-fid]'); if (gq) { select({ k: 'shelf', fid: gq.dataset.fid, si: Number(qsi) }); return; } }
    const g = e.target.closest('[data-fid]');
    if (g) {
      const fx = fxById(g.dataset.fid);
      const was = S.sel && S.sel.k === 'fx' && S.sel.fid === fx.id;
      S.sel = { k: 'fx', fid: fx.id };
      drag = { k: 'fx', fx, ox: fx.x - x, oy: fx.y - y, moved: false, sx: e.clientX, sy: e.clientY, was };
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    select(null);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [x, y] = toPt(e);
    if (drag.k === 'fx') {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
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
  const end = () => {
    const d = drag; drag = null;
    if (!d) return;
    if (d.moved) { changed(true); return; }
    if (d.k === 'fx') renderAll(true); // просто клик — выбрать шкаф
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
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
  if (sel && sel.k === 'shelf') return renderShelfPanel(P, sel);
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
  const zShelves = shelvesOf(fxs.filter(f => TYPES[f.type].shelves));
  h += `<div class="pg-qrbar"><div><b>QR-коды полок</b><small>${zShelves.length} полок · этикетки 40×52 мм на A4</small></div><button class="pg-btn sm pri" id="zQrPdf">⬇ Скачать все (PDF)</button></div>`;
  h += `<div class="pg-qrbar"><div><b>Журнал привязок</b><small>кто и когда привязал пару к полке</small></div><button class="pg-btn sm" id="zLog">📜 Открыть журнал</button></div>`;
  if (S.zone === 'hall') {
    const rs = restockSlots();
    if (rs.length) h += `<h4 class="pg-h-restock">Продали пару с витрины — выставьте ещё (${rs.length})</h4><div class="pg-list">${rs.map(r => `<div class="pg-li" data-rs="${r.fx.id}|${r.si}|${r.ki}">${prodThumb(r.p)}<div class="t"><b>${esc(r.p ? r.p.name : 'Товар')}</b><small>${esc(shelfName(r.fx, r.si))}${stockPlace(r.sl.p) ? ' · лежит: ' + esc(stockPlace(r.sl.p)) : ''}</small></div><div class="n"><span class="pg-pill restock">${r.p ? r.p.here : 0} пар</span></div></div>`).join('')}</div>`;
  }
  // список секций
  h += `<h4>Секции и шкафы</h4><div class="pg-list">`;
  fxs.filter(f => TYPES[f.type].shelves).forEach(f => {
    const st = fxStats(f);
    h += `<div class="pg-li" data-fx="${f.id}"><div class="ph">${f.type === 'rack' ? '🗄' : f.type === 'island' ? '🔲' : '🧱'}</div><div class="t"><b>${esc(f.name)}</b><small>${esc(f.category || TYPES[f.type].label)} · ${st.models} мод. · ${st.pairs} пар${st.empty ? ` · пусто ${st.empty}` : ''}</small></div><div class="n">${st.out ? `<span class="pg-pill out">${st.out}</span>` : ''}${st.low ? ` <span class="pg-pill low">${st.low}</span>` : ''}</div></div>`;
  });
  h += `</div>`;
  // нет на витрине — есть на складе
  const notPlaced = notOnDisplay();
  h += `<h4>Нет на витрине — есть на складе (${notPlaced.length})</h4><div class="pg-list">${notPlaced.slice(0, 12).map(p => `<div class="pg-li" title="${esc(p.name)}">${prodThumb(p)}<div class="t"><b>${esc(p.name)}</b><small>${esc(p.category || '')} · продано 30 дн.: ${p.sold30}${stockPlace(p.id) ? ' · лежит: ' + esc(stockPlace(p.id)) : ''}</small></div><div class="n">${p.here} пар</div></div>`).join('') || '<div class="pg-empty">Всё выставлено</div>'}</div>`;
  if (notPlaced.length > 12) h += `<button class="pg-btn sm" id="zAllNp" style="margin-top:6px">Показать все ${notPlaced.length}</button>`;
  P.innerHTML = h;
  P.querySelectorAll('[data-fx]').forEach(el => el.addEventListener('click', () => select({ k: 'fx', fid: el.dataset.fx })));
  P.querySelectorAll('[data-addfx]').forEach(el => el.addEventListener('click', () => addFx(el.dataset.addfx)));
  P.querySelectorAll('[data-rs]').forEach(el => el.addEventListener('click', () => { const [fid, si, ki] = el.dataset.rs.split('|'); select({ k: 'slot', fid, si: Number(si), ki: Number(ki) }); }));
  const zl = $('zLog'); if (zl) zl.addEventListener('click', openLog);
  const zq = $('zQrPdf'); if (zq) zq.addEventListener('click', () => downloadPdf(zShelves, `${storeName()} - ${z.name}`));
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
        <button class="pg-mini qr" data-sqr="${si}" title="QR и состав полки">▦ QR</button>
        ${S.edit ? `<span class="pg-row"><button class="pg-mini" data-sm="${si}" title="Убрать место">−</button><button class="pg-mini" data-sp="${si}" title="Добавить место">+</button><button class="pg-mini" data-sdel="${si}" title="Удалить полку">✕</button></span>` : ''}</div>
        <div class="pg-cells" style="grid-template-columns:repeat(${sh.slots.length},1fr)">${sh.slots.map((sl, ki) => {
          const stt = slotStatus(sl); const p = sl.p && S.products.get(sl.p);
          const isSel = S.sel && S.sel.k === 'slot' && S.sel.si === si && S.sel.ki === ki;
          return `<div class="pg-cell ${sl.p ? '' : 'empty'} ${isSel ? 'sel' : ''}" data-si="${si}" data-ki="${ki}" title="${esc(p ? p.name + ' — ' + (p.here || 0) + ' пар' : 'Пустое место')}" style="--c:${ST_COLOR[stt]};${p && p.photo ? `background-image:url('${esc(p.photo)}')` : ''}"></div>`;
        }).join('')}</div></div>`;
    }
    h += `</div>`;
    if (S.edit) h += `<div class="pg-row" style="margin-top:8px"><button class="pg-btn sm" id="shAdd">＋ Добавить полку</button><button class="pg-btn sm" id="shAll">Мест на всех полках…</button></div>`;
    h += `<h4>QR-коды полок</h4><div class="pg-qrgrid">${fx.shelves.map((_, si) => `<div class="pg-qrcard"><img src="${labelCanvas(fx, si, 5).toDataURL('image/png')}" alt="QR полка ${si + 1}" data-sqr="${si}"><button class="pg-mini" data-qpng="${si}">⬇ PNG</button></div>`).join('')}</div>
      <div class="pg-row" style="margin-top:8px"><button class="pg-btn sm pri" id="fQrPdf">⬇ Скачать QR всех полок шкафа (PDF)</button></div>`;
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
  on('fDup', 'click', () => { const c = clone(fx); c.id = uid('f'); c.x = r2(c.x + 0.4); c.y = r2(c.y + 0.4); c.name = fx.name + ' (копия)'; (c.shelves || []).forEach(sh => sh.slots.forEach(sl => { sl.p = null; delete sl.u; })); S.layout.fixtures.push(c); S.sel = { k: 'fx', fid: c.id }; changed(true); });
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
  P.querySelectorAll('[data-sqr]').forEach(b => b.addEventListener('click', () => select({ k: 'shelf', fid: fx.id, si: Number(b.dataset.sqr) })));
  P.querySelectorAll('[data-qpng]').forEach(b => b.addEventListener('click', () => downloadPng(fx, Number(b.dataset.qpng))));
  on('fQrPdf', 'click', () => downloadPdf(shelvesOf([fx]), fx.name));
}
function unitChip(bc) {
  const u = S.units[bc] || {};
  const cls = u.here ? 'ok' : (u.st === 'sold' ? 'sold' : 'gone');
  const t = u.here ? 'на полке' : (u.st === 'sold' ? 'продана' : u.st === 'in_stock' ? 'на другом складе' : 'нет в базе');
  return `<span class="pg-unit ${cls}" data-ubc="${esc(bc)}" title="${esc(bc)} — ${t}">${esc(u.size || '—')} · №${esc(String(bc).slice(-4))}</span>`;
}
function renderShelfPanel(P, sel) {
  const fx = fxById(sel.fid);
  const sh = fx && fx.shelves && fx.shelves[sel.si];
  if (!sh) { S.sel = fx ? { k: 'fx', fid: fx.id } : null; return renderPanel(); }
  const items = sh.slots.map((sl, ki) => ({ sl, ki })).filter(x => x.sl.p);
  let h = `<div class="pg-crumb"><a id="bkZone">${esc(S.layout.zones[fx.zone].name)}</a> › <a id="bkFx">${esc(fx.name)}</a> › Полка ${sel.si + 1}</div>`;
  h += `<h3>${esc(shelfName(fx, sel.si))}</h3><div class="pg-sub">${esc(fx.category || TYPES[fx.type].label)} · ${sh.slots.length} мест · занято ${items.length}</div>`;
  h += `<div class="pg-qrbig"><img src="${labelCanvas(fx, sel.si, 9).toDataURL('image/png')}" alt="QR полки"></div>
    <div class="pg-actions"><button class="pg-btn pri" id="sqPng">⬇ Скачать PNG</button><button class="pg-btn" id="sqPdf">🖨 PDF для печати</button></div>
    <div class="pg-info">Наклейте этикетку на кромку полки. <b>Привязка товара:</b> касса РМК → «Ещё» → «Полка: привязать товар» → отсканируйте этот QR → введите последние 6 цифр штрихкода каждой пары на полке и нажмите «Привязать». Пара привязывается к полке, учёт — по модели. Если пару продали, а модель есть в магазине — место станет фиолетовым «нет на витрине — есть на складе».</div>`;
  if (S.dirty) h += `<div class="pg-note">Есть несохранённые изменения — состав с кассы появится после сохранения и обновления.</div>`;
  h += `<h4>Состав полки (${items.length}) <button class="pg-mini" id="sqReload" style="width:auto;padding:0 8px;margin-left:6px;font-size:11.5px" title="Обновить с сервера">⟳ Обновить</button></h4><div class="pg-list">`;
  h += items.map(({ sl, ki }) => {
    const p = S.products.get(sl.p); const st = slotStatus(sl);
    const us = Array.isArray(sl.u) ? sl.u : [];
    return `<div class="pg-li" data-ski="${ki}">${prodThumb(p)}<div class="t"><b>${esc(p ? p.name : 'Товар не найден')}</b><small>место ${ki + 1} · в магазине ${p ? p.here : 0} пар${us.length ? '' : ' · привязано вручную'}</small>${us.length ? `<div class="pg-units">${us.map(unitChip).join('')}</div>` : ''}</div><div class="n"><span class="pg-pill ${st}">${ST_LABEL[st]}</span></div></div>`;
  }).join('') || '<div class="pg-empty">На полке пока нет товаров. Отсканируйте QR на кассе и привяжите пары.</div>';
  h += `</div>`;
  h += `<h4>Журнал полки — кто и когда привязал</h4><div class="pg-loglist" id="sqLog"><div class="pg-empty">⏳ загружаю…</div></div>`;
  P.innerHTML = h;
  loadShelfLog(fx, sel.si);
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  on('bkZone', 'click', () => select(null));
  on('bkFx', 'click', () => select({ k: 'fx', fid: fx.id }));
  on('sqPng', 'click', () => downloadPng(fx, sel.si));
  on('sqPdf', 'click', () => downloadPdf([[fx, sel.si]], shelfName(fx, sel.si)));
  on('sqReload', 'click', () => { if (S.dirty) return toast('Сначала сохраните изменения', true); const keep = S.sel; loadAll().then(() => { S.sel = keep; renderAll(true); }); });
  P.querySelectorAll('[data-ski]').forEach(el => el.addEventListener('click', () => select({ k: 'slot', fid: fx.id, si: sel.si, ki: Number(el.dataset.ski) })));
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
      ${Array.isArray(sl.u) && sl.u.length ? `<h4>Пары на полке (привязаны сканом)</h4><div class="pg-units">${sl.u.map(unitChip).join('')}</div>` : ''}
      <h4>Размеры в этом магазине</h4>${sizesHTML(p && p.sizes)}
      <h4>Остатки на других складах</h4><div id="slOther"><div class="pg-empty">⏳ загружаю…</div></div>
      <div class="pg-grid2" style="margin-top:10px"><div class="pg-f"><label>Пар на этом месте (выставлено)</label><input id="slQ" type="number" min="1" max="20" value="${sl.q || 1}"></div><div></div></div>`;
    if (st === 'low' || st === 'out') h += `<div class="pg-note">⚠ ${st === 'out' ? 'Этой модели нет в магазине' : 'Осталось мало пар'} — стоит перевести модель в скидки или привезти, а на это место поставить модель с большим остатком.</div>`;
    if (st === 'restock') h += `<div class="pg-note restock">🟣 Пару с этого места продали, а модель ещё есть в магазине (${p ? p.here : 0} пар${stockPlace(sl.p) ? ', лежит: ' + esc(stockPlace(sl.p)) : ''}). Выставьте новую пару и отсканируйте её на кассе через QR полки.</div>`;
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
  on('slClr', 'click', () => { sl.p = null; sl.q = 1; delete sl.u; changed(true); });
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
  if (sl.p !== pid) delete sl.u;
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
  const rs = restockSlots();
  m.innerHTML = `<div class="pg-mbox"><h3>Нет на витрине — есть на складе (${arr.length + rs.length})</h3><div class="pg-sub">Отсортировано по продажам за 30 дней. Выставьте пару на полку и отсканируйте её на кассе через QR полки.</div>
    <div class="pg-mlist">${rs.length ? `<h4 class="pg-h-restock">Продали пару с витрины — выставьте ещё (${rs.length})</h4><div class="pg-list">${rs.map(r => `<div class="pg-li" style="cursor:default">${prodThumb(r.p)}<div class="t"><b>${esc(r.p ? r.p.name : 'Товар')}</b><small>место: ${esc(shelfName(r.fx, r.si))}${stockPlace(r.sl.p) ? ' · лежит: ' + esc(stockPlace(r.sl.p)) : ''}</small></div><div class="n">${r.p ? r.p.here : 0} пар</div></div>`).join('')}</div>` : ''}
    <h4>Модели не выставлены (${arr.length})</h4><div class="pg-list">${arr.map(p => `<div class="pg-li" style="cursor:default">${prodThumb(p)}<div class="t"><b>${esc(p.name)}</b><small>${esc(p.category || '')} · продано 30 дн.: ${p.sold30}${stockPlace(p.id) ? ' · лежит: ' + esc(stockPlace(p.id)) : ''}</small></div><div class="n">${p.here} пар</div></div>`).join('')}</div></div>
    <div class="pg-row" style="justify-content:flex-end;margin-top:10px"><button class="pg-btn" id="npClose">Закрыть</button></div></div>`;
  $('npClose').addEventListener('click', closeModal);
}

// ═══════════════════════ «Товары»: по номенклатурам ═══════════════════════
const isPromoFx = (f) => /акц|скид/i.test(f.category || '');
function hallPlaces() {
  const by = new Map();
  zoneFx('hall').forEach(fx => (fx.shelves || []).forEach((sh, si) => sh.slots.forEach((sl, ki) => {
    if (!sl.p) return;
    const e = by.get(sl.p) || { pid: sl.p, places: [], units: [] }; by.set(sl.p, e);
    e.places.push({ fx, si, ki, sl });
    (sl.u || []).forEach(bc => e.units.push({ bc, fx, si, ki }));
  })));
  return by;
}
function goodsData() {
  const by = hallPlaces();
  const on = [...by.values()].map(e => ({ ...e, p: S.products.get(e.pid) || { id: e.pid, name: 'Товар', here: 0, sizes: {}, sold30: 0 } }))
    .sort((a, b) => (b.p.sold30 || 0) - (a.p.sold30 || 0) || (b.p.here || 0) - (a.p.here || 0));
  const rs = restockSlots(); const np = notOnDisplay();
  // пары на витрине, которые по учёту не в этом магазине
  const otherUnits = [];
  on.forEach(e => e.units.forEach(u => { const x = S.units[u.bc]; if (x && !x.here) otherUnits.push({ ...u, e, x }); }));
  // модели на витрине, которых по учёту 0 в этом магазине, но есть в другом
  const otherModels = on.filter(e => !(e.p.here > 0) && (e.p.elsewhere || []).length);
  const promoFx = zoneFx('hall').filter(f => TYPES[f.type].shelves && isPromoFx(f));
  const promoFree = promoFx.reduce((a, f) => a + f.shelves.reduce((b, sh) => b + sh.slots.filter(sl => !sl.p).length, 0), 0);
  const low = on.filter(e => e.p.here > 0 && e.p.here <= 2 && e.places.some(pl => !isPromoFx(pl.fx)));
  return { on, rs, np, otherUnits, otherModels, promoFx, promoFree, low };
}
const placeTxt = (pls) => pls.slice(0, 3).map(pl => shelfName(pl.fx, pl.si)).join(', ') + (pls.length > 3 ? ` +${pls.length - 3}` : '');
const elseTxt = (p) => (p.elsewhere || []).slice(0, 3).map(w => `${esc(w.name.replace(/^Ортосалон\s*/i, '').replace(/"/g, ''))}: ${w.n}`).join(' · ');
const statusTxt = (x) => x.st === 'in_stock' ? `в наличии — ${esc(x.whName || 'другой склад')}` : x.st === 'sold' ? `продана${x.whName ? ' (' + esc(x.whName) + ')' : ''}` : x.st === 'written_off' ? `списана${x.whName ? ' (' + esc(x.whName) + ')' : ''}` : esc(x.st || 'неизвестно');
function moveToPromo(pid) {
  const by = hallPlaces(); const e = by.get(pid); if (!e) return;
  const from = e.places.find(pl => !isPromoFx(pl.fx)); if (!from) return toast('Модель уже на акционной полке');
  let to = null;
  for (const fx of zoneFx('hall').filter(f => TYPES[f.type].shelves && isPromoFx(f))) {
    for (let si = fx.shelves.length - 1; si >= 0 && !to; si--) { const ki = fx.shelves[si].slots.findIndex(sl => !sl.p); if (ki >= 0) to = { fx, si, ki }; }
    if (to) break;
  }
  if (!to) return toast('На акционной полке нет свободных мест', true);
  const t = to.fx.shelves[to.si].slots[to.ki];
  t.p = from.sl.p; t.q = from.sl.q || 1; if (from.sl.u) t.u = from.sl.u.slice();
  from.sl.p = null; from.sl.q = 1; delete from.sl.u;
  changed(true);
  toast(`Перенесено: ${shelfName(from.fx, from.si)} → ${shelfName(to.fx, to.si)}. Нажмите «Сохранить», чтобы закрепить.`);
  return to;
}
function openGoods(tab) {
  const m = $('pgModal'); m.hidden = false;
  let cur = tab || 'disp';
  const D0 = goodsData();
  m.innerHTML = `<div class="pg-mbox pg-wide"><h3>Товары на витрине — по номенклатурам</h3>
    <div class="pg-sub">${esc(storeName())} · продажи считаются по номенклатуре: продали любой размер модели — значит модель продаётся (чеки кассы за 30 дней).</div>
    <div class="pg-tabs" id="gdTabs"></div>
    <input class="pg-search" id="gdQ" placeholder="Поиск: название, артикул, полка" autocomplete="off">
    <div class="pg-mlist pg-mlist-tall" id="gdList"></div>
    <div class="pg-row" style="justify-content:flex-end;margin-top:10px"><button class="pg-btn" id="gdClose">Закрыть</button></div></div>`;
  $('gdClose').addEventListener('click', closeModal);
  const go = (fid, si, ki) => { closeModal(); if (S.zone !== 'hall') S.zone = 'hall'; select({ k: 'slot', fid, si: Number(si), ki: Number(ki) }); };
  const draw = () => {
    const D = goodsData();
    const tabs = [
      ['disp', 'На витрине', D.on.length],
      ['off', 'Нет на витрине — есть на складе', D.rs.length + D.np.length],
      ['other', 'На витрине, но числятся в другом магазине', D.otherUnits.length + D.otherModels.length],
      ['promo', 'Мало остатка → на акцию', D.low.length],
    ];
    $('gdTabs').innerHTML = tabs.map(([k, t, n]) => `<button data-t="${k}" class="${k === cur ? 'on' : ''} t-${k}">${t} <b>${n}</b></button>`).join('');
    $('gdTabs').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { cur = b.dataset.t; draw(); }));
    const v = $('gdQ').value.trim().toLowerCase();
    const hit = (p, extra) => !v || [(p && p.name), (p && p.sku), extra].join(' ').toLowerCase().includes(v);
    const sz = (sizes) => { const ks = Object.keys(sizes || {}).sort((a, b) => (parseFloat(a) || 999) - (parseFloat(b) || 999)); return ks.length ? `<span class="pg-szl">${ks.map(k => `<i>${esc(k.replace(/^размер\s*/i, ''))}${sizes[k] > 1 ? '×' + sizes[k] : ''}</i>`).join('')}</span>` : ''; };
    const pill = (st) => `<span class="pg-pill ${st}">${ST_LABEL[st] || ''}</span>`;
    let h = '';
    if (cur === 'disp') {
      const arr = D.on.filter(e => hit(e.p, placeTxt(e.places)));
      h = arr.map(e => { const st = worstStatus(e.places.map(pl => slotStatus(pl.sl))); const pl = e.places[0];
        return `<div class="pg-li" data-go="${pl.fx.id}|${pl.si}|${pl.ki}">${prodThumb(e.p)}<div class="t"><b>${esc(e.p.name)}</b><small>${esc(placeTxt(e.places))} · продано 30 дн.: <em>${e.p.sold30 || 0}</em>${e.p.sold7 ? ` (7 дн.: ${e.p.sold7})` : ''}</small>${sz(e.p.sizes)}</div><div class="n">${pill(st)}<br>${e.p.here || 0} пар</div></div>`; }).join('');
    } else if (cur === 'off') {
      const rs = D.rs.filter(r => hit(r.p, shelfName(r.fx, r.si))); const np = D.np.filter(p => hit(p, stockPlace(p.id)));
      h = (rs.length ? `<h4 class="pg-h-restock">Продали пару с витрины — выставьте другую (${rs.length})</h4>` + rs.map(r => `<div class="pg-li" data-go="${r.fx.id}|${r.si}|${r.ki}">${prodThumb(r.p)}<div class="t"><b>${esc(r.p ? r.p.name : 'Товар')}</b><small>место: ${esc(shelfName(r.fx, r.si))}${stockPlace(r.sl.p) ? ' · лежит: ' + esc(stockPlace(r.sl.p)) : ''}</small>${sz(r.p && r.p.sizes)}</div><div class="n"><span class="pg-pill restock">${r.p ? r.p.here : 0} пар</span></div></div>`).join('') : '')
        + `<h4>Модели не выставлены (${np.length})</h4>` + (np.map(p => `<div class="pg-li" style="cursor:default">${prodThumb(p)}<div class="t"><b>${esc(p.name)}</b><small>${esc(p.category || '')} · продано 30 дн.: <em>${p.sold30 || 0}</em>${stockPlace(p.id) ? ' · лежит: ' + esc(stockPlace(p.id)) : ''}</small>${sz(p.sizes)}</div><div class="n">${p.here} пар</div></div>`).join('') || '<div class="pg-empty">Всё выставлено</div>');
    } else if (cur === 'other') {
      const ou = D.otherUnits.filter(u => hit(u.e.p, u.bc + ' ' + shelfName(u.fx, u.si)));
      const om = D.otherModels.filter(e => hit(e.p, placeTxt(e.places)));
      h = `<div class="pg-info" style="margin:0 0 8px">Пара физически стоит на витрине этого магазина, а по учёту числится в другом месте — нужно оформить перемещение или проверить пару.</div>`
        + `<h4>Привязанные сканом пары (${ou.length})</h4>` + (ou.map(u => `<div class="pg-li" data-go="${u.fx.id}|${u.si}|${u.ki}">${prodThumb(u.e.p)}<div class="t"><b>${esc(u.e.p.name)}</b><small>пара №${esc(String(u.bc).slice(-6))}${u.x.size && u.x.size !== '—' ? ' · р. ' + esc(u.x.size) : ''} · ${esc(shelfName(u.fx, u.si))}</small><small class="pg-warn">по учёту: ${statusTxt(u.x)}</small></div><div class="n"><span class="pg-pill ${u.x.st === 'in_stock' ? 'restock' : 'out'}">${u.x.st === 'in_stock' ? 'другой магазин' : 'нет в учёте'}</span></div></div>`).join('') || '<div class="pg-empty">Таких пар нет</div>')
        + `<h4>Модели на витрине: здесь 0 пар, но есть в других магазинах (${om.length})</h4>` + (om.map(e => { const pl = e.places[0]; return `<div class="pg-li" data-go="${pl.fx.id}|${pl.si}|${pl.ki}">${prodThumb(e.p)}<div class="t"><b>${esc(e.p.name)}</b><small>${esc(placeTxt(e.places))}</small><small class="pg-warn">числится: ${elseTxt(e.p)}</small></div><div class="n"><span class="pg-pill out">0 здесь</span></div></div>`; }).join('') || '<div class="pg-empty">Таких моделей нет</div>');
    } else {
      const arr = D.low.filter(e => hit(e.p, placeTxt(e.places)));
      h = `<div class="pg-note" style="margin:0 0 8px">Модели с остатком 1–2 пары в магазине. Предложение: перенести на акционную полку${D.promoFx.length ? ` (${esc(D.promoFx.map(f => f.name).join(', '))}, свободно мест: ${D.promoFree})` : ' — сначала задайте шкафу категорию «Акция / скидки»'}. После переноса нажмите «Сохранить».</div>`
        + (arr.map(e => { const pl = e.places.find(x => !isPromoFx(x.fx)) || e.places[0]; return `<div class="pg-li" data-go="${pl.fx.id}|${pl.si}|${pl.ki}">${prodThumb(e.p)}<div class="t"><b>${esc(e.p.name)}</b><small>${esc(placeTxt(e.places))} · продано 30 дн.: <em>${e.p.sold30 || 0}</em></small>${sz(e.p.sizes)}</div><div class="n"><span class="pg-pill low">${e.p.here} пар</span><br>${D.promoFx.length ? `<button class="pg-btn pg-mv" data-mv="${e.pid}">% На акцию</button>` : ''}</div></div>`; }).join('') || '<div class="pg-empty">Моделей с малым остатком нет</div>');
    }
    $('gdList').innerHTML = h || '<div class="pg-empty">Ничего не найдено</div>';
    $('gdList').querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', (ev) => { if (ev.target.closest('[data-mv]')) return; const [f, si, ki] = el.dataset.go.split('|'); go(f, si, ki); }));
    $('gdList').querySelectorAll('[data-mv]').forEach(b => b.addEventListener('click', (ev) => { ev.stopPropagation(); moveToPromo(b.dataset.mv); draw(); }));
  };
  $('gdQ').addEventListener('input', draw);
  draw();
}
$('pgGoods') && $('pgGoods').addEventListener('click', () => openGoods());

// ═══════════════════════ общий рендер ═══════════════════════
function renderKpis() {
  const fxs = zoneFx(S.zone).filter(f => TYPES[f.type].shelves);
  let slots = 0, empty = 0, low = 0, out = 0; const ids = new Set();
  fxs.forEach(f => f.shelves.forEach(sh => sh.slots.forEach(sl => { slots++; const st = slotStatus(sl); if (st === 'empty') empty++; else ids.add(sl.p); if (st === 'low') low++; if (st === 'out') out++; })));
  let pairs = 0; ids.forEach(id => { const p = S.products.get(id); if (p) pairs += p.here || 0; });
  const notPlaced = notOnDisplay();
  const rsN = restockSlots().length;
  const totalHere = [...S.products.values()].reduce((a, p) => a + (p.here || 0), 0);
  $('pgKpis').innerHTML = `
    <div class="pg-kpi"><small>Моделей ${S.zone === 'hall' ? 'на витрине' : 'на складе'}</small><b>${ids.size}</b></div>
    <div class="pg-kpi"><small>Пар этих моделей в магазине</small><b>${fmt(pairs)}</b></div>
    <div class="pg-kpi"><small>Мест на полках</small><b>${slots}</b></div>
    <div class="pg-kpi ${empty ? 'warn' : ''}"><small>Пустых мест</small><b>${empty}</b></div>
    <div class="pg-kpi ${low ? 'warn' : ''}"><small>Мало остатков (≤2)</small><b>${low}</b></div>
    <div class="pg-kpi ${out ? 'bad' : ''}"><small>Нет в магазине</small><b>${out}</b></div>
    <div class="pg-kpi click ${notPlaced.length + rsN ? 'restock' : ''}" id="kNp"><small>Нет на витрине — есть на складе</small><b>${notPlaced.length + rsN}</b></div>
    <div class="pg-kpi"><small>Всего пар в магазине</small><b>${fmt(totalHere)}</b></div>`;
  $('kNp').addEventListener('click', () => openNotPlaced(notPlaced));
}
function hint() {
  const el = $('pgHint');
  let t = '';
  if (S.shapeEdit) t = 'Форма помещения: тяните синие углы, «+» на стене — добавить угол';
  else if (S.view === '3d' && S.zone === 'hall') t = S.edit ? 'Тяните шкаф мышью/пальцем, чтобы переместить · камера — по пустому месту' : 'Чтобы двигать шкафы — включите «Редактирование»';
  else t = 'Тяните шкаф, чтобы переместить · синий кружок — поворот';
  if (t === hint.last) return; hint.last = t;
  el.textContent = t; el.style.display = t ? 'block' : 'none';
  clearTimeout(hint.tm); if (t) hint.tm = setTimeout(() => { el.style.display = 'none'; }, 6000);
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
const qrBtn = $('pgQr');
if (qrBtn) { qrBtn.classList.toggle('on', S.showQr); qrBtn.addEventListener('click', () => { S.showQr = !S.showQr; localStorage.setItem('pg_show_qr', S.showQr ? '1' : '0'); qrBtn.classList.toggle('on', S.showQr); renderAll(true); }); }
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (S.dirty) save(); }
  if (e.key === 'Delete' && S.edit && S.sel && S.sel.k === 'fx' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { const b = $('fDel'); if (b) b.click(); }
});

if (USER) {
  try { init3d(); } catch (e) { console.error(e); toast('3D недоступно на этом устройстве — открыт 2D план', true); S.view = '2d'; }
  loadAll();
}
