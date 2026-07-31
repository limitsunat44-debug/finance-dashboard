/* ══════════════════════════════════════════════════════════
   Администратор РМК — логика (этап 1: Обзор, Смена, Чеки)
   Данные: backend 1c-sync-barcodes /api/pos (тот же, что у кассы)
   Доступ: только админы с полным доступом (allowedTabs === '*')
   ══════════════════════════════════════════════════════════ */

// ─────────── Backend РМК ───────────
const BARCODE_SVC_URL = 'https://1c-sync-barcodes.vercel.app';
const BARCODE_SVC_SECRET = 'TySog2bN1bMJHsssoTvyCZO3IKOef1z0';

// ─────────── Аккаунты (синхронно с дашбордом) ───────────
// allowedTabs: '*' — полный доступ ко всем вкладкам;
// массив ключей VIEW_META — доступ ТОЛЬКО к перечисленным вкладкам.
const ADMIN_ACCOUNTS = {
  'Sunnat':   { password: 'Sunna0909', displayName: 'Sunnat',   allowedTabs: '*' },
  'Iskandar': { password: '1111',      displayName: 'Iskandar', allowedTabs: '*' },
  'Shahida':  { password: 's2364170',  displayName: 'Shahida',  allowedTabs: '*' },
  // Ограниченный доступ: только вкладка «Перемещение товаров»
  'umed':     { password: 'umed2026',  displayName: 'Umed',     allowedTabs: ['transfer'] },
};
// true, если у аккаунта есть хоть какой-то доступ в админку
function accHasAccess(acc) {
  return !!acc && (acc.allowedTabs === '*' || (Array.isArray(acc.allowedTabs) && acc.allowedTabs.length > 0));
}
// true, если аккаунту доступна конкретная вкладка
function accCanView(acc, view) {
  if (!acc) return false;
  if (acc.allowedTabs === '*') return true;
  return Array.isArray(acc.allowedTabs) && acc.allowedTabs.includes(view);
}
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
  allowedTabs: '*',    // '*' | ['transfer', ...]
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
    const acc = user && ADMIN_ACCOUNTS[user];
    if (accHasAccess(acc)) {
      state.user = acc.displayName;
      state.allowedTabs = acc.allowedTabs;
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
    if (!accHasAccess(acc)) {
      errEl.textContent = 'Нет доступа к админ-панели РМК';
      errEl.style.display = 'block';
      return;
    }
    localStorage.setItem(LS_KEY, JSON.stringify({ user: u, ts: Date.now() }));
    state.user = acc.displayName;
    state.allowedTabs = acc.allowedTabs;
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
  users:     { title: 'Пользователи', sub: 'Учётки касс/складов и веб-админы' },
  devices:   { title: 'Устройства касс', sub: 'Заявки на вход с мобильных устройств и одобренные устройства' },
  audit:     { title: 'Журнал действий', sub: 'Смены, продажи и возвраты в хронологии' },
  settings:  { title: 'Настройки РМК', sub: 'Магазины, кассы ККМ и параметры системы' },
  stats:     { title: 'Статистика', sub: 'Динамика продаж и топы за период' },
  monitoring:{ title: 'Мониторинг магазинов', sub: 'Статус касс и смен онлайн' },
  cashreport:{ title: 'Отчёт по снятию ДС', sub: 'Наличные к инкассации по закрытым сменам' },
  transfer:  { title: 'Перемещение товаров', sub: 'Перемещение между складами со сканером и документом 1С' },
  finance:   { title: 'Выручка-Расходы', sub: 'Выручка, расходы, долги поставщикам, зарплаты и чистая прибыль' },
};
const READY_VIEWS = ['overview', 'shift', 'receipts', 'returns', 'discounts', 'cards', 'search', 'history', 'users', 'devices', 'audit', 'settings', 'stats', 'monitoring', 'cashreport', 'transfer', 'finance'];

async function bootApp() {
  // фильтры даты
  $('fltFrom').value = state.from;
  $('fltTo').value = state.to;
  $('fltFrom').addEventListener('change', onFilterChange);
  $('fltTo').addEventListener('change', onFilterChange);
  $('fltKassa').addEventListener('change', () => { state.kassa = $('fltKassa').value; onFilterChange(); });
  $('btnSync').addEventListener('click', () => { state.cache = {}; renderView(true); });
  $('btnLogout').addEventListener('click', doLogout);

  // бургер-меню (мобильная версия)
  const burger = $('btnBurger');
  const overlay = $('sbOverlay');
  if (burger) burger.addEventListener('click', () => toggleSidebar());
  if (overlay) overlay.addEventListener('click', () => toggleSidebar(false));

  // Ограничение доступа: скрываем неразрешённые пункты меню и выбираем стартовый
  applyTabAccess();

  // навигация
  document.querySelectorAll('.sb-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.view;
      if (!accCanView({ allowedTabs: state.allowedTabs }, v)) return; // запрет на неразрешённые
      document.querySelectorAll('.sb-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.view = v;
      renderView();
      toggleSidebar(false); // авто-закрытие меню после выбора раздела на мобильном
    });
  });

  // загрузка списка касс для фильтра
  loadKassas();

  renderView();
  bumpSync();
}

// Применить ограничения доступа к вкладкам: скрыть неразрешённые пункты, выбрать первый доступный.
function applyTabAccess() {
  if (state.allowedTabs === '*') return; // полный доступ — ничего не прячем
  const items = document.querySelectorAll('.sb-item');
  let firstAllowed = null;
  items.forEach(btn => {
    const v = btn.dataset.view;
    if (accCanView({ allowedTabs: state.allowedTabs }, v)) {
      if (!firstAllowed) firstAllowed = v;
      btn.classList.remove('active');
    } else {
      btn.style.display = 'none'; // скрыть недоступную вкладку
    }
  });
  // стартовая вкладка — первая разрешённая
  if (firstAllowed) {
    state.view = firstAllowed;
    const activeBtn = document.querySelector('.sb-item[data-view="' + firstAllowed + '"]');
    if (activeBtn) activeBtn.classList.add('active');
  }
}

