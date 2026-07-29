/* ══════════════════════════════════════════════════════════
   Администратор РМК — логика (этап 1: Обзор, Смена, Чеки)
   Данные: backend 1c-sync-barcodes /api/pos (тот же, что у кассы)
   Доступ: только админы с полным доступом (allowedTabs === '*')
   ══════════════════════════════════════════════════════════ */

// ─────────── Backend РМК ───────────
const BARCODE_SVC_URL = 'https://1c-sync-barcodes.vercel.app';
const BARCODE_SVC_SECRET = 'TySog2bN1bMJHsssoTvyCZO3IKOef1z0';

// ─────────── Аккаунты (синхронно с дашбордом) ───────────
// В админку пускаем ТОЛЬКО полноправных админов (allowedTabs === '*').
const ADMIN_ACCOUNTS = {
  'Sunnat':   { password: 'Sunna0909', displayName: 'Sunnat',   allowedTabs: '*' },
  'Iskandar': { password: '1111',      displayName: 'Iskandar', allowedTabs: '*' },
  'Shahida':  { password: 's2364170',  displayName: 'Shahida',  allowedTabs: '*' },
};
const LS_KEY = 'orto_admin_rmk_auth';

// ─────────── Утилиты ───────────
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const CUR = 'с.'; // сомони

