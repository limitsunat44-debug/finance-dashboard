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
  returns:   { title: 'Возвраты',           sub: 'Чеки-возвраты за выбранный период' },
  discounts: { title: 'Скидки',            sub: 'Сводка применённых скидок за период' },
  cards:     { title: 'Дисконтные карты', sub: 'Виртуальные карты клиентов, врачей и сотрудников' },
  search:    { title: 'Поиск товара', sub: 'Проверка остатка, цены и статуса по штрихкоду' },
  history:   { title: 'История товара', sub: 'Жизненный цикл экземпляра по штрихкоду' },
};
const READY_VIEWS = ['overview', 'shift', 'receipts', 'returns', 'discounts', 'cards', 'search', 'history'];

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
  else if (v === 'returns') renderReturns(force);
  else if (v === 'discounts') renderDiscounts(force);
  else if (v === 'cards') renderCards(force);
  else if (v === 'search') renderSearch(force);
  else if (v === 'history') renderHistory(force);
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
            <table class="tbl tbl-receipts">
              <thead><tr><th style="width:34px"></th><th>№ чека</th><th>Время</th><th>Продавец</th><th>Магазин</th><th class="r">Сумма</th><th class="c">Статус</th></tr></thead>
              <tbody>${rows.length ? rows.map((r, i) => `
                <tr class="rc-row" data-ref="${esc(r.ref || '')}" data-num="${esc(r.number)}" data-idx="${i}">
                  <td class="c rc-caret"><span class="caret">›</span></td>
                  <td class="strong">${esc(r.number)}</td>
                  <td class="muted">${dushTime(r.date,false)}</td>
                  <td>${esc(r.seller)}</td>
                  <td class="muted">${esc(r.shop)}</td>
                  <td class="r strong tnum">${fmtNum(r.total)}</td>
                  <td class="c"><span class="badge ok">Оплачен</span></td>
                </tr>
                <tr class="rc-detail" id="rcDet-${i}" style="display:none"><td colspan="7" class="rc-detail-cell"><div class="rc-detail-inner" id="rcDetBody-${i}"></div></td></tr>`).join('')
                : `<tr><td class="tbl-empty" colspan="7">За выбранный период чеков нет</td></tr>`}
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

    // раскрытие состава чека по клику по строке
    box.querySelectorAll('.rc-row').forEach(tr => {
      tr.addEventListener('click', () => toggleReceipt(tr));
    });
    bumpSync();
  } catch (e) {
    box.innerHTML = errBar('Не удалось загрузить чеки: ' + (e.message || e));
  }
}