// Открыть/закрыть боковое меню на мобильных. force=true — открыть, false — закрыть, undefined — переключить.
function toggleSidebar(force) {
  const sb = $('sidebar'), ov = $('sbOverlay'), bg = $('btnBurger');
  if (!sb) return;
  const open = (force === undefined) ? !sb.classList.contains('open') : force;
  sb.classList.toggle('open', open);
  if (ov) ov.classList.toggle('show', open);
  if (bg) bg.classList.toggle('on', open);
  document.body.style.overflow = open ? 'hidden' : '';
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
  // Защита доступа: если текущая вкладка не разрешена — переключаемся на первую доступную
  if (!accCanView({ allowedTabs: state.allowedTabs }, state.view)) {
    const fallback = document.querySelector('.sb-item:not([style*="display: none"])');
    if (fallback) { state.view = fallback.dataset.view; }
  }
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
  else if (v === 'users') renderUsers(force);
  else if (v === 'devices') renderDevices(force);
  else if (v === 'audit') renderAudit(force);
  else if (v === 'settings') renderSettings(force);
  else if (v === 'stats') renderStats(force);
  else if (v === 'monitoring') renderMonitoring(force);
  else if (v === 'cashreport') renderCashReport(force);
  else if (v === 'transfer') renderTransfer(force);
  else if (v === 'finance') renderFinance(force);
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
    // БЫСТРЫЕ данные (Продажи/Возвраты/чеки/топы) — не ждём тяжёлый sales-report.
    const [hist, ret] = await Promise.all([
      cachedApi(`hist:${state.from}:${state.to}:${state.kassa}`, `?action=history&from=${state.from}&to=${state.to}${kassaQS()}`),
      cachedApi(`ret:${state.from}:${state.to}:${state.kassa}`, `?action=returns&from=${state.from}&to=${state.to}${kassaQS()}`),
    ]);
    // Разбивка наличные/безнал (sales-report) — тяжёлая на больших периодах (до ~90с),
    // грузим НЕ блокируя обзор — дорисуем когда придёт.
    const repPromise = cachedApi(`rep:${state.from}:${state.to}`, `?action=sales-report&from=${state.from}&to=${state.to}`)
      .catch(() => null);
    const rep = { report: null }; // плейсхолдер — реальные оплаты придут позже
    const receipts = hist.receipts || [];
    // ВОЗВРАТЫ: отдельные чеки С ВидОперации='Возврат' (action=returns).
    // Их НАДО вычитать из продаж, чтобы совпадало с отчётом 1С (чистая выручка).
    const returnsSum = Number(ret && ret.total) || 0;
    const returnsList = (ret && ret.returns) || [];
    const grossSales = hist.total || 0;      // продажи без учёта возвратов
    const total = grossSales - returnsSum;   // ЧИСТАЯ выручка = продажи − возвраты (= 1С)
    const cnt = receipts.length;
    const avg = cnt ? grossSales / cnt : 0;  // средний чек — по продажам (возвраты — не чеки продаж)

    // способы оплаты — из sales-report (grand), там возвраты уже учтены со знаком −
    const g = (rep.report && rep.report.grand) || {};
    const buckets = (rep.report && rep.report.buckets) || [];
    const cash = g.cash || 0;
    let nonCash = 0;
    buckets.forEach(b => { if (b.key !== 'cash') nonCash += (g[b.key] || 0); });
    nonCash += (g.other || 0);

    // Топ продавцов: продажи минус возвраты по каждому продавцу (чистый результат, как в 1С)
    const bySeller = {};
    receipts.forEach(r => { const s = r.seller || '—'; if (!bySeller[s]) bySeller[s] = { sum: 0, n: 0 }; bySeller[s].sum += r.total; bySeller[s].n++; });
    returnsList.forEach(r => { const s = r.seller || '—'; if (!bySeller[s]) bySeller[s] = { sum: 0, n: 0 }; bySeller[s].sum -= (Number(r.total) || 0); });
    const topSellers = Object.entries(bySeller).sort((a, b) => b[1].sum - a[1].sum).slice(0, 5);

    // последние чеки
    const last = receipts.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);

    box.innerHTML = `
      <div class="kpis">
        ${kpi('💵','Продажи', money(total),'g','')}
        ${kpi('🧾','Чеков', fmtInt(cnt),'gray','')}
        ${kpi('↩','Возвраты', money(returnsSum),'red','')}
        ${kpi('📊','Средний чек', money(avg),'gray','')}
        <div id="ovCashKpi">${kpi('🟢','Наличные', '⏳','g', 'загрузка…')}</div>
        <div id="ovNonCashKpi">${kpi('💳','Безналичные', '⏳','gray', 'загрузка…')}</div>
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
            <div class="legend" id="ovPayLegend">
              <div class="legend-item"><span class="lg-dot" style="background:#10b981"></span> Наличные — <b>&nbsp;⏳</b></div>
              <div class="legend-item"><span class="lg-dot" style="background:#3b82f6"></span> Безналичные — <b>&nbsp;⏳</b></div>
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
    bumpSync();

    // ДОГРУЗКА разбивки наличные/безнал (не блокирует обзор): дорисуем KPI, легенду и донат.
    repPromise.then(rp => {
      if (!rp || !rp.report) { // sales-report не ответил (таймаут/ошибка)
        const cEl = $('ovCashKpi'), nEl = $('ovNonCashKpi'), lg = $('ovPayLegend');
        if (cEl) cEl.innerHTML = kpi('🟢','Наличные', 'н/д','g', 'нет данных');
        if (nEl) nEl.innerHTML = kpi('💳','Безналичные', 'н/д','gray', 'нет данных');
        if (lg) lg.innerHTML = `<div class="legend-item muted">Разбивка оплат недоступна за этот период</div>`;
        return;
      }
      const gg = rp.report.grand || {};
      const bk = rp.report.buckets || [];
      const c = gg.cash || 0;
      let nc = 0; bk.forEach(b => { if (b.key !== 'cash') nc += (gg[b.key] || 0); }); nc += (gg.other || 0);
      const cEl = $('ovCashKpi'), nEl = $('ovNonCashKpi'), lg = $('ovPayLegend');
      if (cEl) cEl.innerHTML = kpi('🟢','Наличные', money(c),'g', pct(c, c+nc));
      if (nEl) nEl.innerHTML = kpi('💳','Безналичные', money(nc),'gray', pct(nc, c+nc));
      if (lg) lg.innerHTML = `<div class="legend-item"><span class="lg-dot" style="background:#10b981"></span> Наличные — <b>&nbsp;${fmtNum(c)}</b></div>`+
        `<div class="legend-item"><span class="lg-dot" style="background:#3b82f6"></span> Безналичные — <b>&nbsp;${fmtNum(nc)}</b></div>`;
      drawPayDonut('ovPay', c, nc);
    }).catch(() => {});
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
const psState = { q: '', wh: '', page: 0, per: 30, whList: null };

// Селект складов (общий для поиска/истории). sel — текущее значение.
function whOptions(list, sel) {
  return `<option value="" ${!sel?'selected':''}>Все склады</option>` +
    (list || []).map(w => `<option value="${esc(w.id)}" ${sel===w.id?'selected':''}>${esc(w.name)}</option>`).join('');
}

async function renderSearch(force) {
  const box = $('scBody');
  box.innerHTML = `<div class="loading">⏳ Загружаю товары…</div>`;
  try {
    const off = psState.page * psState.per;
    const qs = `?action=product-search&limit=${psState.per}&offset=${off}`
      + (psState.q ? `&q=${encodeURIComponent(psState.q)}` : '')
      + (psState.wh ? `&wh=${encodeURIComponent(psState.wh)}` : '');
    const d = await posApi(qs, { method: 'GET' });
    if (d.warehouses) psState.whList = d.warehouses;
    const rows = d.products || [];
    const total = d.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / psState.per));
    const pageNow = psState.page + 1;

    box.innerHTML = `
      <div class="card card-pad">
        <div class="sc-search">
          <input class="finput" id="scScan" inputmode="numeric" autocomplete="off"
                 placeholder="Быстрый скан штрихкода — карточка товара…">
          <button class="btn btn-ghost" id="scScanGo">Скан</button>
        </div>
        <div id="scResult" style="margin-top:12px"></div>
      </div>

      <div class="card card-pad" style="margin-top:16px">
        <div class="card-h-row"><h3>Каталог товаров${psState.q||psState.wh?` — найдено ${fmtInt(total)}`:` — ${fmtInt(total)}`}</h3></div>
        <div class="filters filters-row">
          <input class="finput" id="psQ" value="${esc(psState.q)}" placeholder="Поиск по названию товара…" style="flex:2;min-width:220px">
          <select class="fselect" id="psWh" style="flex:1;min-width:170px">${whOptions(psState.whList, psState.wh)}</select>
          <button class="btn btn-primary" id="psSearch">Найти</button>
          <button class="btn" id="psReset">Сброс</button>
        </div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th style="width:30px">#</th><th>Товар</th><th class="c">Цена</th><th class="c">Остаток</th><th>По складам</th></tr></thead>
            <tbody>${rows.length ? rows.map((p,i)=>{
              const priceTxt = p.priceMin>0 ? (p.priceMax>p.priceMin ? money(p.priceMin)+'–'+money(p.priceMax) : money(p.priceMin)) : '—';
              const whTxt = (p.byWarehouse||[]).length ? (p.byWarehouse||[]).map(w=>`${esc(w.name)}: <b>${fmtInt(w.stock)}</b>`).join(' · ') : '<span class="muted">нет остатка</span>';
              return `<tr>
                <td class="c muted">${off+i+1}</td>
                <td><div class="strong">${esc(p.name)}</div>${p.category?`<div class="muted" style="font-size:12px">${esc(p.category)}</div>`:''}</td>
                <td class="c tnum">${priceTxt}</td>
                <td class="c tnum"><span class="badge ${p.totalStock>0?'g':'gray'}">${fmtInt(p.totalStock)} шт</span></td>
                <td style="font-size:12.5px">${whTxt}</td>
              </tr>`;
            }).join('') : `<tr><td class="tbl-empty" colspan="5">Товары не найдены</td></tr>`}</tbody>
          </table>
        </div>
        <div class="pager">
          <button class="btn" id="psPrev" ${psState.page<=0?'disabled':''}>← Назад</button>
          <span class="pager-info">Стр. ${pageNow} из ${totalPages}</span>
          <button class="btn" id="psNext" ${pageNow>=totalPages?'disabled':''}>Вперёд →</button>
        </div>
      </div>`;

    const doSearch = () => { psState.q = $('psQ').value.trim(); psState.wh = $('psWh').value; psState.page = 0; renderSearch(); };
    $('psSearch').addEventListener('click', doSearch);
    $('psQ').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    $('psWh').addEventListener('change', doSearch);
    $('psReset').addEventListener('click', () => { psState.q=''; psState.wh=''; psState.page=0; renderSearch(); });
    $('psPrev').addEventListener('click', () => { if (psState.page>0){ psState.page--; renderSearch(); } });
    $('psNext').addEventListener('click', () => { if (pageNow<totalPages){ psState.page++; renderSearch(); } });
    const scanGo = () => scanOne($('scScan').value.trim());
    $('scScanGo').addEventListener('click', scanGo);
    $('scScan').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); scanGo(); } });
    bumpSync();
  } catch (e) {
    box.innerHTML = errBar('Не удалось загрузить товары: ' + (e.message || e));
  }
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
const hnState = { q: '', wh: '', whList: null };
const UNIT_STATUS_META = {
  in_stock: { label: 'В наличии', cls: 'g' },
  sold: { label: 'Продан', cls: 'r' },
  reserved: { label: 'Резерв', cls: 'amber' },
  written_off: { label: 'Списан', cls: 'r' },
};
const EV_LABEL_CLS = { 'Поступление':'g','Напечатан':'gray','Перемещён':'blue','Продан':'g','Возврат':'amber','Списан':'r' };

async function renderHistory(force) {
  const box = $('htBody');
  box.innerHTML = `<div class="loading">⏳ Загрузка…</div>`;
  // первая отрисовка — тянем только список складов (если ещё нет)
  if (!hnState.whList) {
    try { const w = await posApi(`?action=history-name&q=`, { method:'GET' }); if (w.warehouses) hnState.whList = w.warehouses; } catch(_){}
  }
  box.innerHTML = `
    <div class="card card-pad">
      <div class="sc-search">
        <input class="finput" id="hnQ" value="${esc(hnState.q)}" autocomplete="off"
               placeholder="Поиск по названию товара…" style="flex:2">
        <select class="fselect" id="hnWh" style="flex:1;min-width:170px">${whOptions(hnState.whList, hnState.wh)}</select>
        <button class="btn btn-primary" id="hnGo">Найти</button>
      </div>
      <div class="sc-search" style="margin-top:10px">
        <input class="finput" id="htInput" inputmode="numeric" autocomplete="off"
               placeholder="…или отсканируйте штрихкод экземпляра — полный таймлайн…" style="flex:2">
        <button class="btn btn-ghost" id="htGo">Таймлайн</button>
      </div>
    </div>
    <div id="htResult" style="margin-top:16px"></div>`;
  const goName = () => { hnState.q = $('hnQ').value.trim(); hnState.wh = $('hnWh').value; histByName(); };
  $('hnGo').addEventListener('click', goName);
  $('hnQ').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); goName(); } });
  $('hnWh').addEventListener('change', goName);
  const goScan = () => histOne($('htInput').value.trim());
  $('htGo').addEventListener('click', goScan);
  $('htInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); goScan(); } });
  setTimeout(() => { const el = $('hnQ'); if (el) el.focus(); }, 60);
  // если был активный поиск — повторим
  if (hnState.q) histByName();
}

// Поиск истории по названию — список экземпляров (фильтр по складу).
async function histByName() {
  const rbox = $('htResult');
  const q = hnState.q;
  if (!q) { rbox.innerHTML = ''; return; }
  rbox.innerHTML = `<div class="loading">⏳ Ищу «${esc(q)}»…</div>`;
  try {
    const qs = `?action=history-name&q=${encodeURIComponent(q)}&limit=300`
      + (hnState.wh ? `&wh=${encodeURIComponent(hnState.wh)}` : '');
    const d = await posApi(qs, { method: 'GET' });
    const items = d.items || [];
    if (!d.found || !items.length) {
      rbox.innerHTML = `<div class="card card-pad sc-empty">
        <div class="sc-empty-ic">❗</div>
        <div><div class="strong">Ничего не найдено</div>
        <div class="muted">По запросу <b>${esc(q)}</b>${hnState.wh?' на выбранном складе':''} экземпляров нет.</div></div></div>`;
      return;
    }
    const prodNames = (d.products || []).slice(0, 6).join(', ') + ((d.products||[]).length>6?'…':'');
    rbox.innerHTML = `
      <div class="card card-pad">
        <div class="card-h-row">
          <h3>Экземпляры — ${fmtInt(d.count||items.length)}${d.limited?' (показаны первые 300)':''}</h3>
        </div>
        <div class="muted" style="font-size:12.5px;margin-bottom:10px">Товары: ${esc(prodNames)}. Клик по строке — полный таймлайн.</div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>Штрихкод</th><th>Товар</th><th class="c">Размер</th><th class="c">Статус</th><th>Склад</th><th>Посл. событие</th></tr></thead>
            <tbody>${items.map(it=>{
              const st = UNIT_STATUS_META[it.status] || { label: it.status||'—', cls:'gray' };
              const evCls = EV_LABEL_CLS[it.lastEvent] || 'gray';
              const place = it.lastEvent==='Продан' && it.soldShop ? ` · ${esc(it.soldShop)}` : '';
              return `<tr class="ht-row" data-bc="${esc(it.barcode)}" style="cursor:pointer">
                <td class="strong rc-bc">${esc(it.barcode)}</td>
                <td>${esc(it.name)}</td>
                <td class="c">${esc(it.sizeLabel || '—')}</td>
                <td class="c"><span class="badge ${st.cls}">${esc(st.label)}</span></td>
                <td>${esc(it.warehouse || '—')}</td>
                <td style="font-size:12.5px"><span class="badge ${evCls}">${esc(it.lastEvent)}</span> <span class="muted">${it.lastAt?dushTime(it.lastAt,true):''}${place}</span></td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>
      <div id="htTimeline" style="margin-top:16px"></div>`;
    // клик по строке → таймлайн экземпляра
    rbox.querySelectorAll('.ht-row').forEach(tr => {
      tr.addEventListener('click', () => {
        const bc = tr.getAttribute('data-bc');
        histOne(bc, 'htTimeline');
        const tl = $('htTimeline'); if (tl) tl.scrollIntoView({ behavior:'smooth', block:'start' });
      });
    });
    bumpSync();
  } catch (e) {
    rbox.innerHTML = errBar('Ошибка поиска: ' + (e.message || e));
  }
}

async function histOne(code, targetId) {
  const rbox = $(targetId || 'htResult');
  if (!rbox) return;
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

// ═════════════════════════════════════════════════════
//  РАЗДЕЛ: ПОЛЬЗОВАТЕЛИ
// ═════════════════════════════════════════════════════
const ROLE_CLS = { admin: 'amber', warehouse: 'g', cashier: 'blue', manager: 'blue' };
async function renderUsers(force) {
  const box = $('usBody');
  box.innerHTML = `<div class="loading">⏳ Загружаю пользователей…</div>`;
  try {
    const d = await cachedApi('users', '?action=pos-users');
    const s = d.stats || {};
    const pos = d.posAccounts || [];
    const web = d.webAdmins || [];
    box.innerHTML = `
      <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">
        ${kpi('👥','Учёток касс/складов', fmtInt(s.posTotal||0),'g', fmtInt(s.posActive||0)+' активных')}
        ${kpi('🛡️','Веб-админы', fmtInt(s.webTotal||0),'gray','доступ к дашборду')}
        ${kpi('🔑','Админы админки РМК', '3','gray','полный доступ')}
      </div>

      <div class="card card-pad">
        <div class="card-h-row"><h3>Учётки касс и складов</h3></div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>Логин</th><th>Наименование</th><th class="c">Роль</th><th>Магазин/склад</th><th class="c">Статус</th><th>Последний вход</th></tr></thead>
            <tbody>${pos.length ? pos.map(u=>`
              <tr>
                <td class="strong rc-bc">${esc(u.username)}</td>
                <td>${esc(u.name)}</td>
                <td class="c"><span class="badge ${ROLE_CLS[u.role]||'gray'}">${esc(u.roleLabel)}</span></td>
                <td>${esc(u.warehouse || '—')}</td>
                <td class="c"><span class="badge ${u.active?'ok':'off'}">${u.active?'Активен':'Отключён'}</span></td>
                <td class="muted">${u.lastLogin?dushTime(u.lastLogin,true):'—'}</td>
              </tr>`).join('') : `<tr><td class="tbl-empty" colspan="6">Нет учёток</td></tr>`}</tbody>
          </table>
        </div>
      </div>

      <div class="card card-pad">
        <div class="card-h-row"><h3>Админы админки РМК</h3></div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>Логин</th><th>Имя</th><th class="c">Доступ</th></tr></thead>
            <tbody>
              <tr><td class="strong rc-bc">Sunnat</td><td>Sunnat</td><td class="c"><span class="badge g">Полный</span></td></tr>
              <tr><td class="strong rc-bc">Iskandar</td><td>Iskandar</td><td class="c"><span class="badge g">Полный</span></td></tr>
              <tr><td class="strong rc-bc">Shahida</td><td>Shahida</td><td class="c"><span class="badge g">Полный</span></td></tr>
            </tbody>
          </table>
        </div>
        <div class="muted" style="font-size:12.5px;margin-top:10px">Учётки админки заданы в конфиге приложения (не в БД). Веб-админы ниже — из таблицы app_users.</div>
        ${web.length ? `<div style="margin-top:12px"><div class="muted" style="font-size:12.5px;margin-bottom:6px">app_users:</div>${web.map(u=>`<span class="badge gray" style="margin:0 6px 6px 0">${esc(u.username)} · ${esc(u.roleLabel)}</span>`).join('')}</div>` : ''}
      </div>
    `;
    bumpSync();
  } catch (e) {
    box.innerHTML = errBar('Не удалось загрузить пользователей: ' + (e.message || e));
  }
}

// ═════════════════════════════════════════════════════
//  РАЗДЕЛ: ЖУРНАЛ ДЕЙСТВИЙ
// ═════════════════════════════════════════════════════
const AU_META = {
  sale:        { ic: '💰', cls: 'g',    label: 'Продажа' },
  return:      { ic: '↩️', cls: 'ret',  label: 'Возврат' },
  shift_open:  { ic: '🔓', cls: 'blue', label: 'Открытие смены' },
  shift_close: { ic: '🔒', cls: 'gray', label: 'Закрытие смены' },
};
const auState = { type: '' };
let auCache = null;

// ════════════════════════════════════════════════════════
//  РАЗДЕЛ: УСТРОЙСТВА КАСС (одобрение девайсов)
// ════════════════════════════════════════════════════════
const DEV_ACCOUNT_LABEL = {
  siyoma: 'Сиёма', ayni: 'Айни', barakat: 'Баракат', citymall: 'Сити-Молл',
  'кассир': 'Кассир', kassir: 'Кассир',
};
function devFmtTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch (_) { return String(iso); }
}

async function renderDevices(force) {
  const box = $('dvBody');
  box.innerHTML = `<div class="loading">⏳ Загружаю устройства…</div>`;
  let data;
  try {
    data = await posApi('?action=device-list', { method: 'GET' });
  } catch (e) {
    box.innerHTML = errBar('Не удалось загрузить устройства: ' + e.message);
    return;
  }
  const devices = (data && data.devices) || [];
  const counts = (data && data.counts) || { pending: 0, approved: 0, denied: 0 };
  const pending  = devices.filter(d => d.status === 'pending');
  const approved = devices.filter(d => d.status === 'approved');
  const denied   = devices.filter(d => d.status === 'denied');

  const accName = (k) => DEV_ACCOUNT_LABEL[String(k || '').toLowerCase()] || k || '—';
  const shortId = (id) => { const s = String(id || ''); return s.length > 14 ? s.slice(0, 8) + '…' + s.slice(-4) : s; };

  const rowPending = (d) => `
    <tr>
      <td><b>${esc(accName(d.account_key))}</b><div class="muted" style="font-size:12px">${esc(d.warehouse_name || '')}</div></td>
      <td>${esc(d.label || '—')}<div class="muted" style="font-size:11px">${esc(shortId(d.device_id))}</div></td>
      <td class="muted" style="font-size:12px">${esc(d.ip || '—')}</td>
      <td>${devFmtTime(d.first_seen)}</td>
      <td style="white-space:nowrap">
        <button class="btn-sm btn-ok" data-dev-approve="${esc(d.id)}">✓ Одобрить</button>
        <button class="btn-sm btn-no" data-dev-deny="${esc(d.id)}">✕ Отклонить</button>
      </td>
    </tr>`;
  const rowApproved = (d) => `
    <tr>
      <td><b>${esc(accName(d.account_key))}</b><div class="muted" style="font-size:12px">${esc(d.warehouse_name || '')}</div></td>
      <td>${esc(d.label || '—')}<div class="muted" style="font-size:11px">${esc(shortId(d.device_id))}</div></td>
      <td class="muted" style="font-size:12px">${esc(d.approved_by || '—')}<div>${devFmtTime(d.approved_at)}</div></td>
      <td>${devFmtTime(d.last_seen)}</td>
      <td><button class="btn-sm btn-no" data-dev-revoke="${esc(d.id)}">↺ Отозвать</button></td>
    </tr>`;

  box.innerHTML = `
    <style>
      .dev-cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}
      .dev-card{flex:1;min-width:120px;background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:14px 16px}
      .dev-card .n{font-size:26px;font-weight:800}
      .dev-card .l{font-size:13px;color:#777}
      .dev-card.pend .n{color:#c47f17}.dev-card.appr .n{color:#2e7d32}.dev-card.den .n{color:#b3306a}
      .dev-table{width:100%;border-collapse:collapse;margin-bottom:10px}
      .dev-table th,.dev-table td{padding:10px 12px;border-bottom:1px solid #eee;text-align:left;font-size:14px;vertical-align:top}
      .dev-table th{background:#faf9f7;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:.03em}
      .dev-h{font-size:16px;font-weight:700;margin:18px 0 8px}
      .btn-sm{border:none;border-radius:8px;padding:7px 12px;font-size:13px;cursor:pointer;margin-right:6px}
      .btn-ok{background:#e6f4ea;color:#1e7d33}.btn-ok:hover{background:#d3ebd9}
      .btn-no{background:#fbe9f2;color:#b3306a}.btn-no:hover{background:#f5d8e7}
      .dev-empty{color:#999;padding:14px;font-style:italic}
      .muted{color:#888}
    </style>
    <div class="dev-cards">
      <div class="dev-card pend"><div class="n">${counts.pending || 0}</div><div class="l">Ожидают</div></div>
      <div class="dev-card appr"><div class="n">${counts.approved || 0}</div><div class="l">Одобрены</div></div>
      <div class="dev-card den"><div class="n">${counts.denied || 0}</div><div class="l">Отклонены</div></div>
    </div>

    <div class="dev-h">🔔 Заявки на вход (ожидают одобрения)</div>
    ${pending.length ? `<table class="dev-table"><thead><tr><th>Касса</th><th>Устройство</th><th>IP</th><th>Первый вход</th><th>Действие</th></tr></thead><tbody>${pending.map(rowPending).join('')}</tbody></table>` : `<div class="dev-empty">Новых заявок нет.</div>`}

    <div class="dev-h">✅ Одобренные устройства</div>
    ${approved.length ? `<table class="dev-table"><thead><tr><th>Касса</th><th>Устройство</th><th>Кто/когда одобрил</th><th>Активность</th><th>Действие</th></tr></thead><tbody>${approved.map(rowApproved).join('')}</tbody></table>` : `<div class="dev-empty">Одобренных устройств пока нет.</div>`}

    ${denied.length ? `<div class="dev-h">🚫 Отклонённые</div><table class="dev-table"><thead><tr><th>Касса</th><th>Устройство</th><th>IP</th><th>Активность</th><th>Действие</th></tr></thead><tbody>${denied.map(d => `<tr><td><b>${esc(accName(d.account_key))}</b></td><td>${esc(d.label || '—')}<div class="muted" style="font-size:11px">${esc(shortId(d.device_id))}</div></td><td class="muted">${esc(d.ip || '—')}</td><td>${devFmtTime(d.last_seen)}</td><td><button class="btn-sm btn-ok" data-dev-approve="${esc(d.id)}">✓ Разрешить</button></td></tr>`).join('')}</tbody></table>` : ''}
  `;

  const act = async (id, action, verb) => {
    if (!id) return;
    try {
      await posApi(`?action=device-${action}`, {
        method: 'POST',
        body: JSON.stringify({ id, by: (state.user || 'admin') }),
      });
      state.cache = {};
      renderDevices(true);
    } catch (e) {
      alert('Не удалось ' + verb + ': ' + e.message);
    }
  };
  box.querySelectorAll('[data-dev-approve]').forEach(b => b.addEventListener('click', () => act(b.dataset.devApprove, 'approve', 'одобрить')));
  box.querySelectorAll('[data-dev-deny]').forEach(b => b.addEventListener('click', () => act(b.dataset.devDeny, 'deny', 'отклонить')));
  box.querySelectorAll('[data-dev-revoke]').forEach(b => b.addEventListener('click', () => { if (confirm('Отозвать доступ у этого устройства?')) act(b.dataset.devRevoke, 'revoke', 'отозвать'); }));
}

async function renderAudit(force) {
  const box = $('auBody');
  box.innerHTML = `<div class="loading">⏳ Загружаю журнал…</div>`;
  try {
    const d = await cachedApi(`aud:${state.from}:${state.to}:${state.kassa}`, `?action=audit&from=${state.from}&to=${state.to}${kassaQS()}`);
    auCache = d;
    drawAudit();
    bumpSync();
  } catch (e) {
    box.innerHTML = errBar('Не удалось загрузить журнал: ' + (e.message || e));
  }
}

function drawAudit() {
  const box = $('auBody');
  const d = auCache; if (!d) return;
  const c = d.counts || {};
  const all = d.events || [];
  const rows = auState.type ? all.filter(e => e.type === auState.type) : all;
  const per = state.from === state.to ? state.from : state.from + ' — ' + state.to;
  const chip = (t, label, n) => `<button class="au-chip${auState.type===t?' on':''}" data-autype="${t}">${label} <b>${fmtInt(n)}</b></button>`;
  box.innerHTML = `
    <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
      ${kpi('📋','Всего событий', fmtInt(d.count||0),'gray', per)}
      ${kpi('💰','Продажи', fmtInt(c.sale||0),'g')}
      ${kpi('↩️','Возвраты', fmtInt(c.return||0),'r')}
      ${kpi('🔓','Смены', fmtInt((c.shift_open||0)),'blue', fmtInt(c.shift_close||0)+' закрыто')}
    </div>
    <div class="card card-pad">
      <div class="filters filters-row" style="margin-bottom:12px">
        ${chip('', 'Все', d.count||0)}
        ${chip('sale', '💰 Продажи', c.sale||0)}
        ${chip('return', '↩️ Возвраты', c.return||0)}
        ${chip('shift_open', '🔓 Открытие', c.shift_open||0)}
        ${chip('shift_close', '🔒 Закрытие', c.shift_close||0)}
      </div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Время</th><th class="c">Событие</th><th>Кто</th><th>Магазин</th><th>Документ</th><th class="r">Сумма</th><th>Примечание</th></tr></thead>
          <tbody>${rows.length ? rows.map(e=>{
            const m = AU_META[e.type] || { ic:'•', cls:'gray', label:e.label };
            return `<tr>
              <td class="muted" style="white-space:nowrap">${dushTime(e.at,true)}</td>
              <td class="c"><span class="badge ${m.cls}">${m.ic} ${esc(e.label)}</span></td>
              <td>${esc(e.who||'—')}</td>
              <td>${esc(e.shop||'—')}</td>
              <td class="rc-bc">${e.doc?esc(e.doc):'—'}</td>
              <td class="r">${e.amount!=null?money(e.amount):'—'}</td>
              <td class="muted" style="font-size:12.5px">${e.note?esc(e.note):''}</td>
            </tr>`;
          }).join('') : `<tr><td class="tbl-empty" colspan="7">Нет событий за период</td></tr>`}</tbody>
        </table>
      </div>
      ${(d.count||0) >= 500 ? `<div class="muted" style="font-size:12px;margin-top:10px">Показаны первые 500 событий — сузьте период.</div>` : ''}
    </div>
  `;
  box.querySelectorAll('.au-chip').forEach(b => b.addEventListener('click', () => {
    auState.type = b.dataset.autype || ''; drawAudit();
  }));
}

// ═════════════════════════════════════════════════════
//  РАЗДЕЛ: НАСТРОЙКИ РМК (read-only)
// ═════════════════════════════════════════════════════
async function renderSettings(force) {
  const box = $('stBody');
  box.innerHTML = `<div class="loading">⏳ Загружаю настройки…</div>`;
  try {
    const d = await cachedApi('settings', '?action=settings');
    const sh = d.shop || {}; const sys = d.system || {}; const st = d.stats || {};
    const krow = (k) => `<tr>
      <td class="strong">${esc(k.shop || k.name)}</td>
      <td>${esc(k.type || '—')}</td>
      <td class="c"><span class="badge ${k.offline?'amber':'g'}">${k.offline?'Автономная':'Онлайн'}</span></td>
      <td class="rc-bc muted" style="font-size:11.5px">${esc(k.ref||'')}</td>
    </tr>`;
    const wrow = (w) => `<tr>
      <td class="strong">${esc(w.name)}</td>
      <td class="c">${esc(w.code || '—')}</td>
      <td class="c"><span class="badge ${w.active?'ok':'off'}">${w.active?'Активен':'Откл.'}</span></td>
      <td class="rc-bc muted" style="font-size:11.5px">${esc(w.c1Ref||'')}</td>
    </tr>`;
    const cfgRow = (label, val, tone) => `<div class="st-row"><span class="st-k">${label}</span><span class="st-v ${tone||''}">${val}</span></div>`;
    box.innerHTML = `
      <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
        ${kpi('🏪','Магазинов/складов', fmtInt(st.warehouses||0),'g', fmtInt(st.activeWarehouses||0)+' активных')}
        ${kpi('🧾','Касс ККМ', fmtInt(st.kassas||0),'blue')}
        ${kpi('%','Скидка по умолч.', sh.discountPercent!=null?sh.discountPercent+'%':'—','gray')}
        ${kpi('⚠️','Порог остатка', sh.stockThreshold!=null?fmtInt(sh.stockThreshold)+' шт':'—','amber')}
      </div>

      <div class="card card-pad">
        <div class="card-h-row"><h3>Магазины и склады</h3></div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Наименование</th><th class="c">Код 1С</th><th class="c">Статус</th><th>Ref_Key 1С</th></tr></thead>
          <tbody>${(d.warehouses||[]).map(wrow).join('') || `<tr><td class="tbl-empty" colspan="4">Нет данных</td></tr>`}</tbody>
        </table></div>
      </div>

      <div class="card card-pad">
        <div class="card-h-row"><h3>Кассы ККМ (1С)</h3></div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Магазин</th><th>Тип кассы</th><th class="c">Режим</th><th>Ref_Key 1С</th></tr></thead>
          <tbody>${(d.kassas||[]).map(krow).join('') || `<tr><td class="tbl-empty" colspan="4">Нет данных</td></tr>`}</tbody>
        </table></div>
      </div>

      <div class="cards-2">
        <div class="card card-pad">
          <div class="card-h-row"><h3>Общие параметры</h3></div>
          ${cfgRow('Скидка по умолчанию', sh.discountPercent!=null?sh.discountPercent+'%':'—')}
          ${cfgRow('Порог низкого остатка', sh.stockThreshold!=null?fmtInt(sh.stockThreshold)+' шт':'—')}
          ${cfgRow('WhatsApp уведомления', sh.whatsappRecipients?esc(sh.whatsappRecipients):'—')}
          ${cfgRow('Единица измерения', esc(sys.unit||'шт'))}
          ${cfgRow('Валюта', esc(sys.currency||'с.'))}
          ${cfgRow('Часовой пояс', esc(sys.timezone||''))}
          ${sh.updatedAt?`<div class="muted" style="font-size:12px;margin-top:8px">Обновлено: ${dushTime(sh.updatedAt,true)}</div>`:''}
        </div>
        <div class="card card-pad">
          <div class="card-h-row"><h3>Система</h3></div>
          ${cfgRow('API бэкенда', `<span class="rc-bc" style="font-size:11.5px">${esc(sys.apiBase||'')}</span>`)}
          ${cfgRow('Подключение к 1С (OData)', sys.odataConfigured?'<span class="badge ok">Настроено</span>':'<span class="badge off">Нет</span>')}
          ${cfgRow('Подключение к Supabase', sys.supabaseConfigured?'<span class="badge ok">Настроено</span>':'<span class="badge off">Нет</span>')}
          <div class="muted" style="font-size:12px;margin-top:12px">Раздел только для просмотра. Изменение параметров — через 1С и основной дашборд.</div>
        </div>
      </div>
    `;
    bumpSync();
  } catch (e) {
    box.innerHTML = errBar('Не удалось загрузить настройки: ' + (e.message || e));
  }
}

// ═════════════════════════════════════════════════════
//  РАЗДЕЛ: СТАТИСТИКА
// ═════════════════════════════════════════════════════
function dowShort(day) {
  const dt = new Date(day + 'T12:00:00');
  return ['вс','пн','вт','ср','чт','пт','сб'][dt.getDay()];
}
async function renderStats(force) {
  const box = $('statBody');
  box.innerHTML = `<div class="loading">⏳ Считаю статистику…</div>`;
  try {
    const d = await cachedApi(`stat:${state.from}:${state.to}:${state.kassa}`, `?action=stats&from=${state.from}&to=${state.to}${kassaQS()}`);
    const k = d.kpi || {};
    const per = state.from === state.to ? state.from : state.from + ' — ' + state.to;
    const daily = d.daily || [];
    const dayItems = daily.map(x => ({ label: `${x.day.slice(5)} (${dowShort(x.day)})`, value: x.net, extra: x.checks + ' ч.' }));
    const shopItems = (d.topShops || []).map(x => ({ label: x.name, value: x.net, extra: x.checks + ' ч.' }));
    const sellerItems = (d.topSellers || []).slice(0, 10).map(x => ({ label: x.name, value: x.net, extra: x.checks + ' ч.' }));

    box.innerHTML = `
      <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
        ${kpi('💵','Выручка (нетто)', money(k.net||0),'g', 'продажи '+money(k.salesSum||0))}
        ${kpi('🧾','Чеков', fmtInt(k.checks||0),'blue', 'средний '+money(k.avgCheck||0))}
        ${kpi('↩️','Возвраты', fmtInt(k.returns||0),'r', money(k.retsSum||0))}
        ${kpi('📦','Продано единиц', k.unitsSold!=null?fmtInt(k.unitsSold)+' шт':'—','gray', k.unitsSold==null?'много чеков':'')}
      </div>

      <div class="card card-pad">
        <div class="card-h-row"><h3>Динамика по дням (нетто)</h3><span class="muted">${per}</span></div>
        ${dayItems.length ? hbars(dayItems, { money: true }) : `<div class="tbl-empty">Нет продаж за период</div>`}
      </div>

      <div class="cards-2">
        <div class="card card-pad">
          <div class="card-h-row"><h3>Топ магазины</h3></div>
          ${shopItems.length ? hbars(shopItems, { money: true }) : `<div class="tbl-empty">Нет данных</div>`}
        </div>
        <div class="card card-pad">
          <div class="card-h-row"><h3>Топ продавцы</h3></div>
          ${sellerItems.length ? hbars(sellerItems, { money: true }) : `<div class="tbl-empty">Нет данных</div>`}
        </div>
      </div>

      <div class="card card-pad">
        <div class="card-h-row"><h3>Топ товары по выручке</h3></div>
        ${d.productsSkipped
          ? `<div class="tbl-empty">Слишком много чеков за период (>${fmtInt(d.productsLimit||150)}). Выберите период поменьше (напр. 1 день), чтобы увидеть топ товаров.</div>`
          : ((d.topProducts||[]).length
            ? `<div class="tbl-wrap"><table class="tbl">
                <thead><tr><th>#</th><th>Товар</th><th class="r">Кол-во</th><th class="r">Выручка</th></tr></thead>
                <tbody>${d.topProducts.map((p,i)=>`<tr>
                  <td class="muted">${i+1}</td>
                  <td>${esc(p.name)}${p.barcode?` <span class="rc-bc muted" style="font-size:11px">${esc(p.barcode)}</span>`:''}</td>
                  <td class="r">${fmtNum(p.qty)} шт</td>
                  <td class="r strong">${money(p.revenue)}</td>
                </tr>`).join('')}</tbody>
              </table></div>`
            : `<div class="tbl-empty">Нет данных</div>`)}
      </div>
    `;
    bumpSync();
  } catch (e) {
    box.innerHTML = errBar('Не удалось загрузить статистику: ' + (e.message || e));
  }
}

// ═════════════════════════════════════════════════════
//  РАЗДЕЛ: МОНИТОРИНГ МАГАЗИНОВ
// ═════════════════════════════════════════════════════
const MON_META = {
  open:   { label: 'Открыта', cls: 'ok',   dot: 'g' },
  closed: { label: 'Закрыта', cls: 'gray', dot: 'gray' },
  idle:   { label: 'Нет смены', cls: 'off', dot: 'r' },
};
async function renderMonitoring(force) {
  const box = $('monBody');
  box.innerHTML = `<div class="loading">⏳ Проверяю статус касс…</div>`;
  try {
    // всегда свежие данные (статус онлайн) — без кеша
    const d = await posApi(`?action=monitoring`);
    const s = d.stats || {};
    const rows = d.rows || [];
    const srv = d.serverTime ? d.serverTime.replace('T', ' ').slice(0, 16) : '';

    box.innerHTML = `
      <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
        ${kpi('🔓','Смен открыто', fmtInt(s.open||0),'g', 'из '+fmtInt(s.kassas||0)+' касс')}
        ${kpi('🔒','Закрыто сегодня', fmtInt(s.closed||0),'gray','')}
        ${kpi('⚠️','Без смены', fmtInt(s.idle||0), (s.idle?'r':'gray'),'')}
        ${kpi('💵','Продажи сегодня', money(s.salesToday||0),'g', fmtInt(s.receiptsToday||0)+' чеков')}
      </div>

      <div class="card card-pad">
        <div class="card-h-row">
          <h3>Статус касс</h3>
          <span class="muted">на ${esc(srv)} · <a href="#" id="monRefresh" style="color:var(--g2);font-weight:600;text-decoration:none">⭯ Обновить</a></span>
        </div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr>
            <th>Касса / Магазин</th><th>Статус</th><th>Кассир</th>
            <th>Открыта</th><th>Закрыта</th><th class="r">Чеков</th><th class="r">Продажи</th>
          </tr></thead>
          <tbody>${rows.map(r => {
            const m = MON_META[r.state] || MON_META.idle;
            return `<tr>
              <td><b>${esc(r.kassa)}</b>${r.offline?` <span class="badge gray" style="font-size:10px">offline</span>`:''}<div class="muted" style="font-size:12px">${esc(r.shop||'—')}</div></td>
              <td><span class="badge ${m.cls}">${m.label}</span></td>
              <td>${esc(r.seller||'—')}</td>
              <td>${r.openedAt?dushTime(r.openedAt,false):'—'}</td>
              <td>${r.closedAt?dushTime(r.closedAt,false):(r.state==='open'?'<span class="muted">сейчас</span>':'—')}</td>
              <td class="r">${fmtInt(r.receipts||0)}</td>
              <td class="r strong">${money(r.totalSales||0)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>
    `;
    const rf = $('monRefresh');
    if (rf) rf.onclick = (e) => { e.preventDefault(); renderMonitoring(true); };
    bumpSync();
  } catch (e) {
    box.innerHTML = errBar('Не удалось загрузить мониторинг: ' + (e.message || e));
  }
}

// ═════════════════════════════════════════════════════
//  РАЗДЕЛ: ОТЧЁТ ПО СНЯТИЮ ДС (наличные к инкассации)
// ═════════════════════════════════════════════════════
async function renderCashReport(force) {
  const box = $('cashBody');
  box.innerHTML = `<div class="loading">⏳ Считаю наличные…</div>`;
  try {
    const d = await cachedApi(`cash:${state.from}:${state.to}:${state.kassa}`, `?action=cashreport&from=${state.from}&to=${state.to}${kassaQS()}`);
    const k = d.kpi || {};
    const per = state.from === state.to ? state.from : state.from + ' — ' + state.to;
    const rows = d.rows || [];
    const typeItems = (d.byType || []).map(t => ({ label: t.label + (t.cash ? ' 💵' : ''), value: t.amount }));

    box.innerHTML = `
      <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
        ${kpi('💵','Наличные к снятию', money(k.totalCash||0),'g', 'за '+per)}
        ${kpi('💳','Безналичные', money(k.totalNonCash||0),'blue','карты/QR/кошельки')}
        ${kpi('∑','Всего оплат', money(k.totalAll||0),'gray','')}
        ${kpi('🔒','Закрыто смен', fmtInt(k.shifts||0),'gray', fmtInt(k.receipts||0)+' чеков')}
      </div>

      <div class="cards-2">
        <div class="card card-pad">
          <div class="card-h-row"><h3>Наличные по кассам</h3></div>
          ${(d.byKassa||[]).length ? `<div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>Касса</th><th class="r">Наличные</th><th class="r">Безнал</th><th class="r">Смен</th></tr></thead>
            <tbody>${d.byKassa.map(x=>`<tr>
              <td><b>${esc(x.kassa)}</b></td>
              <td class="r strong" style="color:var(--g2)">${money(x.cash)}</td>
              <td class="r">${money(x.noncash)}</td>
              <td class="r muted">${fmtInt(x.shifts)}</td>
            </tr>`).join('')}</tbody>
          </table></div>` : `<div class="tbl-empty">Нет закрытых смен за период</div>`}
        </div>
        <div class="card card-pad">
          <div class="card-h-row"><h3>По типам оплат</h3></div>
          ${typeItems.length ? hbars(typeItems, { money: true }) : `<div class="tbl-empty">Нет данных</div>`}
        </div>
      </div>

      <div class="card card-pad">
        <div class="card-h-row"><h3>Закрытые смены</h3><span class="muted">${fmtInt(rows.length)}</span></div>
        ${rows.length ? `<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Касса / Магазин</th><th>Кассир</th><th>Закрыта</th><th class="r">Чеков</th><th class="r">Наличные</th><th class="r">Безнал</th><th class="r">Итого</th></tr></thead>
          <tbody>${rows.map(r=>`<tr>
            <td><b>${esc(r.kassa||'—')}</b><div class="muted" style="font-size:12px">${esc(r.shop||'')}</div></td>
            <td>${esc(r.seller||'—')}</td>
            <td>${r.closedAt?dushTime(r.closedAt,true):'—'}</td>
            <td class="r">${fmtInt(r.receipts||0)}</td>
            <td class="r strong" style="color:var(--g2)">${money(r.cash||0)}</td>
            <td class="r">${money(r.noncash||0)}</td>
            <td class="r">${money(r.total||0)}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : `<div class="tbl-empty">Нет закрытых смен</div>`}
      </div>
    `;
    bumpSync();
  } catch (e) {
    box.innerHTML = errBar('Не удалось загрузить отчёт: ' + (e.message || e));
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
//  РАЗДЕЛ: ПЕРЕМЕЩЕНИЕ ТОВАРОВ (склад → склад, со сканером и документом 1С)
//  Пошаговый мастер: 1) выбор складов → 2) сканер → 3) товар добавлен →
//  4) список → 5) сверка → 6) подтверждение → 7) успех (+PDF)
// ══════════════════════════════════════════════════════════
const TR = {
  step: 'setup',       // setup | scan | added | list | check | confirm | done
  fromRef: '', fromName: '',
  toRef: '',   toName: '',
  comment: '',
  warehouses: [],      // [{id,name,c1Ref}]
  items: [],           // [{barcode, name, sizeLabel, price, productC1Ref, charC1Ref, qty}]
  lastAdded: null,     // последний добавленный товар (экран «Товар добавлен»)
  sender: '', receiver: '',
  scanner: null,       // Html5Qrcode инстанс
  scanning: false,
  busy: false,
  result: null,        // ответ transfer-create {number, ref, date, ...}
};

async function renderTransfer(force) {
  const box = $('trBody');
  if (force) { TR.step = 'setup'; TR.items = []; TR.result = null; }
  // загрузим склады один раз
  if (!TR.warehouses.length) {
    box.innerHTML = `<div class="loading">⏳ Загружаю склады…</div>`;
    try {
      const d = await posApi('?action=transfer-warehouses', { method: 'GET' });
      TR.warehouses = d.warehouses || [];
    } catch (e) { box.innerHTML = errBar('Не удалось загрузить склады: ' + e.message); return; }
  }
  trPaint();
}

// единый рендер по текущему шагу
function trPaint() {
  const box = $('trBody');
  if (!box) return;
  // если уходим со сканера — гасим камеру
  if (TR.step !== 'scan') trStopScanner();
  if (TR.step === 'setup')   box.innerHTML = trSetupHTML();
  else if (TR.step === 'scan')    box.innerHTML = trScanHTML();
  else if (TR.step === 'added')   box.innerHTML = trAddedHTML();
  else if (TR.step === 'list')    box.innerHTML = trListHTML();
  else if (TR.step === 'check')   box.innerHTML = trCheckHTML();
  else if (TR.step === 'confirm') box.innerHTML = trConfirmHTML();
  else if (TR.step === 'done')    box.innerHTML = trDoneHTML();
  trBind();
  if (TR.step === 'scan') trStartScanner();
}

const trUnits = () => TR.items.reduce((s, it) => s + (Number(it.qty) || 1), 0);
const trUniqCodes = () => new Set(TR.items.map(i => i.barcode)).size;
const last4 = (bc) => String(bc || '').slice(-4);

// ── Экран 1: выбор складов ──
function trSetupHTML() {
  const opts = (sel) => TR.warehouses.map(w =>
    `<option value="${esc(w.c1Ref)}" ${sel === w.c1Ref ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
  return `
  <div class="tr-wrap">
    <div class="tr-card tr-setup">
      <div class="tr-card-head"><span class="tr-ic">🔄</span><div><h2>Новое перемещение</h2><p>Выберите склады отправителя и получателя</p></div></div>
      <label class="tr-fld"><span>Откуда (склад-отправитель)</span>
        <select id="trFrom" class="tr-select"><option value="">— выберите склад —</option>${opts(TR.fromRef)}</select></label>
      <label class="tr-fld"><span>Куда (склад-получатель)</span>
        <select id="trTo" class="tr-select"><option value="">— выберите склад —</option>${opts(TR.toRef)}</select></label>
      <label class="tr-fld"><span>Комментарий (необязательно)</span>
        <input type="text" id="trComment" class="tr-input" maxlength="200" placeholder="Напр. плановое пополнение" value="${esc(TR.comment)}"></label>
      <div class="tr-info">
        <span class="tr-info-ic">ℹ️</span>
        <div>После выбора складов откроется камера для сканирования штрихкодов товаров. Каждый отсканированный товар добавится в список перемещения. Документ будет создан и проведён в 1С.</div>
      </div>
      <div id="trSetupErr"></div>
      <button class="tr-btn tr-btn-primary tr-btn-block" id="trStart">📷 Начать сканирование</button>
    </div>
  </div>`;
}

// ── Экран 2: сканер ──
function trScanHTML() {
  return `
  <div class="tr-scan-screen">
    <div class="tr-scan-top">
      <button class="tr-scan-x" id="trScanClose">✕</button>
      <div class="tr-scan-route">${esc(TR.fromName)} → ${esc(TR.toName)}</div>
      <div class="tr-scan-count">${fmtInt(TR.items.length)} тов.</div>
    </div>
    <div class="tr-scan-view">
      <div id="trReader" class="tr-reader"></div>
      <div class="tr-scan-frame"></div>
    </div>
    <div class="tr-scan-hint" id="trScanHint">Отсканируйте штрихкод товара</div>
    <div class="tr-scan-manual">
      <input type="text" id="trManual" class="tr-input" inputmode="numeric" placeholder="Или введите штрихкод вручную">
      <button class="tr-btn tr-btn-ghost" id="trManualAdd">Добавить</button>
    </div>
    <button class="tr-btn tr-btn-outline tr-btn-block" id="trScanFinish">Завершить сканирование (${fmtInt(TR.items.length)})</button>
  </div>`;
}

// ── Экран 3: товар добавлен ──
function trAddedHTML() {
  const it = TR.lastAdded || {};
  return `
  <div class="tr-wrap">
    <div class="tr-card tr-added">
      <div class="tr-added-badge">✓</div>
      <h2 class="tr-added-title">Товар добавлен</h2>
      <div class="tr-prod-card">
        <div class="tr-prod-name">${esc(it.name || '—')}</div>
        <div class="tr-prod-sub">${esc(it.productCode || '')}</div>
        <div class="tr-prod-grid">
          <div><span>Код (посл. 4)</span><b>${esc(last4(it.barcode))}</b></div>
          <div><span>Размер</span><b>${esc(it.sizeLabel || '—')}</b></div>
          <div><span>Кол-во</span><b>${fmtInt(it.qty || 1)}</b></div>
        </div>
      </div>
      <button class="tr-btn tr-btn-primary tr-btn-block" id="trAddNext">📷 Добавить следующий товар</button>
      <button class="tr-btn tr-btn-outline tr-btn-block" id="trGoList">Завершить сканирование (${fmtInt(TR.items.length)})</button>
    </div>
  </div>`;
}

// ── Экран 4: список товаров ──
function trListHTML() {
  const rows = TR.items.map((it, i) => `
    <tr>
      <td class="tr-td-name"><div class="tr-nm">${esc(it.name || '—')}</div><div class="tr-nm-sub">${esc(it.productCode || '')}</div></td>
      <td class="c"><span class="tr-code">${esc(last4(it.barcode))}</span></td>
      <td class="c">${esc(it.sizeLabel || '—')}</td>
      <td class="c">${fmtInt(it.qty || 1)}</td>
      <td class="c"><button class="tr-del" data-del="${i}" title="Убрать">✕</button></td>
    </tr>`).join('');
  return `
  <div class="tr-wrap">
    <div class="tr-kpis">
      <div class="tr-kpi"><span>Товаров</span><b>${fmtInt(TR.items.length)}</b></div>
      <div class="tr-kpi"><span>Всего единиц</span><b>${fmtInt(trUnits())}</b></div>
    </div>
    <div class="tr-card">
      <div class="tr-card-head sm"><span class="tr-ic">📋</span><div><h2>Список товаров</h2><p>${esc(TR.fromName)} → ${esc(TR.toName)}</p></div></div>
      <div class="tbl-wrap">
        <table class="tbl tr-tbl">
          <thead><tr><th>Товар</th><th class="c">Код</th><th class="c">Размер</th><th class="c">Кол-во</th><th class="c"></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" class="tr-empty">Список пуст</td></tr>'}</tbody>
        </table>
      </div>
      <div class="tr-actions">
        <button class="tr-btn tr-btn-outline" id="trBackScan">📷 Ещё сканировать</button>
        <button class="tr-btn tr-btn-primary" id="trToCheck" ${TR.items.length ? '' : 'disabled'}>Перейти к сверке →</button>
      </div>
    </div>
  </div>`;
}

// ── Экран 5: сверка ──
function trCheckHTML() {
  const codes = TR.items.map(i => i.barcode);
  const dupMap = {};
  codes.forEach(c => { dupMap[c] = (dupMap[c] || 0) + 1; });
  const dups = Object.keys(dupMap).filter(c => dupMap[c] > 1);
  const notFound = TR.items.filter(i => !i.productC1Ref).length;
  const matched = TR.items.filter(i => i.productC1Ref).length;
  return `
  <div class="tr-wrap">
    <div class="tr-kpis three">
      <div class="tr-kpi"><span>Товаров</span><b>${fmtInt(TR.items.length)}</b></div>
      <div class="tr-kpi"><span>Единиц по факту</span><b>${fmtInt(trUnits())}</b></div>
      <div class="tr-kpi"><span>Уникальных кодов</span><b>${fmtInt(trUniqCodes())}</b></div>
    </div>
    <div class="tr-card">
      <div class="tr-card-head sm"><span class="tr-ic">✅</span><div><h2>Сверка товаров</h2><p>Проверьте коды и количество перед проведением</p></div></div>
      <div class="tr-check-block">
        <div class="tr-check-title">Проверка кодов</div>
        <div class="tr-check-row ok"><span>Совпадают (найдены в 1С)</span><b>${fmtInt(matched)}</b></div>
        <div class="tr-check-row ${notFound ? 'warn' : ''}"><span>Не найдены</span><b>${fmtInt(notFound)}</b></div>
        <div class="tr-check-row ${dups.length ? 'warn' : ''}"><span>Дублируются</span><b>${fmtInt(dups.length)}</b></div>
      </div>
      <div class="tr-check-block">
        <div class="tr-check-title">Проверка количества</div>
        <div class="tr-check-row ok"><span>Совпадает</span><b>${fmtInt(TR.items.length)}</b></div>
        <div class="tr-check-row"><span>Излишки</span><b>0</b></div>
        <div class="tr-check-row"><span>Недостача</span><b>0</b></div>
      </div>
      ${dups.length ? `<div class="tr-info warn"><span class="tr-info-ic">⚠️</span><div>Обнаружены повторяющиеся штрихкоды: ${dups.map(d=>last4(d)).join(', ')}. Один экземпляр = один уникальный штрихкод.</div></div>` : ''}
      <div class="tr-actions">
        <button class="tr-btn tr-btn-outline" id="trBackList">← Назад к списку</button>
        <button class="tr-btn tr-btn-primary" id="trToConfirm">Подтвердить перемещение →</button>
      </div>
    </div>
  </div>`;
}

// ── Экран 6: подтверждение ──
function trConfirmHTML() {
  return `
  <div class="tr-wrap">
    <div class="tr-card">
      <div class="tr-card-head sm"><span class="tr-ic">📝</span><div><h2>Подтверждение перемещения</h2><p>Проверьте данные и укажите ответственных</p></div></div>
      <div class="tr-conf-info">
        <div class="tr-conf-row"><span>Откуда</span><b>${esc(TR.fromName)}</b></div>
        <div class="tr-conf-row"><span>Куда</span><b>${esc(TR.toName)}</b></div>
        <div class="tr-conf-row"><span>Товаров</span><b>${fmtInt(TR.items.length)}</b></div>
        <div class="tr-conf-row"><span>Единиц</span><b>${fmtInt(trUnits())}</b></div>
        <div class="tr-conf-row"><span>Уникальных кодов</span><b>${fmtInt(trUniqCodes())}</b></div>
        ${TR.comment ? `<div class="tr-conf-row"><span>Комментарий</span><b>${esc(TR.comment)}</b></div>` : ''}
      </div>
      <div class="tr-resp">
        <div class="tr-resp-title">Ответственные</div>
        <label class="tr-fld"><span>Отправил</span><input type="text" id="trSender" class="tr-input" placeholder="ФИО отправившего" value="${esc(TR.sender)}"></label>
        <label class="tr-fld"><span>Принял</span><input type="text" id="trReceiver" class="tr-input" placeholder="ФИО принявшего" value="${esc(TR.receiver)}"></label>
      </div>
      <div class="tr-info"><span class="tr-info-ic">ℹ️</span><div>При нажатии будет создан и проведён документ «Перемещение товаров» в 1С. Экземпляры автоматически перевесятся на склад-получатель.</div></div>
      <div id="trConfirmErr"></div>
      <div class="tr-actions">
        <button class="tr-btn tr-btn-outline" id="trBackCheck">← Назад</button>
        <button class="tr-btn tr-btn-primary" id="trDoTransfer">🔄 Переместить товары</button>
      </div>
    </div>
  </div>`;
}

// ── Экран 7: успех ──
function trDoneHTML() {
  const r = TR.result || {};
  return `
  <div class="tr-wrap">
    <div class="tr-card tr-added tr-done">
      <div class="tr-added-badge">✓</div>
      <h2 class="tr-added-title">Перемещение выполнено успешно</h2>
      <div class="tr-done-num">№ ${esc(r.number || '—')}</div>
      <div class="tr-done-date">${esc(r.dateLabel || nowDushLabel())}</div>
      <div class="tr-done-sub">${esc(TR.fromName)} → ${esc(TR.toName)} · ${fmtInt(TR.items.length)} тов. / ${fmtInt(trUnits())} ед.</div>
      <button class="tr-btn tr-btn-primary tr-btn-block" id="trPdf">📄 Скачать документ (PDF)</button>
      <button class="tr-btn tr-btn-outline tr-btn-block" id="trHome">На главную</button>
    </div>
  </div>`;
}

// ── обработчики ──
function trBind() {
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  if (TR.step === 'setup') {
    on('trFrom', 'change', e => { TR.fromRef = e.target.value; TR.fromName = trWhName(e.target.value); });
    on('trTo', 'change', e => { TR.toRef = e.target.value; TR.toName = trWhName(e.target.value); });
    on('trComment', 'input', e => { TR.comment = e.target.value; });
    on('trStart', 'click', () => {
      const err = $('trSetupErr');
      if (!TR.fromRef || !TR.toRef) { err.innerHTML = errBar('Выберите оба склада'); return; }
      if (TR.fromRef === TR.toRef) { err.innerHTML = errBar('Склады отправителя и получателя должны отличаться'); return; }
      TR.step = 'scan'; trPaint();
    });
  } else if (TR.step === 'scan') {
    on('trScanClose', 'click', () => { TR.step = TR.items.length ? 'list' : 'setup'; trPaint(); });
    on('trScanFinish', 'click', () => { TR.step = TR.items.length ? 'list' : 'setup'; trPaint(); });
    on('trManualAdd', 'click', () => { const v = ($('trManual').value || '').trim(); if (v) trHandleScan(v); });
    on('trManual', 'keydown', e => { if (e.key === 'Enter') { const v = (e.target.value||'').trim(); if (v) trHandleScan(v); } });
  } else if (TR.step === 'added') {
    on('trAddNext', 'click', () => { TR.step = 'scan'; trPaint(); });
    on('trGoList', 'click', () => { TR.step = 'list'; trPaint(); });
  } else if (TR.step === 'list') {
    on('trBackScan', 'click', () => { TR.step = 'scan'; trPaint(); });
    on('trToCheck', 'click', () => { if (TR.items.length) { TR.step = 'check'; trPaint(); } });
    document.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      TR.items.splice(Number(b.dataset.del), 1); trPaint();
    }));
  } else if (TR.step === 'check') {
    on('trBackList', 'click', () => { TR.step = 'list'; trPaint(); });
    on('trToConfirm', 'click', () => { TR.step = 'confirm'; trPaint(); });
  } else if (TR.step === 'confirm') {
    on('trSender', 'input', e => { TR.sender = e.target.value; });
    on('trReceiver', 'input', e => { TR.receiver = e.target.value; });
    on('trBackCheck', 'click', () => { TR.step = 'check'; trPaint(); });
    on('trDoTransfer', 'click', trDoTransfer);
  } else if (TR.step === 'done') {
    on('trPdf', 'click', trBuildPDF);
    on('trHome', 'click', () => { TR.step = 'setup'; TR.items = []; TR.result = null; TR.comment=''; TR.sender=''; TR.receiver=''; trPaint(); });
  }
}

function trWhName(ref) { const w = TR.warehouses.find(x => x.c1Ref === ref); return w ? w.name : ''; }

// ── сканер ──
function trStartScanner() {
  const el = $('trReader');
  if (!el || TR.scanning) return;
  if (typeof Html5Qrcode === 'undefined') { const h = $('trScanHint'); if (h) h.textContent = 'Сканер недоступен — введите штрихкод вручную'; return; }
  try {
    TR.scanner = new Html5Qrcode('trReader', { verbose: false });
    TR.scanning = true;
    const fmts = (window.Html5QrcodeSupportedFormats) ? [
      Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8, Html5QrcodeSupportedFormats.CODE_128,
    ] : undefined;
    TR.scanner.start({ facingMode: 'environment' },
      { fps: 10, qrbox: { width: 260, height: 160 }, ...(fmts ? { formatsToSupport: fmts } : {}) },
      (txt) => { const bc = String(txt || '').trim(); if (bc) trHandleScan(bc); },
      () => {}
    ).catch(err => { const h = $('trScanHint'); if (h) h.textContent = 'Нет доступа к камере — введите штрихкод вручную'; TR.scanning = false; });
  } catch (e) { TR.scanning = false; }
}
function trStopScanner() {
  if (TR.scanner && TR.scanning) {
    try { TR.scanner.stop().then(() => { try { TR.scanner.clear(); } catch(_){} }).catch(()=>{}); } catch(_){}
  }
  TR.scanning = false; TR.scanner = null;
}

let trScanLock = false;
async function trHandleScan(barcode) {
  if (TR.busy || trScanLock) return;
  trScanLock = true;
  setTimeout(() => { trScanLock = false; }, 900); // антидребезг
  const hint = $('trScanHint');
  // дубликат экземпляра — один штрихкод = один экземпляр
  if (TR.items.some(i => i.barcode === barcode)) {
    if (hint) { hint.textContent = 'Этот штрихкод уже добавлен'; hint.classList.add('warn'); setTimeout(()=>hint&&hint.classList.remove('warn'),1500); }
    return;
  }
  if (hint) hint.textContent = 'Ищу товар…';
  TR.busy = true;
  try {
    const d = await posApi(`?action=transfer-scan&barcode=${encodeURIComponent(barcode)}&warehouse=${encodeURIComponent(TR.fromRef)}`, { method: 'GET' });
    if (!d.found) {
      if (hint) { hint.textContent = 'Товар не найден: ' + barcode; hint.classList.add('warn'); setTimeout(()=>hint&&hint.classList.remove('warn'),2000); }
      TR.busy = false; return;
    }
    // БЛОКИРОВКА: нельзя перемещать экземпляр, который не числится
    // (in_stock) на складе-отправителе. Сервер всё равно проверит при проведении,
    // но отсекаем сразу на скане, чтобы кассир не добавлял лишнее.
    if (d.inSourceWh !== true) {
      const msg = d.warning || (d.status && d.status !== 'in_stock'
        ? 'Экземпляр не в наличии' : 'Экземпляр не числится на складе «' + TR.fromName + '»');
      if (hint) { hint.textContent = '⛔ ' + msg + ' — перемещение невозможно'; hint.classList.add('warn'); setTimeout(()=>hint&&hint.classList.remove('warn'),3200); }
      TR.busy = false; return;
    }
    const it = {
      barcode: d.uniqueBarcode || barcode,
      name: d.name || '—',
      productCode: d.productCode || '',
      sizeLabel: (d.sizeLabel || '').replace(/^размер:\s*/i, ''),
      price: Number(d.price) || 0,
      productC1Ref: d.productC1Ref || null,
      charC1Ref: d.charC1Ref || null,
      qty: 1,
    };
    TR.items.push(it);
    TR.lastAdded = it;
    TR.busy = false;
    TR.step = 'added';
    trPaint();
  } catch (e) {
    TR.busy = false;
    if (hint) { hint.textContent = 'Ошибка: ' + e.message; hint.classList.add('warn'); setTimeout(()=>hint&&hint.classList.remove('warn'),2000); }
  }
}

// ── проведение (WRITE в 1С — только по явному нажатию пользователя) ──
async function trDoTransfer() {
  if (TR.busy) return;
  const err = $('trConfirmErr');
  const btn = $('trDoTransfer');
  TR.busy = true;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Создаю документ в 1С…'; }
  try {
    const body = {
      fromC1Ref: TR.fromRef, toC1Ref: TR.toRef, comment: TR.comment,
      senderName: TR.sender, receiverName: TR.receiver,
      items: TR.items.map(i => ({ barcode: i.barcode, productC1Ref: i.productC1Ref, charC1Ref: i.charC1Ref, price: i.price, qty: i.qty })),
      dryRun: false,
    };
    const d = await posApi('?action=transfer-create', { method: 'POST', body: JSON.stringify(body) });
    TR.result = { number: d.number, ref: d.ref, date: d.date, dateLabel: d.date ? dushTime(d.date, true) : nowDushLabel(), sumTotal: d.sumTotal };
    TR.busy = false;
    TR.step = 'done';
    trPaint();
  } catch (e) {
    TR.busy = false;
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Переместить товары'; }
    if (err) err.innerHTML = errBar('Не удалось провести перемещение: ' + e.message);
  }
}

// ── PDF документа перемещения ──
function trBuildPDF() {
  const r = TR.result || {};
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    // шрифт с кириллицей (из fonts-dejavu.js); fallback — helvetica
    const FONT = (doc.getFontList && doc.getFontList().DejaVuSans) ? 'DejaVuSans' : 'helvetica';
    const W = 210, M = 14;
    let y = 18;
    doc.setFont(FONT, 'bold'); doc.setFontSize(16);
    doc.text('Перемещение товаров', M, y);
    doc.setFontSize(11); doc.setFont(FONT, 'normal');
    doc.text('Документ №: ' + (r.number || '-'), M, y + 7);
    doc.text('Дата: ' + (r.dateLabel || nowDushLabel()), M, y + 13);
    y += 22;
    doc.setDrawColor(210); doc.line(M, y, W - M, y); y += 8;

    doc.setFont(FONT, 'bold'); doc.text('Откуда:', M, y);
    doc.setFont(FONT, 'normal'); doc.text(String(TR.fromName || '-'), M + 24, y);
    y += 7;
    doc.setFont(FONT, 'bold'); doc.text('Куда:', M, y);
    doc.setFont(FONT, 'normal'); doc.text(String(TR.toName || '-'), M + 24, y);
    y += 9;
    doc.setFont(FONT, 'bold'); doc.text('Отправил:', M, y);
    doc.setFont(FONT, 'normal'); doc.text(String(TR.sender || '____________________'), M + 24, y);
    doc.setFont(FONT, 'bold'); doc.text('Принял:', W/2, y);
    doc.setFont(FONT, 'normal'); doc.text(String(TR.receiver || '____________________'), W/2 + 22, y);
    y += 6;

    const rows = TR.items.map((it, i) => [
      String(i + 1), String(it.name || '-'), last4(it.barcode), it.sizeLabel || '-', String(it.qty || 1),
    ]);
    doc.autoTable({
      startY: y + 2,
      head: [['#', 'Товар', 'Код (посл.4)', 'Размер', 'Кол-во']],
      body: rows,
      styles: { font: FONT, fontSize: 9, cellPadding: 2 },
      headStyles: { font: FONT, fontStyle: 'bold', fillColor: [16, 185, 129], textColor: 255, halign: 'center' },
      columnStyles: { 0: { halign: 'center', cellWidth: 12 }, 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center' } },
      margin: { left: M, right: M },
    });
    let yy = doc.lastAutoTable.finalY + 8;
    doc.setFont(FONT, 'bold'); doc.setFontSize(11);
    doc.text('Итого единиц: ' + trUnits(), M, yy);
    doc.text('Уник. кодов: ' + trUniqCodes(), M + 70, yy);
    yy += 14;
    doc.setDrawColor(16, 185, 129); doc.setLineWidth(0.6);
    doc.roundedRect(M, yy - 6, W - 2*M, 12, 2, 2);
    doc.setTextColor(16, 133, 96);
    doc.text('Перемещение подтверждено', W/2, yy + 2, { align: 'center' });
    doc.setTextColor(0,0,0);

    doc.save(`peremeshchenie_${r.number || 'doc'}.pdf`);
  } catch (e) {
    alert('Не удалось сформировать PDF: ' + e.message);
  }
}


// ══════════════════════════════════════════════════════════
//  РАЗДЕЛ: ДВИЖЕНИЕ ДЕНЕЖНЫХ СРЕДСТВ (расходы/выручка + ИИ)
// ══════════════════════════════════════════════════════════
const FIN = {
  loaded: false,
  cats: [],        // категории
  salons: [],      // [{warehouse_id,name}]
  expenses: [],    // расходы за период
  sub: 'overview', // под-вкладка: overview | expenses | fixed | compare | revenue | suppliers | employees
  page: 1,
  perPage: 25,
  flt: { cat: '', salon: '', kind: '', q: '' },
  form: { kind: 'variable' }, // состояние панели добавления
  // расширение «Выручка-Расходы»
  profit: null,      // сводка прибыли (fin-profit)
  suppliers: null,   // [{...,debt_tjs,debt_foreign}]
  employees: null,   // [{...,salaries:[]}]
  fx: null,          // {USD:{rate,date},CNY:{...}}
  supOpsOpen: null,  // id открытого поставщика (история операций)
};

// первый и последний день текущего месяца по Душанбе (для дефолтного периода)
function finMonthBounds() {
  const t = dushToday();               // YYYY-MM-DD
  const ym = t.slice(0, 7);
  const first = ym + '-01';
  const y = +ym.slice(0, 4), m = +ym.slice(5, 7);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${ym}-${String(lastDay).padStart(2, '0')}`;
  return { first, last, ym };
}
function finKindLabel(k) { return k === 'fixed' ? 'Постоянный' : 'Переменный'; }
function finOwnerLabel(o) { return o === 'salon' ? 'Салон' : (o === 'office' ? 'Офис' : 'Общий'); }
function finSalonName(id) { const s = FIN.salons.find(x => x.warehouse_id === id); return s ? s.name : '—'; }
function finCatName(id) { const c = FIN.cats.find(x => x.id === id); return c ? c.name : null; }
function finCatIcon(id) { const c = FIN.cats.find(x => x.id === id); return c && c.icon ? c.icon : '📌'; }
// период расхода для отображения: expense_date или период-месяц
function finExpDate(e) { return e.expense_date || (e.period_month ? e.period_month : ''); }

async function renderFinance(force) {
  const box = $('finBody');
  if (force) FIN.loaded = false;
  if (!FIN.loaded) {
    box.innerHTML = `<div class="loading">⏳ Загружаю финансовые данные…</div>`;
    try {
      const b = finMonthBounds();
      if (!FIN._from) { FIN._from = b.first; FIN._to = b.last; }
      const [catsR, salonsR] = await Promise.all([
        cachedApi('fin:cats', '?action=fin-categories'),
        cachedApi('fin:salons', '?action=fin-salons'),
      ]);
      FIN.cats = catsR.categories || [];
      FIN.salons = salonsR.salons || [];
      await finLoadExpenses();
      FIN.loaded = true;
    } catch (e) {
      box.innerHTML = errBar('Не удалось загрузить финансы: ' + (e.message || e));
      return;
    }
  }
  finPaint();
}

// загрузка расходов за выбранный период (по period_month через from/to)
async function finLoadExpenses() {
  const fromM = (FIN._from || '').slice(0, 7) + '-01';
  const toM = (FIN._to || '').slice(0, 7) + '-01';
  const d = await posApi(`?action=fin-expenses&from=${fromM}&to=${toM}`, { method: 'GET' });
  FIN.expenses = (d.expenses || []);
}

// текущий набор расходов после клиентских фильтров (категория/салон/тип/поиск/подвкладка)
function finFiltered() {
  let arr = FIN.expenses.slice();
  if (FIN.sub === 'fixed') arr = arr.filter(e => e.kind === 'fixed');
  if (FIN.flt.kind) arr = arr.filter(e => e.kind === FIN.flt.kind);
  if (FIN.flt.cat) arr = arr.filter(e => (e.category_id || '') === FIN.flt.cat);
  if (FIN.flt.salon) arr = arr.filter(e => (e.warehouse_id || '') === FIN.flt.salon);
  if (FIN.flt.q) {
    const q = FIN.flt.q.toLowerCase();
    arr = arr.filter(e => {
      const cat = (finCatName(e.category_id) || '').toLowerCase();
      const t = (e.title || '').toLowerCase();
      const cm = (e.comment || '').toLowerCase();
      return cat.includes(q) || t.includes(q) || cm.includes(q);
    });
  }
  // фильтр по датам внутри периода (по expense_date, если задан)
  arr = arr.filter(e => {
    const d = e.expense_date;
    if (!d) return true;
    if (FIN._from && d < FIN._from) return false;
    if (FIN._to && d > FIN._to) return false;
    return true;
  });
  return arr;
}

function finPaint() {
  const box = $('finBody');
  const per = FIN._from === FIN._to ? FIN._from : `${FIN._from} — ${FIN._to}`;
  const all = FIN.expenses;
  const totalAll = all.reduce((s, e) => s + (+e.amount || 0), 0);
  const totalFixed = all.filter(e => e.kind === 'fixed').reduce((s, e) => s + (+e.amount || 0), 0);
  const totalVar = totalAll - totalFixed;
  const pFixed = totalAll ? Math.round(totalFixed / totalAll * 100) : 0;
  const pVar = totalAll ? 100 - pFixed : 0;

  const subChip = (key, label) =>
    `<button class="fin-chip ${FIN.sub === key ? 'active' : ''}" data-sub="${key}">${label}</button>`;

  box.innerHTML = `
    <!-- Верхняя панель: период + магазины + экспорт -->
    <div class="fin-toolbar">
      <div class="fin-period">
        <label>Период
          <span class="fin-daterange">
            <input type="date" id="finFrom" value="${FIN._from}">
            <span>—</span>
            <input type="date" id="finTo" value="${FIN._to}">
          </span>
        </label>
        <button class="btn btn-ghost btn-sm" id="finApplyPeriod">Применить</button>
      </div>
      <div class="fin-tb-right">
        <span class="badge off">Все магазины (${FIN.salons.length})</span>
        <button class="btn btn-ghost btn-sm" id="finExport">⬇ Экспорт</button>
      </div>
    </div>

    <!-- Под-вкладки -->
    <div class="fin-chips">
      ${subChip('overview', '📊 Обзор')}
      ${subChip('expenses', 'Постоянные/переменные расходы')}
      ${subChip('fixed', 'Расходы по категориям')}
      ${subChip('suppliers', '🏷 Долги поставщикам')}
      ${subChip('employees', '👥 Сотрудники и зарплаты')}
      ${subChip('compare', 'Сравнение 6 мес')}
      ${subChip('revenue', 'Выручка (ручной ввод)')}
    </div>

    <div id="finSubBody"></div>
  `;

  // события верхней панели
  $('finApplyPeriod').addEventListener('click', async () => {
    const f = $('finFrom').value, t = $('finTo').value;
    if (!f || !t) return;
    FIN._from = f; FIN._to = t; FIN.page = 1;
    $('finSubBody').innerHTML = `<div class="loading">⏳ Обновляю…</div>`;
    try { await finLoadExpenses(); } catch (e) { $('finSubBody').innerHTML = errBar(e.message || e); return; }
    finPaintSub();
  });
  $('finExport').addEventListener('click', finExportCsv);
  box.querySelectorAll('.fin-chip').forEach(b =>
    b.addEventListener('click', () => { FIN.sub = b.dataset.sub; FIN.page = 1; finPaint(); }));

  finPaintSub({ totalAll, totalFixed, totalVar, pFixed, pVar, per });
}

function finPaintSub(pre) {
  if (FIN.sub === 'overview') return finPaintOverview();
  if (FIN.sub === 'suppliers') return finPaintSuppliers();
  if (FIN.sub === 'employees') return finPaintEmployees();
  if (FIN.sub === 'compare') return finPaintCompare();
  if (FIN.sub === 'revenue') return finPaintRevenue();
  // expenses / fixed → одинаковая раскладка (fixed отфильтрован в finFiltered)
  finPaintExpenses(pre);
}

// ————— Основной экран расходов —————
function finPaintExpenses(pre) {
  const host = $('finSubBody');
  const all = FIN.expenses;
  const totalAll = all.reduce((s, e) => s + (+e.amount || 0), 0);
  const totalFixed = all.filter(e => e.kind === 'fixed').reduce((s, e) => s + (+e.amount || 0), 0);
  const totalVar = totalAll - totalFixed;
  const pFixed = totalAll ? Math.round(totalFixed / totalAll * 100) : 0;
  const pVar = totalAll ? 100 - pFixed : 0;

  // структура по категориям (для пончика) — по всем расходам периода
  const byCat = new Map();
  for (const e of all) {
    const key = e.category_id || ('t:' + (e.title || 'Прочее'));
    const name = finCatName(e.category_id) || e.title || 'Прочее';
    const cur = byCat.get(key) || { name, amount: 0 };
    cur.amount += (+e.amount || 0); byCat.set(key, cur);
  }
  const catList = Array.from(byCat.values()).sort((a, b) => b.amount - a.amount);

  const filtered = finFiltered();
  const totalFiltered = filtered.reduce((s, e) => s + (+e.amount || 0), 0);
  const pages = Math.max(1, Math.ceil(filtered.length / FIN.perPage));
  if (FIN.page > pages) FIN.page = pages;
  const pageRows = filtered.slice((FIN.page - 1) * FIN.perPage, FIN.page * FIN.perPage);

  const catOpts = ['<option value="">Все категории</option>']
    .concat(FIN.cats.map(c => `<option value="${c.id}" ${FIN.flt.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`)).join('');
  const salonOpts = ['<option value="">Все магазины</option>']
    .concat(FIN.salons.map(s => `<option value="${s.warehouse_id}" ${FIN.flt.salon === s.warehouse_id ? 'selected' : ''}>${esc(s.name)}</option>`)).join('');

  host.innerHTML = `
    <!-- Панель фильтров -->
    <div class="fin-filters card card-pad">
      <div class="fin-flt-grid">
        <label class="fld-inline"><span>Категория</span>
          <select id="finFltCat">${catOpts}</select></label>
        <label class="fld-inline"><span>Магазин</span>
          <select id="finFltSalon">${salonOpts}</select></label>
        <label class="fld-inline"><span>Тип расхода</span>
          <select id="finFltKind">
            <option value="">Все типы</option>
            <option value="fixed" ${FIN.flt.kind === 'fixed' ? 'selected' : ''}>Постоянный</option>
            <option value="variable" ${FIN.flt.kind === 'variable' ? 'selected' : ''}>Переменный</option>
          </select></label>
        <label class="fld-inline fin-search"><span>Поиск</span>
          <input type="text" id="finFltQ" placeholder="Название, категория, комментарий…" value="${esc(FIN.flt.q)}"></label>
      </div>
    </div>

    <!-- KPI + пончик -->
    <div class="fin-grid-kpi">
      <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:0">
        ${kpi('💸','Всего расходов', money(totalAll),'red', `${all.length} записей`)}
        ${kpi('📌','Постоянные', money(totalFixed),'amber', `${pFixed}% от суммы`)}
        ${kpi('🔁','Переменные', money(totalVar),'gray', `${pVar}% от суммы`)}
      </div>
      <div class="card card-pad fin-donut-card">
        <div class="card-h-row"><h3>Структура расходов</h3></div>
        <div class="fin-donut-wrap">
          <div class="chart-box" style="height:200px;position:relative"><canvas id="finDonut"></canvas></div>
          <div class="fin-legend" id="finLegend"></div>
        </div>
      </div>
    </div>

    <!-- Основной ряд: таблица + панель добавления -->
    <div class="fin-main-row">
      <div class="card card-pad fin-table-card">
        <div class="card-h-row">
          <h3>Список расходов</h3>
          <button class="btn btn-primary btn-sm" id="finAddBtn">+ Добавить расход</button>
        </div>
        <div class="tbl-wrap">
          <table class="tbl fin-tbl">
            <thead><tr>
              <th>Дата</th><th>Тип</th><th>Категория</th><th>Название</th>
              <th>Магазин</th><th class="r">Сумма</th><th>Комментарий</th><th></th>
            </tr></thead>
            <tbody>
              ${pageRows.length ? pageRows.map(finRowHtml).join('') :
                `<tr><td colspan="8" class="tbl-empty">Нет расходов по фильтрам</td></tr>`}
            </tbody>
            ${filtered.length ? `<tfoot><tr class="tbl-total">
              <td colspan="5">Итого (${filtered.length})</td>
              <td class="r neg">${money(totalFiltered)}</td><td colspan="2"></td>
            </tr></tfoot>` : ''}
          </table>
        </div>
        ${pages > 1 ? `<div class="fin-pager">
          <button class="btn btn-ghost btn-sm" id="finPrev" ${FIN.page <= 1 ? 'disabled' : ''}>‹ Назад</button>
          <span class="muted">Стр. ${FIN.page} из ${pages}</span>
          <button class="btn btn-ghost btn-sm" id="finNext" ${FIN.page >= pages ? 'disabled' : ''}>Вперёд ›</button>
        </div>` : ''}
      </div>

      <div class="card card-pad fin-add-card" id="finAddCard">
        <div class="card-h-row"><h3>Добавить расход</h3></div>
        ${finAddFormHtml()}
      </div>
    </div>

    <!-- ИИ-блоки -->
    <div class="fin-ai-row">
      <div class="card card-pad fin-ai-card">
        <div class="fin-ai-head"><span class="fin-ai-ic purple">🧠</span>
          <div><div class="fin-ai-title">ИИ-аналитик расходов</div>
          <div class="fin-ai-sub">Анализ структуры расходов за период на базе Claude</div></div></div>
        <div class="fin-ai-body" id="finAiAnalysisBody">
          <p class="muted">Нажмите «Подробнее», чтобы ИИ проанализировал расходы за выбранный месяц.</p>
        </div>
        <button class="btn btn-ghost btn-sm" id="finAiAnalysisBtn">Подробнее →</button>
      </div>
      <div class="card card-pad fin-ai-card">
        <div class="fin-ai-head"><span class="fin-ai-ic green">💡</span>
          <div><div class="fin-ai-title">ИИ-рекомендация</div>
          <div class="fin-ai-sub">Быстрое добавление расхода из текста</div></div></div>
        <div class="fin-ai-body">
          <textarea id="finAiText" class="fin-ai-text" rows="2" placeholder="Напр.: аренда Сиёма 4500 за июль"></textarea>
          <div id="finAiParsePreview"></div>
        </div>
        <button class="btn btn-ghost btn-sm" id="finAiParseBtn">Разобрать текст →</button>
      </div>
    </div>

    <!-- Графики -->
    <div class="fin-charts-row">
      <div class="card card-pad">
        <div class="card-h-row"><h3>Динамика расходов</h3><span class="muted">По дням</span></div>
        <div class="chart-box" style="height:220px"><canvas id="finTrend"></canvas></div>
      </div>
      <div class="card card-pad">
        <div class="card-h-row"><h3>Расходы по категориям (за период)</h3></div>
        ${catList.length ? hbars(catList.slice(0, 12).map(c => ({
          label: `${c.name}`, value: c.amount,
          extra: totalAll ? Math.round(c.amount / totalAll * 100) + '%' : ''
        })), { money: true }) : `<div class="tbl-empty">Нет данных</div>`}
      </div>
    </div>
  `;

  // ——— пончик ———
  finDrawDonut('finDonut', 'finLegend', catList);
  // ——— график динамики ———
  finDrawTrend('finTrend', filtered);

  // ——— события фильтров ———
  $('finFltCat').addEventListener('change', e => { FIN.flt.cat = e.target.value; FIN.page = 1; finPaintSub(); });
  $('finFltSalon').addEventListener('change', e => { FIN.flt.salon = e.target.value; FIN.page = 1; finPaintSub(); });
  $('finFltKind').addEventListener('change', e => { FIN.flt.kind = e.target.value; FIN.page = 1; finPaintSub(); });
  let qT;
  $('finFltQ').addEventListener('input', e => { clearTimeout(qT); const v = e.target.value; qT = setTimeout(() => { FIN.flt.q = v; FIN.page = 1; finPaintSub(); }, 250); });

  // пагинация
  if ($('finPrev')) $('finPrev').addEventListener('click', () => { if (FIN.page > 1) { FIN.page--; finPaintSub(); } });
  if ($('finNext')) $('finNext').addEventListener('click', () => { FIN.page++; finPaintSub(); });

  // строки: удаление
  host.querySelectorAll('[data-del]').forEach(b =>
    b.addEventListener('click', () => finDeleteExpense(b.dataset.del)));

  // кнопка «+ Добавить» — фокус на панель
  $('finAddBtn').addEventListener('click', () => {
    const c = $('finAddCard'); if (c) { c.classList.add('flash'); setTimeout(() => c.classList.remove('flash'), 800); c.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    const amt = $('finFAmount'); if (amt) amt.focus();
  });

  finBindAddForm();
  finBindAi();
}

function finRowHtml(e) {
  const dt = finExpDate(e);
  const dtShow = dt ? dt.slice(0, 10).split('-').reverse().join('.') : '—';
  const kindCls = e.kind === 'fixed' ? 'amber' : 'gray';
  return `<tr>
    <td class="muted">${dtShow}</td>
    <td><span class="badge ${kindCls}">${finKindLabel(e.kind)}</span></td>
    <td>${finCatIcon(e.category_id)} ${esc(finCatName(e.category_id) || '—')}</td>
    <td>${esc(e.title || '—')}</td>
    <td class="muted">${e.warehouse_id ? esc(finSalonName(e.warehouse_id)) : finOwnerLabel(e.owner_type)}</td>
    <td class="r neg strong">${money(+e.amount || 0)}</td>
    <td class="muted">${esc(e.comment || '')}</td>
    <td class="r"><button class="fin-del" data-del="${e.id}" title="Удалить">✕</button></td>
  </tr>`;
}

// ————— Форма добавления —————
function finAddFormHtml() {
  const f = FIN.form;
  const catOpts = ['<option value="">— выбрать —</option>']
    .concat(FIN.cats.map(c => `<option value="${c.id}" ${f.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`)).join('');
  const salonOpts = ['<option value="">— выбрать —</option>']
    .concat(FIN.salons.map(s => `<option value="${s.warehouse_id}" ${f.warehouse_id === s.warehouse_id ? 'selected' : ''}>${esc(s.name)}</option>`)).join('');
  const today = dushToday();
  return `
    <div class="fin-form">
      <div class="fin-kind-toggle">
        <button class="fin-kt ${f.kind !== 'variable' ? 'active' : ''}" data-kind="fixed">Постоянный</button>
        <button class="fin-kt ${f.kind === 'variable' ? 'active' : ''}" data-kind="variable">Переменный</button>
      </div>
      <label class="fld-inline"><span>Владелец</span>
        <select id="finFOwner">
          <option value="salon" ${f.owner_type === 'salon' || !f.owner_type ? 'selected' : ''}>Салон</option>
          <option value="office" ${f.owner_type === 'office' ? 'selected' : ''}>Офис</option>
          <option value="common" ${f.owner_type === 'common' ? 'selected' : ''}>Общий</option>
        </select></label>
      <label class="fld-inline" id="finFSalonWrap"><span>Магазин (салон)</span>
        <select id="finFSalon">${salonOpts}</select></label>
      <label class="fld-inline"><span>Категория</span>
        <select id="finFCat">${catOpts}</select></label>
      <label class="fld-inline"><span>Название</span>
        <input type="text" id="finFTitle" placeholder="Напр.: Аренда за июль" value="${esc(f.title || '')}"></label>
      <label class="fld-inline"><span>Сумма (с.)</span>
        <input type="number" id="finFAmount" min="0" step="0.01" placeholder="0.00" value="${f.amount != null ? f.amount : ''}"></label>
      <label class="fld-inline"><span>Дата</span>
        <input type="date" id="finFDate" value="${f.expense_date || today}"></label>
      <label class="fld-inline"><span>Комментарий</span>
        <input type="text" id="finFComment" placeholder="Необязательно" value="${esc(f.comment || '')}"></label>
      <button class="btn btn-primary btn-block" id="finSaveBtn">Сохранить расход</button>
      <div id="finSaveMsg"></div>
    </div>`;
}

function finBindAddForm() {
  const owner = $('finFOwner');
  const salonWrap = $('finFSalonWrap');
  const syncSalon = () => { salonWrap.style.display = owner.value === 'salon' ? '' : 'none'; };
  syncSalon();
  owner.addEventListener('change', () => { FIN.form.owner_type = owner.value; syncSalon(); });

  document.querySelectorAll('.fin-kt').forEach(b =>
    b.addEventListener('click', () => {
      FIN.form.kind = b.dataset.kind;
      document.querySelectorAll('.fin-kt').forEach(x => x.classList.toggle('active', x === b));
    }));

  $('finSaveBtn').addEventListener('click', finSaveExpense);
}

async function finSaveExpense() {
  const msg = $('finSaveMsg');
  const owner_type = $('finFOwner').value;
  const kind = document.querySelector('.fin-kt.active') ? document.querySelector('.fin-kt.active').dataset.kind : 'variable';
  const warehouse_id = $('finFSalon').value || null;
  const category_id = $('finFCat').value || null;
  const title = $('finFTitle').value.trim();
  const amount = parseFloat($('finFAmount').value);
  const expense_date = $('finFDate').value || null;
  const comment = $('finFComment').value.trim();

  if (!(amount >= 0) || isNaN(amount)) { msg.innerHTML = errBar('Введите корректную сумму'); return; }
  if (owner_type === 'salon' && !warehouse_id) { msg.innerHTML = errBar('Для салона выберите магазин'); return; }

  msg.innerHTML = `<div class="muted">Сохраняю…</div>`;
  try {
    await posApi('?action=fin-expense-create', { method: 'POST', body: JSON.stringify({
      owner_type, kind, warehouse_id, category_id, title, amount, expense_date, comment,
    }) });
    // сброс формы (кроме типа/владельца)
    FIN.form = { kind, owner_type, warehouse_id };
    state.cache = {}; // сбрасываем кеш
    await finLoadExpenses();
    finPaint();
    // сообщение об успехе покажем после перерисовки
    const m2 = $('finSaveMsg'); if (m2) m2.innerHTML = `<div class="fin-ok">✓ Расход добавлен</div>`;
  } catch (e) {
    msg.innerHTML = errBar('Не удалось сохранить: ' + (e.message || e));
  }
}

async function finDeleteExpense(id) {
  if (!confirm('Удалить этот расход?')) return;
  try {
    await posApi('?action=fin-expense-delete', { method: 'POST', body: JSON.stringify({ id }) });
    FIN.expenses = FIN.expenses.filter(e => e.id !== id);
    state.cache = {};
    finPaintSub();
  } catch (e) { alert('Не удалось удалить: ' + (e.message || e)); }
}

// ————— ИИ —————
function finBindAi() {
  $('finAiAnalysisBtn').addEventListener('click', finRunAiAnalysis);
  $('finAiParseBtn').addEventListener('click', finRunAiParse);
}

async function finRunAiAnalysis() {
  const body = $('finAiAnalysisBody');
  body.innerHTML = `<div class="loading">🧠 ИИ анализирует расходы…</div>`;
  try {
    const month = (FIN._from || dushToday()).slice(0, 7) + '-01';
    const d = await posApi('?action=fin-ai-analysis', { method: 'POST', body: JSON.stringify({ month }) });
    const a = d.analysis || {};
    const recs = Array.isArray(a.recommendations) ? a.recommendations : [];
    body.innerHTML = `
      <p class="fin-ai-summary">${esc(a.summary || '—')}</p>
      ${a.largest ? `<p class="muted">Наибольшая категория: <b>${esc(a.largest)}</b></p>` : ''}
      ${recs.length ? `<ul class="fin-ai-list">${recs.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
      <p class="muted" style="font-size:12px">Расходы: ${money(d.total_expenses || 0)} · Выручка: ${money(d.total_revenue || 0)}</p>`;
  } catch (e) {
    const m = (e.message || '') + '';
    body.innerHTML = errBar(m.includes('503') || m.toLowerCase().includes('anthropic') || m.toLowerCase().includes('ии недоступен')
      ? 'ИИ недоступен: не задан ключ Claude в настройках сервера.'
      : 'Не удалось получить анализ: ' + m);
  }
}

async function finRunAiParse() {
  const prev = $('finAiParsePreview');
  const text = $('finAiText').value.trim();
  if (!text) { prev.innerHTML = errBar('Введите текст расхода'); return; }
  prev.innerHTML = `<div class="loading">🤖 Разбираю…</div>`;
  try {
    const d = await posApi('?action=fin-ai-parse', { method: 'POST', body: JSON.stringify({ text }) });
    const p = d.preview || {};
    prev.innerHTML = `
      <div class="fin-parse-card">
        <div class="fin-parse-grid">
          <div><span class="muted">Тип</span><b>${finKindLabel(p.kind)}</b></div>
          <div><span class="muted">Владелец</span><b>${finOwnerLabel(p.owner_type)}${p.salon_name ? ' · ' + esc(p.salon_name) : ''}</b></div>
          <div><span class="muted">Категория</span><b>${esc(p.category_name || '—')}${p.category_is_new ? ' <span class="badge amber">новая</span>' : ''}</b></div>
          <div><span class="muted">Сумма</span><b>${money(p.amount || 0)}</b></div>
          <div><span class="muted">Месяц</span><b>${(p.period_month || '').slice(0, 7)}</b></div>
        </div>
        <button class="btn btn-primary btn-sm btn-block" id="finParseApply">Заполнить форму этими данными →</button>
      </div>`;
    $('finParseApply').addEventListener('click', () => {
      FIN.form = {
        kind: p.kind, owner_type: p.owner_type, warehouse_id: p.warehouse_id || '',
        category_id: p.category_id || '', title: p.title || (p.category_is_new ? p.category_name : ''),
        amount: p.amount || '', expense_date: (p.period_month || '').slice(0, 10),
      };
      // перерисуем только форму
      const card = $('finAddCard');
      if (card) { card.innerHTML = `<div class="card-h-row"><h3>Добавить расход</h3></div>` + finAddFormHtml(); finBindAddForm(); card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 800); card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    });
  } catch (e) {
    const m = (e.message || '') + '';
    prev.innerHTML = errBar(m.includes('503') || m.toLowerCase().includes('ии недоступен')
      ? 'ИИ недоступен: не задан ключ Claude в настройках сервера.'
      : 'Не удалось разобрать: ' + m);
  }
}

// ————— Пончик (Chart.js) —————
const FIN_DONUT_COLORS = ['#10b981','#059669','#3b82f6','#f59e0b','#e11d48','#8b5cf6','#14b8a6','#f97316','#0ea5e9','#ec4899','#84cc16','#64748b'];
function finDrawDonut(canvasId, legendId, catList) {
  const el = $(canvasId); if (!el) return;
  destroyChart(canvasId);
  const top = catList.slice(0, 8);
  const rest = catList.slice(8);
  const restSum = rest.reduce((s, x) => s + x.amount, 0);
  const items = restSum > 0 ? top.concat([{ name: 'Прочее', amount: restSum }]) : top;
  const total = items.reduce((s, x) => s + x.amount, 0);
  if (!total) { const lg = $(legendId); if (lg) lg.innerHTML = '<span class="muted">Нет данных</span>'; return; }
  state.charts[canvasId] = new Chart(el, {
    type: 'doughnut',
    data: { labels: items.map(x => x.name),
      datasets: [{ data: items.map(x => Math.round(x.amount)),
        backgroundColor: items.map((_, i) => FIN_DONUT_COLORS[i % FIN_DONUT_COLORS.length]), borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { display: false },
      tooltip: { callbacks: { label: c => `${c.label}: ${fmtNum(c.parsed)} с. (${Math.round(c.parsed / total * 100)}%)` } } } },
  });
  const lg = $(legendId);
  if (lg) lg.innerHTML = items.map((x, i) => `
    <div class="fin-leg-row">
      <span class="fin-leg-dot" style="background:${FIN_DONUT_COLORS[i % FIN_DONUT_COLORS.length]}"></span>
      <span class="fin-leg-name">${esc(x.name)}</span>
      <span class="fin-leg-val">${Math.round(x.amount / total * 100)}%</span>
    </div>`).join('');
}

// ————— График динамики по дням —————
function finDrawTrend(canvasId, expenses) {
  const el = $(canvasId); if (!el) return;
  destroyChart(canvasId);
  const byDay = new Map();
  for (const e of expenses) {
    const d = finExpDate(e).slice(0, 10);
    if (!d) continue;
    byDay.set(d, (byDay.get(d) || 0) + (+e.amount || 0));
  }
  const days = Array.from(byDay.keys()).sort();
  if (!days.length) {
    const ctx = el.getContext('2d'); ctx.clearRect(0, 0, el.width, el.height);
    return;
  }
  state.charts[canvasId] = new Chart(el, {
    type: 'line',
    data: { labels: days.map(d => d.slice(5)),
      datasets: [{ label: 'Расходы', data: days.map(d => Math.round(byDay.get(d))),
        borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,.12)', fill: true, tension: .3, pointRadius: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false },
      tooltip: { callbacks: { label: c => `${fmtNum(c.parsed.y)} с.` } } },
      scales: { y: { ticks: { callback: v => fmtInt(v) } } } },
  });
}

// ————— Под-вкладка: Сравнение 6 месяцев —————
async function finPaintCompare() {
  const host = $('finSubBody');
  host.innerHTML = `<div class="loading">⏳ Считаю по месяцам…</div>`;
  try {
    // возьмём последние 6 месяцев относительно конца выбранного периода
    const end = (FIN._to || dushToday()).slice(0, 7);
    const [ey, em] = [+end.slice(0, 4), +end.slice(5, 7)];
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const dt = new Date(Date.UTC(ey, em - 1 - i, 1));
      months.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    const fromM = months[0] + '-01', toM = months[5] + '-01';
    const d = await posApi(`?action=fin-expenses&from=${fromM}&to=${toM}`, { method: 'GET' });
    const exp = d.expenses || [];
    const sums = new Map(months.map(m => [m, { fixed: 0, variable: 0 }]));
    for (const e of exp) {
      const m = (e.period_month || '').slice(0, 7);
      if (!sums.has(m)) continue;
      const o = sums.get(m); o[e.kind === 'fixed' ? 'fixed' : 'variable'] += (+e.amount || 0);
    }
    const RU = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
    const labels = months.map(m => `${RU[+m.slice(5, 7) - 1]} ${m.slice(2, 4)}`);
    host.innerHTML = `
      <div class="card card-pad">
        <div class="card-h-row"><h3>Сравнение расходов за 6 месяцев</h3></div>
        <div class="chart-box" style="height:280px"><canvas id="finCompare"></canvas></div>
      </div>
      <div class="card card-pad">
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Месяц</th><th class="r">Постоянные</th><th class="r">Переменные</th><th class="r">Итого</th></tr></thead>
          <tbody>${months.map((m, i) => { const o = sums.get(m); const tot = o.fixed + o.variable; return `<tr>
            <td>${labels[i]}</td><td class="r">${money(o.fixed)}</td><td class="r">${money(o.variable)}</td>
            <td class="r strong neg">${money(tot)}</td></tr>`; }).join('')}</tbody>
        </table></div>
      </div>`;
    destroyChart('finCompare');
    state.charts['finCompare'] = new Chart($('finCompare'), {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'Постоянные', data: months.map(m => Math.round(sums.get(m).fixed)), backgroundColor: '#f59e0b' },
        { label: 'Переменные', data: months.map(m => Math.round(sums.get(m).variable)), backgroundColor: '#10b981' },
      ] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } },
        scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: v => fmtInt(v) } } } },
    });
  } catch (e) {
    host.innerHTML = errBar('Не удалось построить сравнение: ' + (e.message || e));
  }
}