function fmtNum(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtInt(n) { return (Number(n) || 0).toLocaleString('ru-RU'); }
function money(n) { return `${fmtNum(n)} <span class="cur">${CUR}</span>`; }

// Дата «сегодня» в Душанбе (UTC+5) как YYYY-MM-DD
function dushToday() {
  const d = new Date(Date.now() + 5 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
// Время из ISO в «ЧЧ:ММ» по Душанбе
function dushTime(iso, withDate) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return esc(iso);
  const sh = new Date(d.getTime() + 5 * 3600 * 1000);
  const hh = String(sh.getUTCHours()).padStart(2, '0');
  const mm = String(sh.getUTCMinutes()).padStart(2, '0');
  if (!withDate) return `${hh}:${mm}`;
  const dd = String(sh.getUTCDate()).padStart(2, '0');
  const mo = String(sh.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}.${mo}.${sh.getUTCFullYear()} ${hh}:${mm}`;
}
function nowDushLabel() {
  const d = new Date(Date.now() + 5 * 3600 * 1000);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth()+1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// ─────────── API ───────────
async function posApi(path, opts) {
  const res = await fetch(`${BARCODE_SVC_URL}/api/pos${path}`, {
    ...(opts || {}),
    headers: { 'Content-Type': 'application/json', 'X-Provision-Secret': BARCODE_SVC_SECRET, ...((opts && opts.headers) || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data && data.ok === false)) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

// ─────────── Состояние ───────────
const state = {
  user: null,
  view: 'overview',
  from: dushToday(),
  to: dushToday(),
  kassa: '',           // Ref_Key кассы или '' = все
  kassas: [],          // [{ref,name}]
  cache: {},           // кеш ответов по ключу
  charts: {},          // Chart.js инстансы
};

// ══════════════════════════════════════════════════════════
//  ЛОГИН
// ══════════════════════════════════════════════════════════
function tryRestoreAuth() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const { user } = JSON.parse(raw);
    if (user && ADMIN_ACCOUNTS[user] && ADMIN_ACCOUNTS[user].allowedTabs === '*') {
      state.user = ADMIN_ACCOUNTS[user].displayName;
      return true;
    }
  } catch (_) {}
  return false;
}
function doLogout() {
  localStorage.removeItem(LS_KEY);
  location.reload();
}
function initLogin() {
  $('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const u = $('loginUser').value.trim();
    const p = $('loginPass').value;
    const acc = ADMIN_ACCOUNTS[u];
    const errEl = $('loginError');
    if (!acc || acc.password !== p) {
      errEl.textContent = 'Неверный логин или пароль';
      errEl.style.display = 'block';
      return;
    }
    if (acc.allowedTabs !== '*') {
      errEl.textContent = 'Нет доступа к админ-панели РМК';
      errEl.style.display = 'block';
      return;
    }
    localStorage.setItem(LS_KEY, JSON.stringify({ user: u, ts: Date.now() }));
    state.user = acc.displayName;
    enterApp();
  });
}
function enterApp() {
  $('loginScreen').style.display = 'none';
  $('app').style.display = 'flex';
  bootApp();
}

// ══════════════════════════════════════════════════════════
//  КАРКАС / РОУТИНГ
// ══════════════════════════════════════════════════════════
const VIEW_META = {
  overview:  { title: 'Обзор',              sub: 'Главная панель управления РМК' },
  shift:     { title: 'Управление сменой',  sub: 'Просмотр и управление сменами касс' },
  receipts:  { title: 'Чеки продаж',        sub: 'Список всех чеков за выбранный период' },
};
const READY_VIEWS = ['overview', 'shift', 'receipts'];

async function bootApp() {
  // фильтры даты
  $('fltFrom').value = state.from;
  $('fltTo').value = state.to;
  $('fltFrom').addEventListener('change', onFilterChange);
  $('fltTo').addEventListener('change', onFilterChange);
  $('fltKassa').addEventListener('change', () => { state.kassa = $('fltKassa').value; onFilterChange(); });
  $('btnSync').addEventListener('click', () => { state.cache = {}; renderView(true); });
  $('btnLogout').addEventListener('click', doLogout);

  // навигация
  document.querySelectorAll('.sb-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.view;
      document.querySelectorAll('.sb-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.view = v;
      renderView();
    });
  });

  // загрузка списка касс для фильтра
  loadKassas();

  renderView();
  bumpSync();
}

function onFilterChange() {
  state.from = $('fltFrom').value || dushToday();
  state.to = $('fltTo').value || state.from;
  state.cache = {};
  renderView(true);
}
function bumpSync() { $('syncTime').textContent = nowDushLabel(); }

async function loadKassas() {
  try {
    const d = await posApi('?action=kassas', { method: 'GET' });
    state.kassas = d.kassas || [];
    const sel = $('fltKassa');
    sel.innerHTML = '<option value="">Все магазины</option>' +
      state.kassas.map(k => `<option value="${esc(k.ref)}">${esc(k.name)}</option>`).join('');
  } catch (e) { /* фильтр по кассе просто останется «Все» */ }
}

function renderView(force) {
  const v = state.view;
  const isReady = READY_VIEWS.includes(v);
  // переключаем секции
  document.querySelectorAll('.view').forEach(s => s.classList.remove('active'));
  if (isReady) $('view-' + v).classList.add('active');
  else $('view-stub').classList.add('active');
  // заголовок
  const meta = VIEW_META[v] || { title: 'Раздел', sub: '' };
  $('viewTitle').textContent = meta.title;
  $('viewSub').textContent = meta.sub;
  if (!isReady) return;
  // рендер конкретного раздела
  if (v === 'overview') renderOverview(force);
  else if (v === 'shift') renderShift(force);
  else if (v === 'receipts') renderReceipts(force);
}

// общий помощник кеширования запросов
async function cachedApi(key, path) {
  if (state.cache[key]) return state.cache[key];
  const d = await posApi(path, { method: 'GET' });
  state.cache[key] = d;
  return d;
}
function kassaQS() { return state.kassa ? `&kassa=${encodeURIComponent(state.kassa)}` : ''; }
function errBar(msg) { return `<div class="errbar">⚠ ${esc(msg)}</div>`; }

// ══════════════════════════════════════════════════════════
//  РАЗДЕЛ: ОБЗОР
// ══════════════════════════════════════════════════════════
async function renderOverview(force) {
  const box = $('ovBody');
  box.innerHTML = `<div class="loading">⏳ Загружаю обзор…</div>`;
  try {
    const [hist, rep] = await Promise.all([
      cachedApi(`hist:${state.from}:${state.to}:${state.kassa}`, `?action=history&from=${state.from}&to=${state.to}${kassaQS()}`),
      cachedApi(`rep:${state.from}:${state.to}`, `?action=sales-report&from=${state.from}&to=${state.to}`),
    ]);
    const receipts = hist.receipts || [];
    const total = hist.total || 0;
    const cnt = receipts.length;
    const avg = cnt ? total / cnt : 0;

    // способы оплаты и возвраты — из sales-report (grand)
    const g = (rep.report && rep.report.grand) || {};
    const buckets = (rep.report && rep.report.buckets) || [];
    const cash = g.cash || 0;
    let nonCash = 0;
    buckets.forEach(b => { if (b.key !== 'cash') nonCash += (g[b.key] || 0); });
    nonCash += (g.other || 0);
    const returnsSum = computeReturns(rep.report);

    // топ товаров недоступен из этих action → показываем топ продавцов по чекам
    const bySeller = {};
    receipts.forEach(r => { const s = r.seller || '—'; if (!bySeller[s]) bySeller[s] = { sum: 0, n: 0 }; bySeller[s].sum += r.total; bySeller[s].n++; });
    const topSellers = Object.entries(bySeller).sort((a, b) => b[1].sum - a[1].sum).slice(0, 5);

    // последние чеки
    const last = receipts.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);

    box.innerHTML = `
      <div class="kpis">
        ${kpi('💵','Продажи', money(total),'g','')}
        ${kpi('🧾','Чеков', fmtInt(cnt),'gray','')}
        ${kpi('↩','Возвраты', money(returnsSum),'red','')}
        ${kpi('📊','Средний чек', money(avg),'gray','')}
        ${kpi('🟢','Наличные', money(cash),'g', pct(cash, cash+nonCash))}
        ${kpi('💳','Безналичные', money(nonCash),'gray', pct(nonCash, cash+nonCash))}
      </div>

      <div class="cols-main">
        <div class="grid" style="gap:16px">
          <div class="card card-pad">
            <div class="card-h-row"><h3>Продажи по часам</h3></div>
            <div class="chart-box"><canvas id="ovHours"></canvas></div>
          </div>
          <div class="card card-pad">
            <div class="card-h-row"><h3>Последние чеки</h3><a class="link" data-goto="receipts">Все чеки →</a></div>
            <div class="tbl-wrap">
              <table class="tbl">
                <thead><tr><th>№ чека</th><th>Время</th><th>Продавец</th><th>Магазин</th><th class="r">Сумма</th></tr></thead>
                <tbody>${last.length ? last.map(r => `
                  <tr><td class="strong">${esc(r.number)}</td><td class="muted">${dushTime(r.date,false)}</td>
                  <td>${esc(r.seller)}</td><td class="muted">${esc(r.shop)}</td><td class="r strong tnum">${fmtNum(r.total)}</td></tr>`).join('')
                  : `<tr><td class="tbl-empty" colspan="5">Чеков нет</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="grid" style="gap:16px">
          <div class="card card-pad">
            <div class="card-h">Способы оплаты</div>
            <div class="chart-box" style="height:180px"><canvas id="ovPay"></canvas></div>
            <div class="legend">
              <div class="legend-item"><span class="lg-dot" style="background:#10b981"></span> Наличные — <b>&nbsp;${fmtNum(cash)}</b></div>
              <div class="legend-item"><span class="lg-dot" style="background:#3b82f6"></span> Безналичные — <b>&nbsp;${fmtNum(nonCash)}</b></div>
            </div>
          </div>
          <div class="card card-pad">
            <div class="card-h">Топ продавцов</div>
            <div class="mini-list">
              ${topSellers.length ? topSellers.map(([name,o],i) => `
                <div class="mini-row"><span><span class="mini-rank">${i+1}</span><span class="mini-name">${esc(name)}</span></span>
                <span class="mini-val tnum">${fmtNum(o.sum)}</span></div>`).join('')
                : `<div class="tbl-empty">Нет данных</div>`}
            </div>
          </div>
        </div>
      </div>
    `;
    box.querySelectorAll('[data-goto]').forEach(a => a.addEventListener('click', () => gotoView(a.dataset.goto)));

    drawHoursChart('ovHours', receipts);
    drawPayDonut('ovPay', cash, nonCash);
    bumpSync();
  } catch (e) {
    box.innerHTML = errBar('Не удалось загрузить обзор: ' + (e.message || e));
  }
}

function computeReturns(report) {
  // сумма возвратов = насколько отрицательна колонка «Итого» относительно суммы продаж не даёт прямо,
  // но grand.total = продажи − возвраты. Возвраты отдельно не приходят → оцениваем как 0, если нет данных.
  // Backend history отфильтровывает возвраты, а sales-report уже вычитает их из total.
  // Возвраты по магазинам не разложены отдельно, поэтому показываем 0.00 при отсутствии.
  return 0;
}
function pct(part, whole) {
  if (!whole) return '';
  return `${((part / whole) * 100).toFixed(1)}% от продаж`;
}
function kpi(ic, label, valHtml, tone, sub) {
  return `<div class="kpi">
    <div class="kpi-top"><span class="kpi-ic ${tone||''}">${ic}</span><span class="kpi-label">${label}</span></div>
    <div class="kpi-val tnum">${valHtml}</div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
  </div>`;
}
function gotoView(v) {
  const btn = document.querySelector(`.sb-item[data-view="${v}"]`);
  if (btn) btn.click();
}

// график продаж по часам (по Душанбе)
function drawHoursChart(canvasId, receipts) {
  const el = $(canvasId); if (!el) return;
  const buckets = new Array(24).fill(0);
  receipts.forEach(r => {
    const d = new Date(r.date); if (isNaN(d)) return;
    const h = new Date(d.getTime() + 5 * 3600 * 1000).getUTCHours();
    buckets[h] += r.total;
  });
  const labels = []; const data = [];
  for (let h = 8; h <= 22; h++) { labels.push(String(h).padStart(2,'0') + ':00'); data.push(Math.round(buckets[h])); }
  destroyChart(canvasId);
  state.charts[canvasId] = new Chart(el, {
    type: 'line',
    data: { labels, datasets: [{ data, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,.12)', fill: true, tension: .35, pointRadius: 3, pointBackgroundColor: '#10b981', borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, grid: { color: '#eef2f1' }, ticks: { callback: v => v >= 1000 ? (v/1000)+'K' : v } }, x: { grid: { display: false } } } }
  });
}
function drawPayDonut(canvasId, cash, nonCash) {
  const el = $(canvasId); if (!el) return;
  destroyChart(canvasId);
  const total = cash + nonCash;
  state.charts[canvasId] = new Chart(el, {
    type: 'doughnut',
    data: { labels: ['Наличные','Безналичные'], datasets: [{ data: [Math.round(cash), Math.round(nonCash)], backgroundColor: ['#10b981','#3b82f6'], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false } } }
  });
}
function destroyChart(id) { if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; } }

// ══════════════════════════════════════════════════════════
//  РАЗДЕЛ: СМЕНА
// ══════════════════════════════════════════════════════════
async function renderShift(force) {
  const box = $('shBody');
  box.innerHTML = `<div class="loading">⏳ Загружаю смены…</div>`;
  try {
    const d = await cachedApi('shifts', `?action=shifts-active`);
    let shifts = d.shifts || [];
    if (state.kassa) {
      const kn = (state.kassas.find(k => k.ref === state.kassa) || {}).name;
      if (kn) shifts = shifts.filter(s => s.kassaName === kn || s.shopName === kn);
    }
    const open = shifts.filter(s => s.status === 'open');
    const cur = open[0] || null;

    box.innerHTML = `
      <div class="shift-cards">
        <div class="card card-pad">
          <div class="card-h">Текущая смена</div>
          ${cur ? `
            <div style="margin-bottom:12px"><span class="badge ok"><span class="dot on"></span> Смена открыта</span></div>
            <div class="info-row"><span class="k">№ смены</span><span class="v">${esc(cur.c1ShiftNumber || cur.id || '—')}</span></div>
            <div class="info-row"><span class="k">Магазин</span><span class="v">${esc(cur.shopName || '—')}</span></div>
            <div class="info-row"><span class="k">Касса</span><span class="v">${esc(cur.kassaName || '—')}</span></div>
            <div class="info-row"><span class="k">Продавец</span><span class="v">${esc(cur.seller || cur.openedBy || '—')}</span></div>
            <div class="info-row"><span class="k">Открыта</span><span class="v">${dushTime(cur.openedAt,true)}</span></div>
          ` : `<div class="tbl-empty">Нет открытых смен${state.kassa ? ' по выбранной кассе' : ''}</div>`}
        </div>

        <div class="card card-pad">
          <div class="card-h">Финансовые итоги смены</div>
          ${cur ? `
            <div class="fin-row"><span class="k">Продажи</span><span class="v g">${money(cur.totalSales)}</span></div>
            <div class="fin-row"><span class="k">Чеков</span><span class="v">${fmtInt(cur.receipts)}</span></div>
            <div class="fin-row total"><span>Итого выручка</span><span class="v g">${money(cur.totalSales)}</span></div>
            <div style="margin-top:10px;font-size:12px;color:var(--tx3)">Синхронизация с 1С: ${esc(cur.c1SyncStatus || '—')}</div>
          ` : `<div class="tbl-empty">—</div>`}
        </div>

        <div class="card card-pad">
          <div class="card-h">Активные смены сейчас</div>
          <div class="info-row"><span class="k">Открыто смен</span><span class="v g">${open.length} из ${shifts.length}</span></div>
          <div class="mini-list" style="margin-top:6px">
            ${open.length ? open.map(s => `<div class="mini-row"><span><span class="dot on"></span>&nbsp;<span class="mini-name">${esc(s.shopName || s.kassaName)}</span></span><span class="mini-val tnum">${fmtNum(s.totalSales)}</span></div>`).join('')
              : `<div class="tbl-empty">Открытых смен нет</div>`}
          </div>
        </div>
      </div>

      <div class="card card-pad">
        <div class="card-h-row"><h3>Смены (сегодня + недавние)</h3></div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>№ смены</th><th>Статус</th><th>Продавец</th><th>Касса</th><th>Открыта</th><th>Закрыта</th><th class="r">Чеков</th><th class="r">Выручка</th></tr></thead>
            <tbody>${shifts.length ? shifts.map(s => `
              <tr>
                <td class="strong">${esc(s.c1ShiftNumber || s.id || '—')}</td>
                <td>${s.status === 'open' ? '<span class="badge ok"><span class="dot on"></span> Открыта</span>' : '<span class="badge off"><span class="dot offd"></span> Закрыта</span>'}</td>
                <td>${esc(s.seller || s.openedBy || '—')}</td>
                <td class="muted">${esc(s.kassaName || '—')}</td>
                <td class="muted">${dushTime(s.openedAt,true)}</td>
                <td class="muted">${s.closedAt ? dushTime(s.closedAt,true) : '—'}</td>
                <td class="r tnum">${fmtInt(s.receipts)}</td>
                <td class="r strong tnum">${fmtNum(s.totalSales)}</td>
              </tr>`).join('')
              : `<tr><td class="tbl-empty" colspan="8">Смен за сегодня нет</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="hint">ℹ Действия со сменами (открыть/закрыть/инкассация) появятся на следующем этапе — сейчас раздел работает в режиме просмотра.</div>
      </div>
    `;
    bumpSync();
  } catch (e) {
    box.innerHTML = errBar('Не удалось загрузить смены: ' + (e.message || e));
  }
}

// ══════════════════════════════════════════════════════════
//  РАЗДЕЛ: ЧЕКИ ПРОДАЖ
// ══════════════════════════════════════════════════════════
let rcFilters = { seller: '', q: '', min: '', max: '' };
async function renderReceipts(force) {
  const box = $('rcBody');
  box.innerHTML = `<div class="loading">⏳ Загружаю чеки…</div>`;
  try {
    const hist = await cachedApi(`hist:${state.from}:${state.to}:${state.kassa}`, `?action=history&from=${state.from}&to=${state.to}${kassaQS()}`);
    let receipts = (hist.receipts || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));

    // продавцы для фильтра
    const sellers = [...new Set(receipts.map(r => r.seller).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));

    // применяем клиентские фильтры
    const f = rcFilters;
    let rows = receipts.filter(r => {
      if (f.seller && r.seller !== f.seller) return false;
      if (f.q) { const q = f.q.toLowerCase(); if (!String(r.number).toLowerCase().includes(q) && !String(r.seller).toLowerCase().includes(q) && !String(r.total).includes(q)) return false; }
      if (f.min && r.total < Number(f.min)) return false;
      if (f.max && r.total > Number(f.max)) return false;
      return true;
    });

    const total = rows.reduce((s, x) => s + x.total, 0);
    const cnt = rows.length;
    const avg = cnt ? total / cnt : 0;

    box.innerHTML = `
      <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
        ${kpi('🧾','Чеков', fmtInt(cnt),'gray','')}
        ${kpi('💵','Сумма продаж', money(total),'g','')}
        ${kpi('📊','Средний чек', money(avg),'gray','')}
        ${kpi('🏪','Магазинов', fmtInt(new Set(rows.map(r=>r.shop)).size),'gray','')}
      </div>

      <div class="cols-main">
        <div class="card card-pad">
          <div class="card-h-row"><h3>Чеки за ${state.from === state.to ? state.from : state.from+' — '+state.to}</h3></div>
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>№ чека</th><th>Время</th><th>Продавец</th><th>Магазин</th><th class="r">Сумма</th><th class="c">Статус</th></tr></thead>
              <tbody>${rows.length ? rows.map(r => `
                <tr>
                  <td class="strong">${esc(r.number)}</td>
                  <td class="muted">${dushTime(r.date,false)}</td>
                  <td>${esc(r.seller)}</td>
                  <td class="muted">${esc(r.shop)}</td>
                  <td class="r strong tnum">${fmtNum(r.total)}</td>
                  <td class="c"><span class="badge ok">Оплачен</span></td>
                </tr>`).join('')
                : `<tr><td class="tbl-empty" colspan="6">За выбранный период чеков нет</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card card-pad">
          <div class="card-h-row"><h3>Фильтры</h3><a class="link" id="rcReset">Сбросить</a></div>
          <div class="filters">
            <label><div class="flabel">Поиск по чеку/продавцу/сумме</div><input class="finput" id="rcQ" value="${esc(f.q)}" placeholder="Например: 012371"></label>
            <label><div class="flabel">Продавец</div>
              <select class="fselect" id="rcSeller">
                <option value="">Все продавцы</option>
                ${sellers.map(s => `<option value="${esc(s)}" ${f.seller===s?'selected':''}>${esc(s)}</option>`).join('')}
              </select>
            </label>
            <div style="display:flex;gap:10px">
              <label style="flex:1"><div class="flabel">Сумма от</div><input class="finput" id="rcMin" type="number" value="${esc(f.min)}" placeholder="0"></label>
              <label style="flex:1"><div class="flabel">Сумма до</div><input class="finput" id="rcMax" type="number" value="${esc(f.max)}" placeholder="0"></label>
            </div>
            <button class="btn btn-primary btn-block" id="rcApply">Применить фильтры</button>
          </div>
        </div>
      </div>
    `;

    // обработчики фильтров
    $('rcApply').addEventListener('click', () => {
      rcFilters = { q: $('rcQ').value.trim(), seller: $('rcSeller').value, min: $('rcMin').value, max: $('rcMax').value };
      renderReceipts();
    });
    $('rcReset').addEventListener('click', () => { rcFilters = { seller:'', q:'', min:'', max:'' }; renderReceipts(); });
    $('rcQ').addEventListener('keydown', e => { if (e.key === 'Enter') $('rcApply').click(); });
    bumpSync();
  } catch (e) {
    box.innerHTML = errBar('Не удалось загрузить чеки: ' + (e.message || e));
  }
}

// ══════════════════════════════════════════════════════════
//  СТАРТ
// ══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initLogin();
  if (tryRestoreAuth()) enterApp();
});