// ═════════════════════════════════════════════════════
//  РАЗДЕЛ: ВОЗВРАТЫ
// ═════════════════════════════════════════════════════
let rtFilters = { seller: '', q: '', min: '', max: '' };
async function renderReturns(force) {
  const box = $('rtBody');
  box.innerHTML = `<div class="loading">⏳ Загружаю возвраты…</div>`;
  try {
    const data = await cachedApi(`ret:${state.from}:${state.to}:${state.kassa}`, `?action=returns&from=${state.from}&to=${state.to}${kassaQS()}`);
    let returns = (data.returns || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));

    const sellers = [...new Set(returns.map(r => r.seller).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));

    const f = rtFilters;
    let rows = returns.filter(r => {
      if (f.seller && r.seller !== f.seller) return false;
      if (f.q) { const q = f.q.toLowerCase(); if (!String(r.number).toLowerCase().includes(q) && !String(r.seller).toLowerCase().includes(q) && !String(r.total).includes(q) && !String(r.reason||'').toLowerCase().includes(q)) return false; }
      if (f.min && r.total < Number(f.min)) return false;
      if (f.max && r.total > Number(f.max)) return false;
      return true;
    });

    const total = rows.reduce((s, x) => s + x.total, 0);
    const cnt = rows.length;
    const avg = cnt ? total / cnt : 0;

    box.innerHTML = `
      <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
        ${kpi('↩','Возвратов', fmtInt(cnt),'gray','')}
        ${kpi('💸','Сумма возвратов', money(total),'r','')}
        ${kpi('📊','Средний возврат', money(avg),'gray','')}
        ${kpi('🏪','Магазинов', fmtInt(new Set(rows.map(r=>r.shop)).size),'gray','')}
      </div>

      <div class="cols-main">
        <div class="card card-pad">
          <div class="card-h-row"><h3>Возвраты за ${state.from === state.to ? state.from : state.from+' — '+state.to}</h3></div>
          <div class="tbl-wrap">
            <table class="tbl tbl-receipts">
              <thead><tr><th style="width:34px"></th><th>№ чека</th><th>Время</th><th>Продавец</th><th>Магазин</th><th>Причина</th><th class="r">Сумма</th></tr></thead>
              <tbody>${rows.length ? rows.map((r, i) => `
                <tr class="rc-row" data-ref="${esc(r.ref || '')}" data-num="${esc(r.number)}" data-idx="rt${i}">
                  <td class="c rc-caret"><span class="caret">›</span></td>
                  <td class="strong">${esc(r.number)}</td>
                  <td class="muted">${dushTime(r.date,false)}</td>
                  <td>${esc(r.seller)}</td>
                  <td class="muted">${esc(r.shop)}</td>
                  <td class="muted">${r.reason ? esc(r.reason) : '—'}</td>
                  <td class="r strong tnum" style="color:var(--red,#dc2626)">−${fmtNum(r.total)}</td>
                </tr>
                <tr class="rc-detail" id="rcDet-rt${i}" style="display:none"><td colspan="7" class="rc-detail-cell"><div class="rc-detail-inner" id="rcDetBody-rt${i}"></div></td></tr>`).join('')
                : `<tr><td class="tbl-empty" colspan="7">За выбранный период возвратов нет</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card card-pad">
          <div class="card-h-row"><h3>Фильтры</h3><a class="link" id="rtReset">Сбросить</a></div>
          <div class="filters">
            <label><div class="flabel">Поиск по чеку/продавцу/причине</div><input class="finput" id="rtQ" value="${esc(f.q)}" placeholder="Например: Обмен"></label>
            <label><div class="flabel">Продавец</div>
              <select class="fselect" id="rtSeller">
                <option value="">Все продавцы</option>
                ${sellers.map(s => `<option value="${esc(s)}" ${f.seller===s?'selected':''}>${esc(s)}</option>`).join('')}
              </select>
            </label>
            <div style="display:flex;gap:10px">
              <label style="flex:1"><div class="flabel">Сумма от</div><input class="finput" id="rtMin" type="number" value="${esc(f.min)}" placeholder="0"></label>
              <label style="flex:1"><div class="flabel">Сумма до</div><input class="finput" id="rtMax" type="number" value="${esc(f.max)}" placeholder="0"></label>
            </div>
            <button class="btn btn-primary btn-block" id="rtApply">Применить фильтры</button>
          </div>
        </div>
      </div>
    `;

    $('rtApply').addEventListener('click', () => {
      rtFilters = { q: $('rtQ').value.trim(), seller: $('rtSeller').value, min: $('rtMin').value, max: $('rtMax').value };
      renderReturns();
    });
    $('rtReset').addEventListener('click', () => { rtFilters = { seller:'', q:'', min:'', max:'' }; renderReturns(); });
    $('rtQ').addEventListener('keydown', e => { if (e.key === 'Enter') $('rtApply').click(); });

    box.querySelectorAll('.rc-row').forEach(tr => {
      tr.addEventListener('click', () => toggleReceipt(tr));
    });
    bumpSync();
  } catch (e) {
    box.innerHTML = errBar('Не удалось загрузить возвраты: ' + (e.message || e));
  }
}

// ═════════════════════════════════════════════════════
//  РАЗДЕЛ: СКИДКИ
// ═════════════════════════════════════════════════════
// горизонтальные бары: список {label,value}, макс — для нормировки ширины
function hbars(items, opt) {
  const o = opt || {};
  const max = Math.max(1, ...items.map(x => x.value));
  return `<div class="ds-bars">` + items.map(x => {
    const w = Math.max(2, (x.value / max) * 100);
    return `<div class="ds-bar-row">
      <div class="ds-bar-label" title="${esc(x.label)}">${esc(x.label)}</div>
      <div class="ds-bar-track"><div class="ds-bar-fill" style="width:${w}%"></div></div>
      <div class="ds-bar-val tnum">${o.money ? money(x.value) : fmtNum(x.value)}${x.extra ? ` <span class="muted">${esc(x.extra)}</span>` : ''}</div>
    </div>`;
  }).join('') + `</div>`;
}

async function renderDiscounts(force) {
  const box = $('dsBody');
  box.innerHTML = `<div class="loading">⏳ Считаю скидки (тянется состав всех чеков)…</div>`;
  try {
    const d = await cachedApi(`disc:${state.from}:${state.to}:${state.kassa}`, `?action=discounts&from=${state.from}&to=${state.to}${kassaQS()}`);
    const shareReceipts = d.receipts ? (d.receiptsWithDisc / d.receipts) * 100 : 0;

    const pctItems = Object.entries(d.pctBuckets || {}).map(([k, v]) => ({ label: k, value: v }));
    const sellerItems = (d.bySeller || []).slice(0, 8).map(s => ({ label: s.name, value: s.discount }));
    const shopItems = (d.byShop || []).map(s => ({ label: s.name, value: s.discount }));

    box.innerHTML = `
      <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
        ${kpi('%','Сумма скидок', money(d.totalDiscount||0),'g','')}
        ${kpi('📉','Средний % скидки', (d.avgPct||0).toFixed(1)+'%','gray','от оборота до скидки')}
        ${kpi('🧾','Чеков со скидкой', fmtInt(d.receiptsWithDisc||0),'gray', fmtInt(d.receipts||0)+' всего · '+shareReceipts.toFixed(0)+'%')}
        ${kpi('💰','Оборот до скидки', money(d.totalBase||0),'gray','нетто '+money(d.totalNet||0))}
      </div>

      <div class="cols-2">
        <div class="card card-pad">
          <div class="card-h-row"><h3>Скидки по диапазонам %</h3></div>
          ${pctItems.some(x=>x.value>0) ? hbars(pctItems, {money:true}) : '<div class="tbl-empty">Нет данных</div>'}
        </div>
        <div class="card card-pad">
          <div class="card-h-row"><h3>Скидки по магазинам</h3></div>
          ${shopItems.length ? hbars(shopItems, {money:true}) : '<div class="tbl-empty">Нет данных</div>'}
        </div>
      </div>

      <div class="cols-2">
        <div class="card card-pad">
          <div class="card-h-row"><h3>Топ продавцов по скидкам</h3></div>
          ${sellerItems.length ? hbars(sellerItems, {money:true}) : '<div class="tbl-empty">Нет данных</div>'}
        </div>
        <div class="card card-pad">
          <div class="card-h-row"><h3>Топ товаров по скидкам</h3></div>
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th style="width:30px">#</th><th>Товар</th><th class="c">Кол-во</th><th class="r">Скидка</th></tr></thead>
              <tbody>${(d.topProducts||[]).length ? d.topProducts.map((p,i)=>`
                <tr><td class="c muted">${i+1}</td><td class="strong">${esc(p.name)}${p.barcode?` <span class="muted rc-bc">${esc(p.barcode)}</span>`:''}</td><td class="c tnum">${fmtInt(p.qty)}</td><td class="r strong tnum">${fmtNum(p.discount)}</td></tr>`).join('')
                : `<tr><td class="tbl-empty" colspan="4">Нет скидок за период</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    bumpSync();
  } catch (e) {
    box.innerHTML = errBar('Не удалось загрузить скидки: ' + (e.message || e));
  }
}

// ═════════════════════════════════════════════════════
//  РАЗДЕЛ: ДИСКОНТНЫЕ КАРТЫ
// ═════════════════════════════════════════════════════
const cdState = { q: '', type: '', page: 0, per: 50 };
const CARD_TYPE_CLASS = { client: 'g', doctor: 'blue', employee: 'amber' };
async function renderCards(force) {
  const box = $('cdBody');
  box.innerHTML = `<div class="loading">⏳ Загружаю карты…</div>`;
  try {
    const off = cdState.page * cdState.per;
    const qs = `?action=cards&limit=${cdState.per}&offset=${off}`
      + (cdState.q ? `&q=${encodeURIComponent(cdState.q)}` : '')
      + (cdState.type ? `&type=${encodeURIComponent(cdState.type)}` : '');
    const d = await posApi(qs, { method: 'GET' });
    const s = d.stats || { total: 0, active: 0, byType: {} };
    const bt = s.byType || {};
    const totalPages = Math.max(1, Math.ceil((d.count || 0) / cdState.per));
    const pageNow = cdState.page + 1;

    box.innerHTML = `
      <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">
        ${kpi('💳','Всего карт', fmtInt(s.total||0),'gray', fmtInt(s.active||0)+' активных')}
        ${kpi('👤','Клиентские', fmtInt((bt.client||{}).count||0),'g','скидка 10%')}
        ${kpi('🩺','Врачебные', fmtInt((bt.doctor||{}).count||0),'blue','без скидки')}
        ${kpi('👷','Сотрудники', fmtInt((bt.employee||{}).count||0),'amber','скидка 10%')}
      </div>

      <div class="card card-pad">
        <div class="card-h-row">
          <h3>Карты${cdState.q||cdState.type ? ` — найдено ${fmtInt(d.count||0)}` : ''}</h3>
        </div>
        <div class="filters filters-row">
          <input class="finput" id="cdQ" value="${esc(cdState.q)}" placeholder="Поиск по имени или коду карты…" style="flex:2;min-width:220px">
          <select class="fselect" id="cdType" style="flex:1;min-width:150px">
            <option value="" ${cdState.type===''?'selected':''}>Все типы</option>
            <option value="client" ${cdState.type==='client'?'selected':''}>Клиентские</option>
            <option value="doctor" ${cdState.type==='doctor'?'selected':''}>Врачебные</option>
            <option value="employee" ${cdState.type==='employee'?'selected':''}>Сотрудники</option>
          </select>
          <button class="btn btn-primary" id="cdSearch">Найти</button>
          <button class="btn" id="cdReset">Сброс</button>
        </div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th style="width:30px">#</th><th>Код карты</th><th>Имя</th><th class="c">Тип</th><th class="c">Скидка</th><th>Создана</th></tr></thead>
            <tbody>${(d.cards||[]).length ? d.cards.map((c,i)=>`
              <tr>
                <td class="c muted">${off+i+1}</td>
                <td class="strong rc-bc">${esc(c.code||'—')}</td>
                <td>${esc(c.name||'Без имени')}</td>
                <td class="c"><span class="badge ${CARD_TYPE_CLASS[c.type]||''}">${esc(c.typeLabel)}</span></td>
                <td class="c tnum">${c.discountPct?c.discountPct+'%':'—'}</td>
                <td class="muted">${c.createdAt?dushTime(c.createdAt,true):'—'}</td>
              </tr>`).join('')
              : `<tr><td class="tbl-empty" colspan="6">Карты не найдены</td></tr>`}</tbody>
          </table>
        </div>
        <div class="pager">
          <button class="btn" id="cdPrev" ${cdState.page<=0?'disabled':''}>← Назад</button>
          <span class="pager-info">Стр. ${pageNow} из ${totalPages}</span>
          <button class="btn" id="cdNext" ${pageNow>=totalPages?'disabled':''}>Вперёд →</button>
        </div>
      </div>
    `;

    const doSearch = () => { cdState.q = $('cdQ').value.trim(); cdState.type = $('cdType').value; cdState.page = 0; renderCards(); };
    $('cdSearch').addEventListener('click', doSearch);
    $('cdQ').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    $('cdType').addEventListener('change', doSearch);
    $('cdReset').addEventListener('click', () => { cdState.q=''; cdState.type=''; cdState.page=0; renderCards(); });
    $('cdPrev').addEventListener('click', () => { if (cdState.page>0){ cdState.page--; renderCards(); } });
    $('cdNext').addEventListener('click', () => { if (pageNow<totalPages){ cdState.page++; renderCards(); } });
    bumpSync();
  } catch (e) {
    box.innerHTML = errBar('Не удалось загрузить карты: ' + (e.message || e));
  }
}

// ═════════════════════════════════════════════════════
//  РАЗДЕЛ: ПОИСК ТОВАРА (скан/ввод штрихкода)
// ═════════════════════════════════════════════════════
const STATUS_META = {
  in_stock: { label: 'В наличии',    cls: 'g'  },
  sold:     { label: 'Продан',       cls: 'r'  },
  reserved: { label: 'Зарезервирован', cls: 'amber' },
  written_off: { label: 'Списан',    cls: 'r' },
};
let scLast = '';
async function renderSearch(force) {
  const box = $('scBody');
  // статичный каркас — рисуем один раз
  if (!box.dataset.ready) {
    box.innerHTML = `
      <div class="card card-pad">
        <div class="sc-search">
          <input class="finput" id="scInput" inputmode="numeric" autocomplete="off"
                 placeholder="Отсканируйте или введите штрихкод…">
          <button class="btn btn-primary" id="scGo">Найти</button>
        </div>
        <div class="muted" style="font-size:12.5px;margin-top:8px">Сканер обычно сам добавляет Enter — поиск запустится автоматически.</div>
      </div>
      <div id="scResult" style="margin-top:16px"></div>`;
    box.dataset.ready = '1';
    const go = () => scanOne($('scInput').value.trim());
    $('scGo').addEventListener('click', go);
    $('scInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  }
  setTimeout(() => { const el = $('scInput'); if (el) el.focus(); }, 60);
}

async function scanOne(code) {
  const rbox = $('scResult');
  if (!code) { rbox.innerHTML = ''; return; }
  scLast = code;
  rbox.innerHTML = `<div class="loading">⏳ Ищу «${esc(code)}»…</div>`;
  try {
    const d = await posApi(`?action=scan&barcode=${encodeURIComponent(code)}`, { method: 'GET' });
    if (scLast !== code) return; // отменили более новым сканом
    const it = d.item || {};
    if (!it.found) {
      rbox.innerHTML = `<div class="card card-pad sc-empty">
        <div class="sc-empty-ic">❗</div>
        <div><div class="strong">Штрихкод не найден</div>
        <div class="muted">Код <b>${esc(code)}</b> отсутствует в базе товаров${it.reason?' — '+esc(it.reason):''}.</div></div>
      </div>`;
      return;
    }
    const st = STATUS_META[it.status] || { label: it.status || '—', cls: 'gray' };
    const isInstance = it.kind === 'instance';
    const avail = Number(it.availableAtShop) || 0;
    rbox.innerHTML = `
      <div class="card card-pad sc-card">
        <div class="sc-head">
          <div class="sc-title">${esc(it.name || 'Без названия')}</div>
          <span class="badge ${st.cls}">${esc(st.label)}</span>
        </div>
        <div class="sc-grid">
          <div class="sc-cell"><div class="sc-k">Цена</div><div class="sc-v big">${money(it.price||0)}</div>
            ${it.priceOld && it.priceOld>it.price ? `<div class="sc-old">${money(it.priceOld)}</div>` : ''}</div>
          <div class="sc-cell"><div class="sc-k">Остаток</div><div class="sc-v big ${avail>0?'pos':'neg'}">${fmtInt(avail)} шт</div></div>
          <div class="sc-cell"><div class="sc-k">Размер</div><div class="sc-v">${esc(it.sizeLabel || '—')}</div></div>
          <div class="sc-cell"><div class="sc-k">Тип</div><div class="sc-v">${isInstance?'Экземпляр (уник. штрихкод)':'Модель (общий штрихкод)'}</div></div>
          <div class="sc-cell"><div class="sc-k">Штрихкод</div><div class="sc-v rc-bc">${esc(it.uniqueBarcode || it.barcode || code)}</div></div>
        </div>
        ${it.warning ? `<div class="sc-warn">⚠ ${esc(it.warning)}</div>` : ''}
      </div>`;
  } catch (e) {
    if (scLast !== code) return;
    rbox.innerHTML = errBar('Ошибка поиска: ' + (e.message || e));
  } finally {
    const el = $('scInput'); if (el) { el.select(); }
  }
}

// ═════════════════════════════════════════════════════
//  РАЗДЕЛ: ИСТОРИЯ ТОВАРА (таймлайн экземпляра)
// ═════════════════════════════════════════════════════
const EV_META = {
  received:    { ic: '📦', cls: 'g'  },
  printed:     { ic: '🖨️', cls: 'gray' },
  moved:       { ic: '🚚', cls: 'blue' },
  sold:        { ic: '💰', cls: 'g'  },
  returned:    { ic: '↩️', cls: 'amber' },
  written_off: { ic: '🗑️', cls: 'r' },
};
let htLast = '';
async function renderHistory(force) {
  const box = $('htBody');
  if (!box.dataset.ready) {
    box.innerHTML = `
      <div class="card card-pad">
        <div class="sc-search">
          <input class="finput" id="htInput" inputmode="numeric" autocomplete="off"
                 placeholder="Отсканируйте или введите штрихкод экземпляра…">
          <button class="btn btn-primary" id="htGo">Показать</button>
        </div>
        <div class="muted" style="font-size:12.5px;margin-top:8px">История доступна только для экземпляров с уникальным штрихкодом.</div>
      </div>
      <div id="htResult" style="margin-top:16px"></div>`;
    box.dataset.ready = '1';
    const go = () => histOne($('htInput').value.trim());
    $('htGo').addEventListener('click', go);
    $('htInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  }
  setTimeout(() => { const el = $('htInput'); if (el) el.focus(); }, 60);
}

async function histOne(code) {
  const rbox = $('htResult');
  if (!code) { rbox.innerHTML = ''; return; }
  htLast = code;
  rbox.innerHTML = `<div class="loading">⏳ Загружаю историю «${esc(code)}»…</div>`;
  try {
    const d = await posApi(`?action=unit-history&barcode=${encodeURIComponent(code)}`, { method: 'GET' });
    if (htLast !== code) return;
    if (!d.found) {
      rbox.innerHTML = `<div class="card card-pad sc-empty">
        <div class="sc-empty-ic">❗</div>
        <div><div class="strong">Экземпляр не найден</div>
        <div class="muted">Штрихкод <b>${esc(code)}</b> не принадлежит ни одному экземпляру.</div></div></div>`;
      return;
    }
    const u = d.unit || {};
    const st = STATUS_META[u.status] || { label: u.status || '—', cls: 'gray' };
    const evs = d.events || [];
    const timeline = evs.length ? evs.map(e => {
      const m = EV_META[e.type] || { ic: '•', cls: 'gray' };
      const meta = [];
      if (e.doc) meta.push(`док: <b>${esc(e.doc)}</b>`);
      if (e.place) meta.push(esc(e.place));
      if (e.who) meta.push('продавец: ' + esc(e.who));
      if (e.reason) meta.push('причина: ' + esc(e.reason));
      return `<div class="ht-ev">
        <div class="ht-dot ${m.cls}">${m.ic}</div>
        <div class="ht-body">
          <div class="ht-ev-h"><span class="ht-ev-label">${esc(e.label)}</span><span class="ht-ev-time">${dushTime(e.at, true)}</span></div>
          ${meta.length ? `<div class="ht-ev-meta">${meta.join(' · ')}</div>` : ''}
        </div>
      </div>`;
    }).join('') : `<div class="muted" style="padding:12px">Нет зафиксированных событий.</div>`;

    rbox.innerHTML = `
      <div class="card card-pad sc-card">
        <div class="sc-head">
          <div class="sc-title">${esc(u.name || 'Без названия')}</div>
          <span class="badge ${st.cls}">${esc(st.label)}</span>
        </div>
        <div class="sc-grid" style="margin-bottom:20px">
          <div class="sc-cell"><div class="sc-k">Цена</div><div class="sc-v big">${money(u.price||0)}</div></div>
          <div class="sc-cell"><div class="sc-k">Размер</div><div class="sc-v">${esc(u.sizeLabel || '—')}</div></div>
          <div class="sc-cell"><div class="sc-k">Текущий склад</div><div class="sc-v">${esc(u.warehouse || '—')}</div></div>
          <div class="sc-cell"><div class="sc-k">Штрихкод</div><div class="sc-v rc-bc">${esc(code)}</div></div>
        </div>
        <div class="ht-timeline">${timeline}</div>
        ${u.note ? `<div class="sc-warn" style="margin-top:16px">📝 ${esc(u.note)}</div>` : ''}
      </div>`;
  } catch (e) {
    if (htLast !== code) return;
    rbox.innerHTML = errBar('Ошибка загрузки истории: ' + (e.message || e));
  } finally {
    const el = $('htInput'); if (el) el.select();
  }
}

// кеш состава чеков по ref (чтобы не дёргать 1С при повторном раскрытии)
const rcItemsCache = {};
async function toggleReceipt(tr) {
  const idx = tr.dataset.idx;
  const ref = tr.dataset.ref;
  const num = tr.dataset.num;
  const detRow = $('rcDet-' + idx);
  const body = $('rcDetBody-' + idx);
  const caret = tr.querySelector('.caret');
  if (!detRow || !body) return;

  // тоггл: если открыт — закрываем
  if (detRow.style.display !== 'none') {
    detRow.style.display = 'none';
    tr.classList.remove('open');
    if (caret) caret.textContent = '›';
    return;
  }
  detRow.style.display = '';
  tr.classList.add('open');
  if (caret) caret.textContent = '‹';

  if (!ref) { body.innerHTML = `<div class="rc-det-empty">⚠ У чека нет идентификатора — состав недоступен</div>`; return; }

  // из кеша
  if (rcItemsCache[ref]) { body.innerHTML = renderReceiptItems(rcItemsCache[ref], num); return; }

  body.innerHTML = `<div class="rc-det-loading">⏳ Загружаю состав чека…</div>`;
  try {
    const d = await posApi(`?action=receipt-items&ref=${encodeURIComponent(ref)}`, { method: 'GET' });
    rcItemsCache[ref] = d;
    // если за время загрузки строку не закрыли
    if (detRow.style.display !== 'none') body.innerHTML = renderReceiptItems(d, num);
  } catch (e) {
    body.innerHTML = `<div class="rc-det-err">⚠ Не удалось загрузить состав: ${esc(e.message || e)}</div>`;
  }
}

function renderReceiptItems(d, num) {
  const items = (d && d.items) || [];
  if (!items.length) return `<div class="rc-det-empty">В чеке нет позиций</div>`;
  const rows = items.map((it, i) => {
    const hasDisc = (it.discountSum && it.discountSum > 0) || (it.discountPct && it.discountPct > 0);
    const discTxt = hasDisc
      ? `<span class="rc-disc">−${fmtNum(it.discountSum || 0)}${it.discountPct ? ` (${it.discountPct}%)` : ''}</span>`
      : '<span class="muted">—</span>';
    return `<tr>
      <td class="c muted">${i + 1}</td>
      <td class="strong">${esc(it.name)}${it.sizeLabel ? ` <span class="rc-size">${esc(it.sizeLabel)}</span>` : ''}</td>
      <td class="muted rc-bc">${it.barcode ? esc(it.barcode) : '—'}</td>
      <td class="c tnum">${fmtInt(it.qty)} шт</td>
      <td class="r tnum">${fmtNum(it.priceUnit)}</td>
      <td class="r">${discTxt}</td>
      <td class="r strong tnum">${fmtNum(it.sum)}</td>
    </tr>`;
  }).join('');
  const total = (d.itemsTotal != null ? d.itemsTotal : d.docTotal) || 0;
  return `
    <div class="rc-det-head">🧾 Состав чека №${esc(num || d.number || '')} — ${fmtInt(items.length)} позиций</div>
    <div class="tbl-wrap">
      <table class="tbl rc-items">
        <thead><tr><th style="width:30px">#</th><th>Товар</th><th>Штрихкод</th><th class="c">Кол-во</th><th class="r">Цена</th><th class="r">Скидка</th><th class="r">Сумма</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="tbl-total"><td colspan="6" class="r">Итого</td><td class="r tnum">${fmtNum(total)} ${CUR}</td></tr></tfoot>
      </table>
    </div>`;
}

// ══════════════════════════════════════════════════════════
//  СТАРТ
// ══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initLogin();
  if (tryRestoreAuth()) enterApp();
});