// ————— Под-вкладка: Выручка (ручной ввод) —————
async function finPaintRevenue() {
  const host = $('finSubBody');
  host.innerHTML = `<div class="loading">⏳ Загружаю выручку…</div>`;
  try {
    const month = (FIN._from || dushToday()).slice(0, 7) + '-01';
    const d = await posApi(`?action=fin-revenue&month=${month}`, { method: 'GET' });
    const rev = d.revenue || [];
    const byWh = new Map(rev.map(r => [r.warehouse_id || 'net', +r.amount || 0]));
    const netTotal = byWh.get('net') || 0;
    const rows = FIN.salons.map(s => {
      const v = byWh.get(s.warehouse_id) || 0;
      return `<tr>
        <td>${esc(s.name)}</td>
        <td class="r"><input type="number" class="fin-rev-inp" data-wh="${s.warehouse_id}" min="0" step="0.01" value="${v || ''}" placeholder="0.00"></td>
      </tr>`;
    }).join('');
    host.innerHTML = `
      <div class="card card-pad">
        <div class="card-h-row"><h3>Выручка за ${month.slice(0, 7)} (ручной ввод)</h3>
          <button class="btn btn-primary btn-sm" id="finRevSave">Сохранить выручку</button></div>
        <p class="muted" style="margin-bottom:14px">Введите грязную выручку по салонам за месяц. Используется ИИ-аналитиком для расчёта доли расходов.</p>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Салон</th><th class="r">Выручка (с.)</th></tr></thead>
          <tbody>
            <tr><td class="strong">Вся сеть (общая)</td>
              <td class="r"><input type="number" class="fin-rev-inp" data-wh="net" min="0" step="0.01" value="${netTotal || ''}" placeholder="0.00"></td></tr>
            ${rows}
          </tbody>
        </table></div>
        <div id="finRevMsg" style="margin-top:12px"></div>
      </div>`;
    $('finRevSave').addEventListener('click', async () => {
      const msg = $('finRevMsg');
      msg.innerHTML = `<div class="muted">Сохраняю…</div>`;
      try {
        const inputs = Array.from(host.querySelectorAll('.fin-rev-inp'));
        for (const inp of inputs) {
          const val = inp.value.trim();
          if (val === '') continue;
          const amount = parseFloat(val);
          if (!(amount >= 0)) continue;
          const wh = inp.dataset.wh;
          await posApi('?action=fin-revenue-set', { method: 'POST', body: JSON.stringify({
            period_month: month, warehouse_id: wh === 'net' ? null : wh, amount,
          }) });
        }
        msg.innerHTML = `<div class="fin-ok">✓ Выручка сохранена</div>`;
      } catch (e) { msg.innerHTML = errBar('Не удалось сохранить: ' + (e.message || e)); }
    });
  } catch (e) {
    host.innerHTML = errBar('Не удалось загрузить выручку: ' + (e.message || e));
  }
}

// ————— Экспорт CSV —————
function finExportCsv() {
  const arr = finFiltered();
  if (!arr.length) { alert('Нет данных для экспорта'); return; }
  const head = ['Дата','Тип','Категория','Название','Магазин','Сумма','Комментарий'];
  const lines = [head.join(';')];
  for (const e of arr) {
    const row = [
      finExpDate(e).slice(0, 10),
      finKindLabel(e.kind),
      (finCatName(e.category_id) || ''),
      (e.title || ''),
      (e.warehouse_id ? finSalonName(e.warehouse_id) : finOwnerLabel(e.owner_type)),
      (+e.amount || 0).toFixed(2),
      (e.comment || ''),
    ].map(x => `"${String(x).replace(/"/g, '""')}"`);
    lines.push(row.join(';'));
  }
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `rashody_${(FIN._from||'').slice(0,7)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}



// ══════════════════════════════════════════════════════════
//  РАСШИРЕНИЕ «Выручка-Расходы»: Обзор · Поставщики · Сотрудники
// ══════════════════════════════════════════════════════════

const FIN_COUNTRY_LABEL = { turkey: '🇹🇷 Турция', china: '🇨🇳 Китай', uzbekistan: '🇺🇿 Узбекистан', tajikistan: '🇹🇯 Таджикистан' };
const FIN_SALARY_LABEL = {
  fixed_per_salon: 'Оклад по салонам',
  percent_network: '% от выручки сети',
  salary_plus_personal_percent: 'Оклад + % личных продаж',
};

// ————————————————————————————————————————————————
//  ОБЗОР: 5 KPI + Финансовый результат + Выручка по магазинам + график
// ————————————————————————————————————————————————
async function finPaintOverview() {
  const host = $('finSubBody');
  host.innerHTML = `<div class="loading">⏳ Считаю финансовый результат…</div>`;
  try {
    const from = FIN._from, to = FIN._to;
    const d = await posApi(`?action=fin-profit&from=${from}&to=${to}`, { method: 'GET' });
    FIN.profit = d;
    const s = d.summary;
    const bySalon = d.by_salon || [];
    const prorated = d.range && d.range.prorated;

    // 5 KPI: Выручка / Постоянные / Переменные / Зарплаты / Чистая прибыль
    const profitTone = s.net_profit >= 0 ? 'green' : 'red';
    const kpiRow = `
      <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:14px">
        ${kpi('💰','Выручка (из 1С)', money(s.revenue),'green', 'чистая, продажи − возвраты')}
        ${kpi('📌','Постоянные расходы', money(s.expenses_fixed),'amber', 'аренда, оклады и т.д.')}
        ${kpi('🧾','Переменные расходы', money(s.expenses_variable),'amber', 'закуп, логистика и т.д.')}
        ${kpi('👥','Зарплаты', money(s.payroll_total),'blue', `оклад ${fmtInt(s.payroll_oklad)} + % ${fmtInt(s.payroll_percent)}`)}
        ${kpi(s.net_profit>=0?'📈':'📉','Чистая прибыль', money(s.net_profit), profitTone, s.net_profit>=0?'прибыль за период':'убыток за период')}
      </div>`;

    // Финансовый результат — прозрачная расшифровка формулы
    const line = (label, val, sign, strong) => {
      const cls = sign < 0 ? 'fin-fr-minus' : (sign > 0 ? 'fin-fr-plus' : '');
      const pref = sign < 0 ? '− ' : (sign > 0 ? '' : '');
      return `<div class="fin-fr-row ${strong ? 'fin-fr-strong' : ''}">
        <span class="fin-fr-lbl">${label}</span>
        <span class="fin-fr-val ${cls}">${pref}${money(Math.abs(val))}</span></div>`;
    };
    const frBlock = `
      <div class="card card-pad" style="margin-bottom:14px">
        <h3 class="fin-h3">Финансовый результат ${prorated ? '<span class="fin-note">(пропорц. дням периода)</span>' : ''}</h3>
        <div class="fin-fr">
          ${line('Выручка (net из 1С)', s.revenue, 1, false)}
          ${line(`Себестоимость товара (${Math.round(s.cogs_rate*100)}%)`, s.cogs, -1, false)}
          ${line('Постоянные расходы', s.expenses_fixed, -1, false)}
          ${line('Переменные расходы', s.expenses_variable, -1, false)}
          ${line('Выплаты поставщикам', s.supplier_payments, -1, false)}
          ${line('Зарплаты (оклад + %)', s.payroll_total, -1, false)}
          <div class="fin-fr-sep"></div>
          ${line('ЧИСТАЯ ПРИБЫЛЬ', s.net_profit, s.net_profit>=0?1:-1, true)}
        </div>
        <p class="fin-note" style="margin-top:8px">Закупки у поставщиков в долг прибыль не уменьшают — учитываются только фактические выплаты (кассовый метод). Справочно за период добавлено долга: <b>${money(s.supplier_new_debt)}</b>.</p>
      </div>`;

    // Выручка по магазинам
    const maxRev = Math.max(1, ...bySalon.map(r => r.revenue));
    const salonRows = bySalon.map(r => `
      <tr>
        <td>${esc(r.name)}</td>
        <td class="num">${money(r.revenue)}</td>
        <td class="num">${money(r.expenses)}</td>
        <td class="num"><b class="${r.profit>=0?'fin-fr-plus':'fin-fr-minus'}">${money(r.profit)}</b></td>
        <td style="width:120px"><div class="fin-bar-bg"><div class="fin-bar-fill" style="width:${Math.round(r.revenue/maxRev*100)}%"></div></div></td>
      </tr>`).join('');
    const salonBlock = `
      <div class="card card-pad" style="margin-bottom:14px">
        <h3 class="fin-h3">Выручка по магазинам</h3>
        <table class="tbl fin-tbl">
          <thead><tr><th>Магазин</th><th class="num">Выручка</th><th class="num">Постоянные расходы</th><th class="num">Прибыль</th><th></th></tr></thead>
          <tbody>${salonRows || '<tr><td colspan="5" class="muted">Нет данных</td></tr>'}</tbody>
        </table>
        <p class="fin-note">Прибыль салона = выручка − (собственные постоянные + доля общих постоянных пропорц. выручке). Без себестоимости, зарплат-% и выплат поставщикам — они считаются по сети.</p>
      </div>`;

    // График динамики: выручка / расходы / чистая прибыль по дням
    const trendBlock = `
      <div class="card card-pad">
        <h3 class="fin-h3">Динамика за период</h3>
        <div style="position:relative;height:280px"><canvas id="finOverviewTrend"></canvas></div>
      </div>`;

    host.innerHTML = kpiRow + frBlock + salonBlock + trendBlock;
    finDrawOverviewTrend('finOverviewTrend', from, to);
  } catch (e) {
    host.innerHTML = errBar('Не удалось посчитать обзор: ' + (e.message || e));
  }
}

// График: 3 линии (выручка/расходы/чистая прибыль) по дням периода.
async function finDrawOverviewTrend(canvasId, from, to) {
  const el = $(canvasId); if (!el) return;
  destroyChart(canvasId);
  try {
    // Выручка по дням из 1С (через отдельный публичный проект — читаем на бэке нельзя по дням, берём агрегат).
    // Простая версия: расходы по дням (shop_expenses.expense_date) + выручка распределяем равномерно.
    const s = FIN.profit ? FIN.profit.summary : null;
    const days = [];
    for (let t = new Date(from + 'T00:00:00Z'); t.toISOString().slice(0,10) <= to; t = new Date(t.getTime() + 86400000)) days.push(t.toISOString().slice(0,10));
    if (!days.length) return;
    // расходы по дням
    const byDayExp = new Map();
    for (const e of (FIN.expenses || [])) {
      const dd = (e.expense_date || (e.period_month||'')).slice(0,10);
      if (dd) byDayExp.set(dd, (byDayExp.get(dd)||0) + (+e.amount||0));
    }
    const n = days.length;
    const revPerDay = s ? s.revenue / n : 0;
    const cogsPerDay = s ? s.cogs / n : 0;
    const supPerDay = s ? s.supplier_payments / n : 0;
    const payrollPerDay = s ? s.payroll_total / n : 0;
    const revArr = days.map(() => Math.round(revPerDay));
    const expArr = days.map(dd => Math.round((byDayExp.get(dd)||0) + cogsPerDay + supPerDay + payrollPerDay));
    const profitArr = days.map((dd,i) => revArr[i] - expArr[i]);
    state.charts[canvasId] = new Chart(el, {
      type: 'line',
      data: {
        labels: days.map(d => d.slice(5)),
        datasets: [
          { label: 'Выручка', data: revArr, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,.10)', fill: true, tension: .3, pointRadius: 2 },
          { label: 'Расходы', data: expArr, borderColor: '#e11d48', backgroundColor: 'rgba(225,29,72,.06)', fill: false, tension: .3, pointRadius: 2 },
          { label: 'Чистая прибыль', data: profitArr, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.06)', fill: false, tension: .3, pointRadius: 2, borderDash: [5,3] },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true, position: 'top' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtNum(c.parsed.y)} с.` } } },
        scales: { y: { ticks: { callback: v => fmtInt(v) } } } },
    });
  } catch (e) { /* график необязателен */ }
}

// ————————————————————————————————————————————————
//  ДОЛГИ ПОСТАВЩИКАМ
// ————————————————————————————————————————————————
async function finPaintSuppliers() {
  const host = $('finSubBody');
  host.innerHTML = `<div class="loading">⏳ Загружаю поставщиков…</div>`;
  try {
    const [supR, fxR] = await Promise.all([
      posApi('?action=fin-suppliers&all=1', { method: 'GET' }),
      posApi('?action=fin-fx', { method: 'GET' }),
    ]);
    FIN.suppliers = supR.suppliers || [];
    FIN.fx = fxR.rates || {};

    const sups = FIN.suppliers;
    const totalDebt = sups.reduce((s, x) => s + (+x.debt_tjs || 0), 0);
    const activeCnt = sups.filter(x => x.is_active).length;
    const usd = FIN.fx.USD, cny = FIN.fx.CNY;

    const fxLine = `
      <div class="fin-fx-bar">
        <span class="fin-fx-item">💵 USD: <b>${usd ? fmtNum(usd.rate) : '—'}</b> с. <span class="fin-note">${usd ? usd.date : ''}</span></span>
        <span class="fin-fx-item">💴 CNY: <b>${cny ? fmtNum(cny.rate) : '—'}</b> с. <span class="fin-note">${cny ? cny.date : ''}</span></span>
        <button class="btn btn-ghost btn-sm" id="finFxRefresh">↻ Обновить курс (Алиф)</button>
        <button class="btn btn-ghost btn-sm" id="finFxManual">✎ Ввести вручную</button>
      </div>`;

    const rows = sups.map(x => {
      const debtCls = x.debt_tjs > 0.5 ? 'fin-debt-yes' : (x.debt_tjs < -0.5 ? 'fin-debt-over' : 'fin-debt-zero');
      const foreign = x.currency !== 'TJS' && Math.abs(x.debt_foreign) > 0.01 ? ` <span class="fin-note">(${fmtNum(x.debt_foreign)} ${x.currency})</span>` : '';
      return `<tr data-sup="${x.id}">
        <td>${x.photo_url ? `<img class="fin-sup-ph" src="${esc(x.photo_url)}" alt="">` : '<span class="fin-sup-ph fin-sup-ph-empty">🏷</span>'}</td>
        <td><b>${esc(x.name)}</b>${x.is_active ? '' : ' <span class="badge off">архив</span>'}</td>
        <td>${FIN_COUNTRY_LABEL[x.country] || x.country}</td>
        <td>${x.currency}</td>
        <td class="num"><b class="${debtCls}">${money(x.debt_tjs)}</b>${foreign}</td>
        <td class="fin-actions">
          <button class="btn btn-ghost btn-xs fin-sup-ops" data-id="${x.id}">Операции</button>
          <button class="btn btn-ghost btn-xs fin-sup-pay" data-id="${x.id}">＋ Выплата</button>
          <button class="btn btn-ghost btn-xs fin-sup-buy" data-id="${x.id}">＋ Закуп</button>
          <button class="btn btn-ghost btn-xs fin-sup-edit" data-id="${x.id}">✎</button>
        </td>
      </tr>`;
    }).join('');

    host.innerHTML = `
      ${fxLine}
      <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-bottom:14px">
        ${kpi('🏷','Всего поставщиков', String(sups.length), 'blue', `${activeCnt} активных`)}
        ${kpi('💳','Общий долг', money(totalDebt), totalDebt>0?'red':'green', 'сумма долгов в сомони')}
      </div>
      <div class="card card-pad">
        <div class="fin-sec-head">
          <h3 class="fin-h3">Поставщики и долги</h3>
          <button class="btn btn-primary btn-sm" id="finSupAdd">＋ Поставщик</button>
        </div>
        <table class="tbl fin-tbl">
          <thead><tr><th></th><th>Поставщик</th><th>Страна</th><th>Валюта</th><th class="num">Долг</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" class="muted">Нет поставщиков</td></tr>'}</tbody>
        </table>
        <p class="fin-note">Долг = сумма закупок − сумма выплат. Красный — мы должны; зелёный — переплата/аванс.</p>
      </div>
      <div id="finSupModal"></div>`;

    // события
    $('finSupAdd').addEventListener('click', () => finSupForm(null));
    $('finFxRefresh').addEventListener('click', finFxRefresh);
    $('finFxManual').addEventListener('click', finFxManualForm);
    host.querySelectorAll('.fin-sup-edit').forEach(b => b.addEventListener('click', () => finSupForm(b.dataset.id)));
    host.querySelectorAll('.fin-sup-ops').forEach(b => b.addEventListener('click', () => finSupOps(b.dataset.id)));
    host.querySelectorAll('.fin-sup-pay').forEach(b => b.addEventListener('click', () => finSupOpForm(b.dataset.id, 'payment')));
    host.querySelectorAll('.fin-sup-buy').forEach(b => b.addEventListener('click', () => finSupOpForm(b.dataset.id, 'purchase')));
  } catch (e) {
    host.innerHTML = errBar('Не удалось загрузить поставщиков: ' + (e.message || e));
  }
}

function finSupById(id) { return (FIN.suppliers || []).find(x => x.id === id); }

// модалка: создание/редактирование поставщика
function finSupForm(id) {
  const sup = id ? finSupById(id) : null;
  const m = $('finSupModal');
  const cOpts = Object.keys(FIN_COUNTRY_LABEL).map(c => `<option value="${c}" ${sup && sup.country===c?'selected':''}>${FIN_COUNTRY_LABEL[c]}</option>`).join('');
  m.innerHTML = `
    <div class="fin-modal-bg" id="finSupModalBg">
      <div class="fin-modal">
        <div class="fin-modal-head"><h3>${sup ? 'Редактировать поставщика' : 'Новый поставщик'}</h3><button class="fin-modal-x" id="finSupClose">✕</button></div>
        <div class="fin-modal-body">
          <label class="fld"><span>Название</span><input id="fsName" value="${sup ? esc(sup.name) : ''}" placeholder="Напр. Forelli"></label>
          <label class="fld"><span>Страна</span><select id="fsCountry">${cOpts}</select></label>
          <label class="fld"><span>Валюта</span><select id="fsCur">
            <option value="USD" ${sup&&sup.currency==='USD'?'selected':''}>USD</option>
            <option value="CNY" ${sup&&sup.currency==='CNY'?'selected':''}>CNY</option>
            <option value="TJS" ${sup&&sup.currency==='TJS'?'selected':''}>TJS (сомони)</option>
          </select></label>
          <label class="fld"><span>Фото (URL, необязательно)</span><input id="fsPhoto" value="${sup && sup.photo_url ? esc(sup.photo_url) : ''}" placeholder="https://…"></label>
          ${sup ? '' : `<label class="fld"><span>Начальный долг (в валюте, необязательно)</span><input id="fsDebt" type="number" step="0.01" placeholder="0"></label>`}
          ${sup ? `<label class="fld fld-check"><input type="checkbox" id="fsActive" ${sup.is_active?'checked':''}> Активен</label>` : ''}
        </div>
        <div class="fin-modal-foot">
          ${sup ? `<button class="btn btn-ghost btn-sm fin-btn-danger" id="fsDelete">Удалить</button>` : '<span></span>'}
          <div><button class="btn btn-ghost btn-sm" id="fsCancel">Отмена</button>
          <button class="btn btn-primary btn-sm" id="fsSave">Сохранить</button></div>
        </div>
        <div id="fsMsg"></div>
      </div>
    </div>`;
  const close = () => { m.innerHTML = ''; };
  $('finSupClose').addEventListener('click', close);
  $('fsCancel').addEventListener('click', close);
  $('finSupModalBg').addEventListener('click', e => { if (e.target.id === 'finSupModalBg') close(); });
  // при смене страны — подставим валюту по умолчанию
  $('fsCountry').addEventListener('change', () => {
    const def = { turkey:'USD', china:'CNY', uzbekistan:'TJS', tajikistan:'TJS' }[$('fsCountry').value];
    if (def) $('fsCur').value = def;
  });
  if ($('fsDelete')) $('fsDelete').addEventListener('click', async () => {
    if (!confirm('Удалить поставщика вместе со всеми операциями?')) return;
    try { await posApi('?action=fin-supplier-delete', { method:'POST', body: JSON.stringify({ id }) }); close(); finPaintSuppliers(); }
    catch (e) { $('fsMsg').innerHTML = errBar(e.message||e); }
  });
  $('fsSave').addEventListener('click', async () => {
    const body = {
      name: $('fsName').value.trim(),
      country: $('fsCountry').value,
      currency: $('fsCur').value,
      photo_url: $('fsPhoto').value.trim() || null,
    };
    if (!body.name) { $('fsMsg').innerHTML = errBar('Укажите название'); return; }
    try {
      if (sup) {
        body.id = id; body.is_active = $('fsActive').checked;
        await posApi('?action=fin-supplier-update', { method:'POST', body: JSON.stringify(body) });
      } else {
        const dv = parseFloat($('fsDebt') ? $('fsDebt').value : '');
        if (dv > 0) body.initial_debt = dv;
        await posApi('?action=fin-supplier-create', { method:'POST', body: JSON.stringify(body) });
      }
      close(); finPaintSuppliers();
    } catch (e) { $('fsMsg').innerHTML = errBar(e.message||e); }
  });
}

// модалка: операция (закуп/выплата)
function finSupOpForm(id, type) {
  const sup = finSupById(id); if (!sup) return;
  const m = $('finSupModal');
  const isPay = type === 'payment';
  const foreignCur = sup.currency;
  const canPayTjs = foreignCur !== 'TJS' && isPay;
  const rate = FIN.fx && FIN.fx[foreignCur] ? FIN.fx[foreignCur].rate : '';
  m.innerHTML = `
    <div class="fin-modal-bg" id="finSupOpBg">
      <div class="fin-modal">
        <div class="fin-modal-head"><h3>${isPay?'Выплата':'Закуп'} — ${esc(sup.name)}</h3><button class="fin-modal-x" id="finOpClose">✕</button></div>
        <div class="fin-modal-body">
          ${canPayTjs ? `<label class="fld fld-check"><input type="checkbox" id="foTjs"> Выплата в сомони (TJS)</label>` : ''}
          <label class="fld"><span>Сумма <span id="foCurLbl">(${foreignCur})</span></span><input id="foAmount" type="number" step="0.01" placeholder="0"></label>
          <div id="foRateWrap" style="display:${foreignCur!=='TJS'?'block':'none'}"><label class="fld"><span>Курс ${foreignCur}→TJS</span><input id="foRate" type="number" step="0.0001" value="${rate}"></label></div>
          <label class="fld"><span>Дата</span><input id="foDate" type="date" value="${dushToday()}"></label>
          <label class="fld"><span>Комментарий</span><input id="foComment" placeholder="необязательно"></label>
        </div>
        <div class="fin-modal-foot"><span></span><div>
          <button class="btn btn-ghost btn-sm" id="foCancel">Отмена</button>
          <button class="btn btn-primary btn-sm" id="foSave">Сохранить</button></div></div>
        <div id="foMsg"></div>
      </div>
    </div>`;
  const close = () => { m.innerHTML = ''; };
  $('finOpClose').addEventListener('click', close);
  $('foCancel').addEventListener('click', close);
  $('finSupOpBg').addEventListener('click', e => { if (e.target.id === 'finSupOpBg') close(); });
  if ($('foTjs')) $('foTjs').addEventListener('change', () => {
    const tjs = $('foTjs').checked;
    $('foCurLbl').textContent = tjs ? '(сомони)' : `(${foreignCur})`;
    $('foRateWrap').style.display = tjs ? 'block' : (foreignCur!=='TJS'?'block':'none');
  });
  $('foSave').addEventListener('click', async () => {
    const amount = parseFloat($('foAmount').value);
    if (!(amount >= 0)) { $('foMsg').innerHTML = errBar('Укажите сумму'); return; }
    const body = { supplier_id: id, type, amount_foreign: amount, operation_date: $('foDate').value, comment: $('foComment').value.trim() || null };
    if ($('foTjs') && $('foTjs').checked) body.payment_currency = 'TJS';
    if ($('foRate') && $('foRate').value) body.fx_rate = parseFloat($('foRate').value);
    try { await posApi('?action=fin-supplier-op-create', { method:'POST', body: JSON.stringify(body) }); close(); finPaintSuppliers(); }
    catch (e) { $('foMsg').innerHTML = errBar(e.message||e); }
  });
}

// модалка: история операций поставщика
async function finSupOps(id) {
  const sup = finSupById(id); if (!sup) return;
  const m = $('finSupModal');
  m.innerHTML = `<div class="fin-modal-bg" id="finOpsBg"><div class="fin-modal fin-modal-wide"><div class="fin-modal-head"><h3>Операции — ${esc(sup.name)}</h3><button class="fin-modal-x" id="finOpsClose">✕</button></div><div class="fin-modal-body"><div class="loading">⏳ Загружаю…</div></div></div></div>`;
  const close = () => { m.innerHTML = ''; };
  $('finOpsClose').addEventListener('click', close);
  $('finOpsBg').addEventListener('click', e => { if (e.target.id === 'finOpsBg') close(); });
  try {
    const d = await posApi(`?action=fin-supplier-ops&supplier_id=${id}`, { method:'GET' });
    const ops = d.operations || [];
    const rows = ops.map(o => `<tr>
      <td>${(o.operation_date||'').slice(0,10)}</td>
      <td>${o.type==='payment'?'<span class="fin-fr-minus">Выплата</span>':'<span class="fin-fr-plus">Закуп</span>'}</td>
      <td class="num">${fmtNum(o.amount_foreign)} ${sup.currency}</td>
      <td class="num">${money(o.amount_tjs)}</td>
      <td class="fin-note">${esc(o.comment||'')}</td>
      <td><button class="btn btn-ghost btn-xs fin-op-del" data-id="${o.id}">✕</button></td>
    </tr>`).join('');
    m.querySelector('.fin-modal-body').innerHTML = `
      <table class="tbl fin-tbl"><thead><tr><th>Дата</th><th>Тип</th><th class="num">Валюта</th><th class="num">Сомони</th><th>Комментарий</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="muted">Нет операций</td></tr>'}</tbody></table>`;
    m.querySelectorAll('.fin-op-del').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Удалить операцию?')) return;
      try { await posApi('?action=fin-supplier-op-delete', { method:'POST', body: JSON.stringify({ id: b.dataset.id }) }); finSupOps(id); FIN.suppliers=null; }
      catch (e) { alert(e.message||e); }
    }));
  } catch (e) { m.querySelector('.fin-modal-body').innerHTML = errBar(e.message||e); }
}

async function finFxRefresh() {
  const btn = $('finFxRefresh'); if (btn) { btn.disabled = true; btn.textContent = '↻ Обновляю…'; }
  try { await posApi('?action=fin-fx-refresh', { method:'POST', body: '{}' }); finPaintSuppliers(); }
  catch (e) { alert('Не удалось обновить курс: ' + (e.message||e)); if (btn){btn.disabled=false;btn.textContent='↻ Обновить курс (Алиф)';} }
}

function finFxManualForm() {
  const m = $('finSupModal');
  const usd = FIN.fx && FIN.fx.USD ? FIN.fx.USD.rate : '';
  const cny = FIN.fx && FIN.fx.CNY ? FIN.fx.CNY.rate : '';
  m.innerHTML = `<div class="fin-modal-bg" id="finFxBg"><div class="fin-modal"><div class="fin-modal-head"><h3>Курс валют (вручную)</h3><button class="fin-modal-x" id="finFxClose">✕</button></div>
    <div class="fin-modal-body">
      <label class="fld"><span>USD → TJS</span><input id="fxUsd" type="number" step="0.0001" value="${usd}"></label>
      <label class="fld"><span>CNY → TJS</span><input id="fxCny" type="number" step="0.0001" value="${cny}"></label>
    </div>
    <div class="fin-modal-foot"><span></span><div><button class="btn btn-ghost btn-sm" id="fxCancel">Отмена</button><button class="btn btn-primary btn-sm" id="fxSave">Сохранить</button></div></div>
    <div id="fxMsg"></div></div></div>`;
  const close = () => { m.innerHTML = ''; };
  $('finFxClose').addEventListener('click', close);
  $('fxCancel').addEventListener('click', close);
  $('finFxBg').addEventListener('click', e => { if (e.target.id === 'finFxBg') close(); });
  $('fxSave').addEventListener('click', async () => {
    const body = {};
    if ($('fxUsd').value) body.USD = parseFloat($('fxUsd').value);
    if ($('fxCny').value) body.CNY = parseFloat($('fxCny').value);
    try { await posApi('?action=fin-fx-set', { method:'POST', body: JSON.stringify(body) }); close(); finPaintSuppliers(); }
    catch (e) { $('fxMsg').innerHTML = errBar(e.message||e); }
  });
}

// ————————————————————————————————————————————————
//  СОТРУДНИКИ И ЗАРПЛАТЫ
// ————————————————————————————————————————————————
async function finPaintEmployees() {
  const host = $('finSubBody');
  host.innerHTML = `<div class="loading">⏳ Загружаю сотрудников…</div>`;
  try {
    const d = await posApi('?action=fin-employees', { method:'GET' });
    FIN.employees = d.employees || [];
    const emps = FIN.employees;
    const active = emps.filter(e => e.status !== 'dismissed');
    const okladTotal = active.reduce((s, e) => s + (e.salaries||[]).reduce((a,x)=>a+(+x.amount||0),0), 0);

    const rows = emps.map(e => {
      const oklad = (e.salaries||[]).reduce((a,x)=>a+(+x.amount||0),0);
      const salByShop = (e.salaries||[]).map(x => `${x.warehouse_id?finSalonName(x.warehouse_id):'Офис/сеть'}: ${fmtInt(x.amount)}`).join(', ');
      const dism = e.status === 'dismissed';
      return `<tr class="${dism?'fin-emp-dism':''}">
        <td><b>${esc(e.full_name)}</b>${dism?' <span class="badge off">уволен</span>':''}<div class="fin-note">${esc(e.position||'')}</div></td>
        <td>${FIN_SALARY_LABEL[e.salary_type]||e.salary_type}${e.percent_rate?` <b>${fmtNum(e.percent_rate)}%</b>`:''}</td>
        <td class="num"><b>${fmtInt(oklad)}</b> <span class="cur">с.</span><div class="fin-note">${esc(salByShop)}</div></td>
        <td class="fin-actions">
          <button class="btn btn-ghost btn-xs fin-emp-sal" data-id="${e.id}">Оклады</button>
          <button class="btn btn-ghost btn-xs fin-emp-edit" data-id="${e.id}">✎</button>
        </td>
      </tr>`;
    }).join('');

    host.innerHTML = `
      <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-bottom:14px">
        ${kpi('👥','Сотрудников', String(active.length), 'blue', `${emps.length} всего с уволенными`)}
        ${kpi('💵','Фонд окладов', money(okladTotal), 'amber', 'сумма окладов в месяц')}
      </div>
      <div class="card card-pad">
        <div class="fin-sec-head"><h3 class="fin-h3">Сотрудники</h3><button class="btn btn-primary btn-sm" id="finEmpAdd">＋ Сотрудник</button></div>
        <table class="tbl fin-tbl">
          <thead><tr><th>Сотрудник</th><th>Тип оплаты</th><th class="num">Оклад / мес</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" class="muted">Нет сотрудников</td></tr>'}</tbody>
        </table>
        <p class="fin-note">Зарплата = оклад (по салонам) + % от продаж. «% от выручки сети» — от общей net-выручки; «Оклад + % личных продаж» — от личных продаж сотрудника.</p>
      </div>
      <div id="finEmpModal"></div>`;

    $('finEmpAdd').addEventListener('click', () => finEmpForm(null));
    host.querySelectorAll('.fin-emp-edit').forEach(b => b.addEventListener('click', () => finEmpForm(b.dataset.id)));
    host.querySelectorAll('.fin-emp-sal').forEach(b => b.addEventListener('click', () => finEmpSalaries(b.dataset.id)));
  } catch (e) {
    host.innerHTML = errBar('Не удалось загрузить сотрудников: ' + (e.message || e));
  }
}

function finEmpById(id) { return (FIN.employees || []).find(e => e.id === id); }

function finEmpForm(id) {
  const emp = id ? finEmpById(id) : null;
  const m = $('finEmpModal');
  const stOpts = Object.keys(FIN_SALARY_LABEL).map(k => `<option value="${k}" ${emp&&emp.salary_type===k?'selected':''}>${FIN_SALARY_LABEL[k]}</option>`).join('');
  m.innerHTML = `
    <div class="fin-modal-bg" id="finEmpBg"><div class="fin-modal">
      <div class="fin-modal-head"><h3>${emp?'Редактировать':'Новый сотрудник'}</h3><button class="fin-modal-x" id="finEmpClose">✕</button></div>
      <div class="fin-modal-body">
        <label class="fld"><span>ФИО</span><input id="feName" value="${emp?esc(emp.full_name):''}"></label>
        <label class="fld"><span>Должность</span><input id="fePos" value="${emp&&emp.position?esc(emp.position):''}"></label>
        <label class="fld"><span>Тип оплаты</span><select id="feType">${stOpts}</select></label>
        <label class="fld"><span>% от продаж (если применимо)</span><input id="feRate" type="number" step="0.1" value="${emp&&emp.percent_rate?emp.percent_rate:''}" placeholder="0"></label>
        <label class="fld"><span>Кошелёк / карта</span><input id="feWallet" value="${emp&&emp.wallet?esc(emp.wallet):''}"></label>
        <label class="fld"><span>Телефон</span><input id="fePhone" value="${emp&&emp.phone?esc(emp.phone):''}"></label>
        ${emp?`<label class="fld"><span>Статус</span><select id="feStatus"><option value="active" ${emp.status!=='dismissed'?'selected':''}>Активен</option><option value="dismissed" ${emp.status==='dismissed'?'selected':''}>Уволен</option></select></label>`:''}
      </div>
      <div class="fin-modal-foot">
        ${emp?`<button class="btn btn-ghost btn-sm fin-btn-danger" id="feDelete">Удалить</button>`:'<span></span>'}
        <div><button class="btn btn-ghost btn-sm" id="feCancel">Отмена</button><button class="btn btn-primary btn-sm" id="feSave">Сохранить</button></div>
      </div><div id="feMsg"></div>
    </div></div>`;
  const close = () => { m.innerHTML = ''; };
  $('finEmpClose').addEventListener('click', close);
  $('feCancel').addEventListener('click', close);
  $('finEmpBg').addEventListener('click', e => { if (e.target.id === 'finEmpBg') close(); });
  if ($('feDelete')) $('feDelete').addEventListener('click', async () => {
    if (!confirm('Удалить сотрудника?')) return;
    try { await posApi('?action=fin-employee-delete', { method:'POST', body: JSON.stringify({ id }) }); close(); finPaintEmployees(); }
    catch (e) { $('feMsg').innerHTML = errBar(e.message||e); }
  });
  $('feSave').addEventListener('click', async () => {
    const body = {
      full_name: $('feName').value.trim(), position: $('fePos').value.trim() || null,
      salary_type: $('feType').value, percent_rate: parseFloat($('feRate').value) || 0,
      wallet: $('feWallet').value.trim() || null, phone: $('fePhone').value.trim() || null,
    };
    if (!body.full_name) { $('feMsg').innerHTML = errBar('Укажите ФИО'); return; }
    try {
      if (emp) { body.id = id; body.status = $('feStatus').value; await posApi('?action=fin-employee-update', { method:'POST', body: JSON.stringify(body) }); }
      else await posApi('?action=fin-employee-create', { method:'POST', body: JSON.stringify(body) });
      close(); finPaintEmployees();
    } catch (e) { $('feMsg').innerHTML = errBar(e.message||e); }
  });
}

// модалка: оклады по салонам
function finEmpSalaries(id) {
  const emp = finEmpById(id); if (!emp) return;
  const m = $('finEmpModal');
  const salMap = {}; for (const s of (emp.salaries||[])) salMap[s.warehouse_id||'net'] = s.amount;
  const salonRows = FIN.salons.map(s => `
    <label class="fld fld-inline"><span>${esc(s.name)}</span><input class="fin-sal-inp" data-wh="${s.warehouse_id}" type="number" step="0.01" value="${salMap[s.warehouse_id]||''}" placeholder="0"></label>`).join('');
  m.innerHTML = `
    <div class="fin-modal-bg" id="finSalBg"><div class="fin-modal">
      <div class="fin-modal-head"><h3>Оклады — ${esc(emp.full_name)}</h3><button class="fin-modal-x" id="finSalClose">✕</button></div>
      <div class="fin-modal-body">
        <p class="fin-note">Оклад по каждому салону, где работает сотрудник. Пусто/0 — оклада нет.</p>
        ${salonRows}
        <label class="fld fld-inline"><span>Офис / сеть (без салона)</span><input class="fin-sal-inp" data-wh="net" type="number" step="0.01" value="${salMap['net']||''}" placeholder="0"></label>
      </div>
      <div class="fin-modal-foot"><span></span><div><button class="btn btn-ghost btn-sm" id="fsalCancel">Отмена</button><button class="btn btn-primary btn-sm" id="fsalSave">Сохранить</button></div></div>
      <div id="fsalMsg"></div>
    </div></div>`;
  const close = () => { m.innerHTML = ''; };
  $('finSalClose').addEventListener('click', close);
  $('fsalCancel').addEventListener('click', close);
  $('finSalBg').addEventListener('click', e => { if (e.target.id === 'finSalBg') close(); });
  $('fsalSave').addEventListener('click', async () => {
    const msg = $('fsalMsg'); msg.innerHTML = '<div class="muted">Сохраняю…</div>';
    try {
      for (const inp of m.querySelectorAll('.fin-sal-inp')) {
        const wh = inp.dataset.wh;
        const raw = inp.value.trim();
        const amount = raw === '' ? 0 : parseFloat(raw);
        if (!(amount >= 0)) continue;
        await posApi('?action=fin-employee-salary-set', { method:'POST', body: JSON.stringify({ employee_id: id, warehouse_id: wh === 'net' ? null : wh, amount }) });
      }
      close(); finPaintEmployees();
    } catch (e) { msg.innerHTML = errBar(e.message||e); }
  });
}

// ══════════════════════════════════════════════════════════
//  СТАРТ
// ══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initLogin();
  if (tryRestoreAuth()) enterApp();
});
