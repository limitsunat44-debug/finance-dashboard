// ═══════════════════════════════════════════════════════════════
// OrtoSalon Dashboard - Supabase Edition
// ═══════════════════════════════════════════════════════════════

// Global variables
let currentUser = null;
let appData = {
    sales: [],
    expenses: [],
    employees: [],
    salaryPayments: [],
    suppliers: [],
    supplierPayments: [],
    purchases: [],
    auditLog: [],
    exchangeRate: 10.50 // 1 USD = X TJS - МОЖНО МЕНЯТЬ ЗДЕСЬ
};

// ═══════════════════════════════════════════════════════════════
// SUPABASE CONFIGURATION
// ═══════════════════════════════════════════════════════════════
const SUPABASE_URL = 'https://jyhlrjrrmemttyvicibq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5aGxyanJybWVtdHR5dmljaWJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEzNjk2NjgsImV4cCI6MjA3Njk0NTY2OH0.XrkLM9jFmnnGQMkU2dxy286gzdYE43QdMzBj3Z4Ig7s';

// Инициализация Supabase клиента
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ───────────────────────────────────────────────────────────────
// ВТОРОЙ Supabase-клиент — база ОРТОБОТ (товарные остатки), только чтение.
// Отдельный проект, не пересекается с finance-dashboard клиентом выше.
// anon-ключ публичный, доступ защищён RLS-политиками на стороне базы.
// ───────────────────────────────────────────────────────────────
const ORTOBOT_SUPABASE_URL = 'https://qgucitzmrpwgsmtygtfs.supabase.co';
const ORTOBOT_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFndWNpdHptcnB3Z3NtdHlndGZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNjg2OTYsImV4cCI6MjA5NTY0NDY5Nn0.DJ9aLEB9ZTaMCp-nOJz3rpJBsd75r8e-KnnMS59eAAg';
const ortobotClient = supabase.createClient(ORTOBOT_SUPABASE_URL, ORTOBOT_SUPABASE_KEY);

// Sync management variables
let saveQueue = [];
let isSaving = false;
let lastSaveTime = 0;
let saveTimeout = null;
const SAVE_DEBOUNCE_DELAY = 2000; // 2 секунды задержки
const MIN_SAVE_INTERVAL = 1000; // Минимум 1 секунда между сохранениями
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // Экспоненциальная задержка

// Admin accounts
// allowedTabs: '*' или отсутствие поля = полный доступ ко всем вкладкам.
// Иначе — массив id вкладок (data-tab), доступных пользователю.
const ADMIN_ACCOUNTS = {
    'Sunnat': { password: 'Sunna0909', displayName: 'Sunnat', allowedTabs: '*' },
    'Iskandar': { password: '1111', displayName: 'Iskandar', allowedTabs: '*' },
    'Shahida': { password: 's2364170', displayName: 'Shahida', allowedTabs: '*' },
    'umed': { password: 'umed1234', displayName: 'umed', allowedTabs: ['expenses', 'products', 'shipments', 'barcodes', 'cashier'] },
    'Кассир': { password: '1234', displayName: 'Кассир', allowedTabs: ['cashier'] },
    'kassir': { password: '1234', displayName: 'Кассир', allowedTabs: ['cashier'] },
    // Заводские логины магазинов: каждый видит только СВОЮ кассу.
    // allowedKassa — точное имя кассы в 1С (фильтр списка касс в РМК).
    'siyoma':   { password: 'siyoma123',   displayName: 'Сиёма',    allowedTabs: ['cashier'], allowedKassa: 'Ортосалон "Сиёма"' },
    'ayni':     { password: 'ayni123',     displayName: 'Айни',     allowedTabs: ['cashier'], allowedKassa: 'Ортосалон "Айни"' },
    'barakat':  { password: 'barakat123',  displayName: 'Баракат',  allowedTabs: ['cashier'], allowedKassa: 'Ортосалон "Баракат"' },
    'citymall': { password: 'citymall123', displayName: 'Сити-Молл', allowedTabs: ['cashier'], allowedKassa: 'Ортосалон "Сити-Молл"' }
};

// Права доступа текущего пользователя: '*' (полный) или массив id вкладок.
let currentAllowedTabs = '*';
// Разрешённая касса для логина магазина (точное имя) или null = все кассы.
let currentAllowedKassa = null;

function isTabAllowed(tabName) {
    // Вкладка «Касса» (РМК) видна ВСЕМ пользователям (в т.ч. кассиру).
    if (tabName === 'pos') return true;
    // «История продаж» и «Отчёты и кассы» — только админам с полным доступом (кассир их НЕ видит).
    if (tabName === 'posHistory' || tabName === 'salesReports') return currentAllowedTabs === '*';
    return currentAllowedTabs === '*' || currentAllowedTabs.includes(tabName);
}

// Salons
const SALONS = ['Ортосалон СитиМолл', 'Ортосалон Сиема', 'Ортосалон Баракат', 'Ортосалон Айни'];

// ═══════════════════════════════════════════════════════════════
// 1С ИНТЕГРАЦИЯ (Supabase, только чтение)
// ═══════════════════════════════════════════════════════════════
const AI_INSIGHTS_URL = 'https://1c-sync.vercel.app/api/ai-insights';

// ── Синхронизация с 1С ──
// Базовый URL бэкенда синхронизации (Vercel serverless, тот же домен, что и AI_INSIGHTS_URL).
const SYNC_BASE_URL = 'https://1c-sync.vercel.app';
// Секрет для ручного запуска. Вкладка «Настройки» доступна только админам,
// вход в дашборд защищён логином — секрет светится только админам.
const SYNC_SECRET = '76b944f4444be766b2c27b7988118aec521c814d824b191a86cf8b6c420db44e';
// ── Сервис уникальных штрихкодов (отдельный от 1c-sync, чтобы не ломать синхронизацию) ──
const BARCODE_SVC_URL = 'https://1c-sync-barcodes.vercel.app';
const BARCODE_SVC_SECRET = 'TySog2bN1bMJHsssoTvyCZO3IKOef1z0';
// Описание всех типов синхронизации: метка sync_type в логе, эндпоинт, cron-расписание (UTC) и название.
// schedule: { type:'hourly' } | { type:'everyN', hours:N } | { type:'daily', hourUtc:H }
const SYNC_TYPES = [
    { key: 'sales',            endpoint: '/api/sync-sales',          label: 'Продажи',                schedule: { type: 'hourly' } },
    { key: 'cards',            endpoint: '/api/sync-cards',          label: 'Карты 1С',               schedule: { type: 'hourly' } },
    { key: 'stock',            endpoint: '/api/sync-stock',          label: 'Остатки (общие)',        schedule: { type: 'everyN', hours: 4 } },
    { key: 'product-stock',    endpoint: '/api/sync-product-stock',  label: 'Остатки товаров',        schedule: { type: 'daily', hourUtc: 0 } },
    { key: 'employee-sales',   endpoint: '/api/sync-employee-sales', label: 'Продажи сотрудников',    schedule: { type: 'daily', hourUtc: 0 } },
    { key: 'catalogs',         endpoint: '/api/sync-catalogs',       label: 'Справочники',            schedule: { type: 'daily', hourUtc: 2 } },
    { key: 'push_cards_to_1c', endpoint: '/api/push-cards-to-1c',    label: 'Отправка карт в 1С',     schedule: { type: 'daily', hourUtc: 23 } },
];

// Кэш данных 1С
let sales1C = [];          // [{ date:'YYYY-MM-DD', salon:'<имя из warehouses_1c>', net, gross, returns, receipts }]
let warehouseMap1C = {};   // ref_key -> name (из warehouses_1c)
let sales1CLoaded = false;

// Загрузка справочника складов и ежедневных продаж из 1С
async function loadSales1C() {
    try {
        const [whRes, salesRes] = await Promise.all([
            supabaseClient.from('warehouses_1c').select('ref_key,name,type'),
            supabaseClient.from('sales_daily_1c').select('sale_date,warehouse_ref,receipts_count,gross_sales,returns_sum,net_sales')
        ]);

        if (whRes.error) throw whRes.error;
        if (salesRes.error) throw salesRes.error;

        warehouseMap1C = {};
        (whRes.data || []).forEach(w => {
            // Названия салонов берём из справочника, НЕ хардкодим
            warehouseMap1C[w.ref_key] = (w.name || '').trim();
        });

        sales1C = (salesRes.data || []).map(r => ({
            date: r.sale_date,
            salon: warehouseMap1C[r.warehouse_ref] || 'Неизвестный склад',
            warehouseRef: r.warehouse_ref,
            net: parseFloat(r.net_sales) || 0,
            gross: parseFloat(r.gross_sales) || 0,
            returns: parseFloat(r.returns_sum) || 0,
            receipts: parseInt(r.receipts_count, 10) || 0
        }));

        sales1CLoaded = true;
        console.log(`Данные продаж 1С загружены: ${sales1C.length} строк`);
    } catch (e) {
        console.error('Ошибка загрузки продаж 1С:', e);
        sales1CLoaded = false;
    }
}

// Список названий салонов из 1С (type='магазин'), по которым есть продажи.
function getSalonNames1C() {
    const names = [];
    const seen = new Set();
    sales1C.forEach(s => {
        if (!seen.has(s.salon)) { seen.add(s.salon); names.push(s.salon); }
    });
    return names.sort((a, b) => a.localeCompare(b, 'ru'));
}

// Сумма net_sales из 1С за период [fromDate, toDate] (включительно), по локальным датам.
function sumNet1C(fromDate, toDate) {
    const from = toLocalDateStr(fromDate);
    const to = toLocalDateStr(toDate);
    return sales1C.reduce((sum, s) => {
        if (s.date >= from && s.date <= to) return sum + s.net;
        return sum;
    }, 0);
}

// net_sales по салонам за период -> { '<salon>': net }
function netBySalon1C(fromDate, toDate) {
    const from = toLocalDateStr(fromDate);
    const to = toLocalDateStr(toDate);
    const res = {};
    sales1C.forEach(s => {
        if (s.date >= from && s.date <= to) {
            res[s.salon] = (res[s.salon] || 0) + s.net;
        }
    });
    return res;
}

// 'YYYY-MM-DD' из Date или строки, по локальному времени.
function toLocalDateStr(d) {
    // Уже готовая строка 'YYYY-MM-DD' (напр. из <input type="date">) — возвращаем
    // как есть, чтобы не зависеть от таймзоны при парсинге new Date('YYYY-MM-DD').
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    const dt = (d instanceof Date) ? d : new Date(d);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// Самая свежая дата с продажами в 1С (строка 'YYYY-MM-DD') или сегодня.
function latestSale1CDate() {
    let max = '';
    sales1C.forEach(s => { if (s.date > max) max = s.date; });
    return max || toLocalDateStr(new Date());
}

// Нормализация названия салона для сопоставления имён из 1С (warehouses_1c)
// с названиями из постоянных затрат (SALONS). В 1С названия отличаются:
// кавычки, дефисы, буква «ё» вместо «е» и т.п. (напр. Ортосалон "Сити-Молл"
// против Ортосалон СитиМолл). Сводим к единому виду: нижний регистр, без
// кавычек/пробелов/дефисов/точек, «ё»→«е».
function normalizeSalonName(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[«»"'`\-\s.,]/g, '');
}

// Сопоставляем имя салона из 1С с одним из названий SALONS (постоянные затраты).
// Возвращает каноническое имя из SALONS либо null, если совпадения нет
// (напр. «Интернет магазин», «Основной склад» — для них постоянных затрат нет).
function matchSalonToFixed(salon1CName) {
    const norm = normalizeSalonName(salon1CName);
    return SALONS.find(s => normalizeSalonName(s) === norm) || null;
}

// Возвращает год-месяц ('YYYY-MM') последнего месяца, за который в 1С есть
// продажи. Если данных нет — текущий месяц. Берём именно последний месяц с
// данными, а не календарный «текущий»: данные 1С приходят с задержкой, и в
// начале месяца за новый месяц их ещё нет (напр. 1 июня данные только за май).
function latestSalesYM1C() {
    const last = latestSale1CDate(); // 'YYYY-MM-DD', самая свежая дата с продажами
    return last.slice(0, 7);
}

// Список месяцев ('YYYY-MM'), за которые в 1С реально есть продажи.
// Отсортирован по убыванию (свежие сверху) — этот же порядок используется
// для выпадающего списка периодов в блоке выручки.
function availableSalesYM1C() {
    const seen = new Set();
    sales1C.forEach(s => { if (s.date) seen.add(s.date.slice(0, 7)); });
    return Array.from(seen).sort((a, b) => b.localeCompare(a));
}

// Самая ранняя дата с продажами в 1С (строка 'YYYY-MM-DD') или ''.
function earliestSale1CDate() {
    let min = '';
    sales1C.forEach(s => { if (s.date && (!min || s.date < min)) min = s.date; });
    return min;
}

// Первый и последний день месяца 'YYYY-MM' как строки 'YYYY-MM-DD'.
function monthBounds(ym) {
    const [y, m] = ym.split('-').map(Number);
    const start = toLocalDateStr(new Date(y, m - 1, 1));
    const end = toLocalDateStr(new Date(y, m, 0)); // день 0 след. месяца = последний день текущего
    return { start, end };
}

// Количество дней в диапазоне [from..to] включительно (по строкам 'YYYY-MM-DD').
function daysInRangeInclusive(from, to) {
    const a = new Date(from + 'T00:00:00');
    const b = new Date(to + 'T00:00:00');
    if (isNaN(a) || isNaN(b) || b < a) return 0;
    return Math.round((b - a) / 86400000) + 1;
}

// Пересечение диапазона [from..to] с месяцем ym: возвращает кол-во дней
// диапазона, попадающих в этот месяц, и общее число дней месяца. Нужно для
// pro-rata распределения помесячных постоянных затрат на произвольный диапазон.
function monthOverlapDays(ym, from, to) {
    const { start: mStart, end: mEnd } = monthBounds(ym);
    const lo = from > mStart ? from : mStart;
    const hi = to < mEnd ? to : mEnd;
    if (hi < lo) return { overlap: 0, monthDays: daysInRangeInclusive(mStart, mEnd) };
    return { overlap: daysInRangeInclusive(lo, hi), monthDays: daysInRangeInclusive(mStart, mEnd) };
}

// Список месяцев 'YYYY-MM', пересекающихся с диапазоном [from..to] включительно.
function monthsInRange(from, to) {
    const months = [];
    let [y, m] = from.split('-').map(Number);
    const [ey, em] = to.split('-').map(Number);
    while (y < ey || (y === ey && m <= em)) {
        months.push(`${y}-${String(m).padStart(2, '0')}`);
        m++;
        if (m > 12) { m = 1; y++; }
    }
    return months;
}

// Pro-rata постоянных затрат салона за произвольный диапазон [from..to].
// Постоянные затраты в данных заданы ПОМЕСЯЧНО (привязаны к датам внутри месяца),
// поэтому для диапазона, не равного целому месяцу, берём долю затрат каждого
// месяца пропорционально количеству дней диапазона, попавших в этот месяц:
//   доля_месяца = затраты_месяца × (дней_диапазона_в_месяце / дней_в_месяце).
// Если диапазон охватывает несколько месяцев — суммируем пропорциональные доли
// по каждому из них. Для целого месяца коэффициент = 1 (полные затраты).
function proratedFixedExpensesBySalon(salon, from, to) {
    const months = monthsInRange(from, to);
    return months.reduce((sum, ym) => {
        const monthly = sumFixedExpensesBySalon(salon, ym);
        if (!monthly) return sum;
        const { overlap, monthDays } = monthOverlapDays(ym, from, to);
        if (!monthDays) return sum;
        return sum + monthly * (overlap / monthDays);
    }, 0);
}

// Выбранный пользователем диапазон дат для блока выручки по салонам.
// Источник истины — два поля <input type="date"> ('с' и 'по'). Месячный select
// работает как быстрый пресет: при выборе месяца поля дат заполняются его первым
// и последним днём. null означает «ещё не инициализировано» — тогда при первом
// рендере подставляем последний месяц с данными (см. ensureSalonRevenueRange).
let salonRevenueRange = null; // { from:'YYYY-MM-DD', to:'YYYY-MM-DD' }

// Заполняет выпадающий список месяцев реально доступными периодами 1С.
// Список используется как быстрый пресет диапазона дат. Возвращает массив
// доступных месяцев ('YYYY-MM', свежие сверху) или [] если данных нет.
function populateSalonRevenuePeriodSelect() {
    const sel = document.getElementById('dashboardSalonRevenuePeriod');
    const months = availableSalesYM1C();
    if (!sel) return months;

    if (!months.length) {
        sel.innerHTML = '';
        sel.disabled = true;
        return months;
    }

    sel.disabled = false;
    sel.innerHTML = months
        .map(ym => `<option value="${ym}">${escapeHtml(formatMonthRu(ym))}</option>`)
        .join('');
    return months;
}

// Гарантирует, что salonRevenueRange задан и не выходит за пределы доступных
// данных. По умолчанию (первая загрузка) — последний месяц с данными 1С: поля
// дат заполняются его первым и последним днём, блок непустой. Также подрезает
// уже выбранный диапазон к [minDate..maxDate], чтобы нельзя было уйти в пустоту.
function ensureSalonRevenueRange() {
    const minDate = earliestSale1CDate();
    const maxDate = latestSale1CDate();
    if (!minDate) { salonRevenueRange = null; return; }

    if (!salonRevenueRange) {
        // По умолчанию — последний месяц с данными.
        const { start, end } = monthBounds(latestSalesYM1C());
        salonRevenueRange = {
            from: start < minDate ? minDate : start,
            to: end > maxDate ? maxDate : end
        };
        return;
    }

    // Подрезаем границы к доступному диапазону данных.
    let { from, to } = salonRevenueRange;
    if (from < minDate) from = minDate;
    if (to > maxDate) to = maxDate;
    if (from > to) from = to;
    salonRevenueRange = { from, to };
}

// Синхронизирует поля <input type="date"> с текущим состоянием диапазона и
// ограничивает их атрибутами min/max доступным диапазоном данных. Месячный
// select при этом выставляется на месяц начала диапазона, если диапазон ровно
// совпадает с целым месяцем (для наглядности пресета); иначе выбор месяца
// оставляем как есть.
function syncSalonRevenueControls() {
    const fromEl = document.getElementById('dashboardSalonRevenueFrom');
    const toEl = document.getElementById('dashboardSalonRevenueTo');
    const sel = document.getElementById('dashboardSalonRevenuePeriod');
    const minDate = earliestSale1CDate();
    const maxDate = latestSale1CDate();

    if (fromEl) {
        fromEl.min = minDate || '';
        fromEl.max = maxDate || '';
        fromEl.value = salonRevenueRange ? salonRevenueRange.from : '';
    }
    if (toEl) {
        toEl.min = minDate || '';
        toEl.max = maxDate || '';
        toEl.value = salonRevenueRange ? salonRevenueRange.to : '';
    }
    if (sel && salonRevenueRange) {
        const ym = salonRevenueRange.from.slice(0, 7);
        const { start, end } = monthBounds(ym);
        if (salonRevenueRange.from === start && salonRevenueRange.to === end) {
            sel.value = ym;
        }
    }
}

// Обработчик месячного пресета: выбор месяца заполняет поля дат его первым и
// последним днём (с подрезкой к доступному диапазону данных) и перерисовывает блок.
function onSalonRevenueMonthPreset() {
    const sel = document.getElementById('dashboardSalonRevenuePeriod');
    if (!sel || !sel.value) return;
    const { start, end } = monthBounds(sel.value);
    const minDate = earliestSale1CDate();
    const maxDate = latestSale1CDate();
    salonRevenueRange = {
        from: minDate && start < minDate ? minDate : start,
        to: maxDate && end > maxDate ? maxDate : end
    };
    renderDashboardSalonRevenue1C();
}

// Обработчик ручного изменения полей дат. Нормализует диапазон (если 'по' раньше
// 'с' — меняем местами), подрезает к доступному диапазону данных и перерисовывает.
function onSalonRevenueDateRangeChange() {
    const fromEl = document.getElementById('dashboardSalonRevenueFrom');
    const toEl = document.getElementById('dashboardSalonRevenueTo');
    if (!fromEl || !toEl) return;
    let from = fromEl.value;
    let to = toEl.value;
    if (!from || !to) return; // ждём, пока заданы оба поля
    if (to < from) { const t = from; from = to; to = t; }
    salonRevenueRange = { from, to };
    renderDashboardSalonRevenue1C();
}

// Объединённый блок «Выручка + чистая прибыль по салонам» на главной.
// Период выбирается пользователем в шапке блока: можно выбрать целый месяц
// (быстрый пресет, заполняет поля дат) ИЛИ задать произвольный диапазон дней в
// полях «с»/«по». Так как 1С хранит продажи по дням (sale_date), это даёт
// дневную гранулярность. По умолчанию — ПОСЛЕДНИЙ МЕСЯЦ С ДАННЫМИ 1С (а не
// календарный текущий), чтобы блок не оказывался пустым в начале месяца, когда
// данные за новый месяц ещё не подгрузились. Выручка и постоянные затраты
// считаются за ОДИН И ТОТ ЖЕ диапазон, поэтому чистая прибыль = выручка − затраты
// консистентна.
//
// Чистая прибыль салона = выручка салона (net_sales из 1С за диапазон)
//                         − постоянные затраты этого салона за диапазон.
// Постоянные затраты салона = собственные затраты салона
//                         + доля общих затрат («Общие»).
//
// Pro-rata по дням: постоянные затраты заданы помесячно, поэтому для диапазона,
// не равного целому месяцу, берём их долю пропорционально количеству дней
// диапазона относительно месяца (см. proratedFixedExpensesBySalon). Для диапазона
// через несколько месяцев — суммируем пропорциональные доли по каждому месяцу.
//
// Как распределяем общие затраты: в данных постоянные затраты привязаны к
// конкретному салону (поле salon), а бюджет без привязки лежит в «Общие».
// «Общие» (взятые pro-rata за диапазон) распределяем ПРОПОРЦИОНАЛЬНО выручке
// салонов за диапазон — салон с большей выручкой берёт большую долю общих
// расходов (честнее, чем поровну). Если суммарная выручка нулевая — поровну.
function renderDashboardSalonRevenue1C() {
    const monthEl = document.getElementById('dashboardSalonRevenueMonth');
    const todayEl = document.getElementById('dashboardSalonRevenueToday');
    const labelEl = document.getElementById('dashboardSalonRevenueDateLabel');
    if (!monthEl) return;
    if (todayEl) todayEl.innerHTML = ''; // блок «за последний день» больше не используется

    if (!sales1CLoaded) {
        monthEl.innerHTML = '<p style="color:var(--color-text-secondary);">Загрузка данных 1С…</p>';
        return;
    }

    // Заполняем месячный пресет, определяем/подрезаем диапазон дат и синхронизируем поля.
    populateSalonRevenuePeriodSelect();
    ensureSalonRevenueRange();
    syncSalonRevenueControls();

    if (!salonRevenueRange) {
        if (labelEl) labelEl.textContent = '';
        monthEl.innerHTML = '<p style="color:var(--color-text-secondary);">Нет данных за период</p>';
        return;
    }

    const { from, to } = salonRevenueRange;
    // Подпись периода отражает выбранный диапазон дат (на русском).
    if (labelEl) labelEl.textContent = `за ${formatDateRu(from)} — ${formatDateRu(to)}`;

    // Выручка по салонам 1С за диапазон [from..to] включительно.
    const revByName1C = netBySalon1C(from, to);

    // Защита от пустого диапазона: если нет ни продаж, ни постоянных затрат за
    // период — показываем понятное сообщение, не ломая интерфейс.
    const hasRevenue = Object.keys(revByName1C).length > 0;
    const hasAnyFixed = SALONS.some(s => proratedFixedExpensesBySalon(s, from, to) > 0)
        || proratedFixedExpensesBySalon('Общие', from, to) > 0;
    if (!hasRevenue && !hasAnyFixed) {
        monthEl.innerHTML = '<p style="color:var(--color-text-secondary);">Нет данных за период</p>';
        return;
    }

    // Сводим выручку к каноническим именам SALONS (для сопоставления с затратами).
    // Выручку складов без постоянных затрат (Интернет магазин, Основной склад)
    // оставляем отдельно — она войдёт в общий итог, но без вычета затрат.
    const revenueBySalon = {};
    SALONS.forEach(s => { revenueBySalon[s] = 0; });
    let revenueUnmatched = 0;
    Object.keys(revByName1C).forEach(name1c => {
        const canon = matchSalonToFixed(name1c);
        if (canon) revenueBySalon[canon] += revByName1C[name1c];
        else revenueUnmatched += revByName1C[name1c];
    });

    // Постоянные затраты за диапазон (pro-rata по дням): собственные по салонам
    // + общий «котёл» из «Общие».
    const ownFixedBySalon = {};
    SALONS.forEach(s => { ownFixedBySalon[s] = proratedFixedExpensesBySalon(s, from, to); });
    const sharedFixed = proratedFixedExpensesBySalon('Общие', from, to);

    const totalMatchedRevenue = SALONS.reduce((sum, s) => sum + revenueBySalon[s], 0);

    // Доля общих затрат на салон: пропорционально выручке, иначе поровну.
    const sharedShare = {};
    SALONS.forEach(s => {
        if (totalMatchedRevenue > 0) {
            sharedShare[s] = sharedFixed * (revenueBySalon[s] / totalMatchedRevenue);
        } else {
            sharedShare[s] = sharedFixed / SALONS.length;
        }
    });

    // Заголовок грида: для целого месяца показываем его название, иначе диапазон дат.
    const fromYM = from.slice(0, 7);
    const { start: mStart, end: mEnd } = monthBounds(fromYM);
    const periodTitle = (from === mStart && to === mEnd)
        ? formatMonthRu(fromYM)
        : `${formatDateRu(from)} — ${formatDateRu(to)}`;

    // Карточки по салонам.
    let totalRevenue = 0;
    let totalFixed = 0;
    let cards = `<div class="c1-revenue-grid-title">Выручка − постоянные затраты = чистая прибыль (${escapeHtml(periodTitle)})</div>`;

    SALONS.forEach(salon => {
        const revenue = revenueBySalon[salon] || 0;
        const fixed = (ownFixedBySalon[salon] || 0) + (sharedShare[salon] || 0);
        const profit = revenue - fixed;
        totalRevenue += revenue;
        totalFixed += fixed;

        const profitClass = profit >= 0 ? 'c1-profit-positive' : 'c1-profit-negative';
        const profitSign = profit >= 0 ? '+' : '−';
        cards += `
            <div class="c1-revenue-card">
                <div class="c1-revenue-salon">🏪 ${escapeHtml(salon)}</div>
                <div class="c1-revenue-value">${formatCurrency(revenue)}</div>
                <div class="c1-profit-breakdown">
                    <div class="c1-profit-row">
                        <span>− Постоянные затраты</span>
                        <span>−${formatCurrency(fixed)}</span>
                    </div>
                    <div class="c1-profit-row c1-profit-result ${profitClass}">
                        <span>Чистая прибыль</span>
                        <span>${profitSign}${formatCurrency(Math.abs(profit))}</span>
                    </div>
                </div>
            </div>`;
    });

    // Выручка прочих складов 1С без привязки к затратам (если есть) — для полноты итога.
    totalRevenue += revenueUnmatched;

    // Итоговая карточка: суммарная выручка − все постоянные затраты.
    const grandProfit = totalRevenue - totalFixed;
    const grandClass = grandProfit >= 0 ? 'c1-profit-positive' : 'c1-profit-negative';
    const grandSign = grandProfit >= 0 ? '+' : '−';
    cards += `
        <div class="c1-revenue-card c1-revenue-total">
            <div class="c1-revenue-salon">Итого по всем салонам</div>
            <div class="c1-revenue-value">${formatCurrency(totalRevenue)}</div>
            <div class="c1-profit-breakdown">
                <div class="c1-profit-row">
                    <span>− Постоянные затраты</span>
                    <span>−${formatCurrency(totalFixed)}</span>
                </div>
                <div class="c1-profit-row c1-profit-result ${grandClass}">
                    <span>Чистая прибыль</span>
                    <span>${grandSign}${formatCurrency(Math.abs(grandProfit))}</span>
                </div>
            </div>
        </div>`;

    monthEl.innerHTML = cards;
}

// ───────────────────────────────────────────────────────────────
// Карты 1С
// ───────────────────────────────────────────────────────────────
async function loadCards1C() {
    const el = document.getElementById('cards1cContent');
    if (!el) return;
    el.innerHTML = '<div class="loading" style="display:flex;"><div class="loading-spinner"></div><p>Загрузка…</p></div>';

    try {
        // Проще брать из ИИ-эндпоинта (поле cards). Фолбэк — таблица cards_1c.
        let byType = null;
        let newLast7 = null;
        try {
            const res = await fetch(AI_INSIGHTS_URL, { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                if (data && data.cards) {
                    byType = data.cards.by_type || {};
                    newLast7 = data.cards.new_last_7d;
                }
            }
        } catch (e) { /* перейдём к фолбэку ниже */ }

        if (!byType) {
            // Фолбэк: считаем напрямую из cards_1c
            const { data, error } = await supabaseClient
                .from('cards_1c')
                .select('card_type_name,first_seen_at');
            if (error) throw error;
            byType = {};
            const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            newLast7 = 0;
            (data || []).forEach(c => {
                const t = c.card_type_name || '(без типа)';
                byType[t] = (byType[t] || 0) + 1;
                if (c.first_seen_at && new Date(c.first_seen_at) >= weekAgo) newLast7++;
            });
        }

        const accounting = byType['для учета'] || 0;
        const discount = byType['Электронная дисконтная карта'] || 0;

        el.innerHTML = `
            <div class="metrics-cards">
                <div class="metric-card card-1">
                    <div class="metric-icon">🗂️</div>
                    <div class="metric-content">
                        <h3>Карты «для учета»</h3>
                        <div class="metric-value">${accounting.toLocaleString('ru-RU')}</div>
                    </div>
                </div>
                <div class="metric-card card-2">
                    <div class="metric-icon">💳</div>
                    <div class="metric-content">
                        <h3>Электронные дисконтные карты</h3>
                        <div class="metric-value">${discount.toLocaleString('ru-RU')}</div>
                    </div>
                </div>
                <div class="metric-card card-4">
                    <div class="metric-icon">🆕</div>
                    <div class="metric-content">
                        <h3>Новые за 7 дней</h3>
                        <div class="metric-value">${(newLast7 == null ? '—' : Number(newLast7).toLocaleString('ru-RU'))}</div>
                    </div>
                </div>
            </div>
            ${renderCardsByTypeTable(byType)}`;
    } catch (e) {
        console.error('Ошибка загрузки карт 1С:', e);
        el.innerHTML = '<p class="error-message" style="display:block;">Не удалось загрузить данные по картам.</p>';
    }
}

function renderCardsByTypeTable(byType) {
    const rows = Object.entries(byType)
        .sort((a, b) => b[1] - a[1])
        .map(([type, n]) => `<tr><td>${escapeHtml(type)}</td><td>${Number(n).toLocaleString('ru-RU')}</td></tr>`)
        .join('');
    if (!rows) return '';
    return `
        <h4 class="ai-block-title">Все типы карт</h4>
        <div class="table-container">
            <table>
                <thead><tr><th>Тип карты</th><th>Количество</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

// ───────────────────────────────────────────────────────────────
// Синхронизация с 1С — статус, расписание, ручной запуск
// ───────────────────────────────────────────────────────────────

// Вычисляет следующее срабатывание cron-расписания от текущего момента (UTC), возвращает Date.
function nextCronRun(schedule, from = new Date()) {
    const next = new Date(from.getTime());
    next.setUTCSeconds(0, 0);
    if (schedule.type === 'hourly') {
        next.setUTCMinutes(0);
        next.setUTCHours(next.getUTCHours() + 1);
        return next;
    }
    if (schedule.type === 'everyN') {
        const n = schedule.hours;
        next.setUTCMinutes(0);
        const curH = from.getUTCHours();
        const nextH = (Math.floor(curH / n) + 1) * n; // ближайшее кратное n вперёд
        next.setUTCHours(0);
        next.setUTCHours(nextH); // переполнение часов корректно перейдёт на следующий день
        return next;
    }
    if (schedule.type === 'daily') {
        next.setUTCMinutes(0);
        next.setUTCHours(schedule.hourUtc);
        if (next.getTime() <= from.getTime()) {
            next.setUTCDate(next.getUTCDate() + 1);
        }
        return next;
    }
    return null;
}

function fmtSyncDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function loadSyncStatus() {
    const body = document.getElementById('syncStatusTableBody');
    const errBody = document.getElementById('syncErrorsTableBody');
    if (!body) return;

    try {
        // Последние записи лога — группируем по sync_type, берём самую свежую.
        const { data, error } = await supabaseClient
            .from('sync_log')
            .select('id,sync_type,started_at,finished_at,status,rows_affected,error_text')
            .order('id', { ascending: false })
            .limit(100);
        if (error) throw error;

        const latestByType = {};
        (data || []).forEach(row => {
            if (!latestByType[row.sync_type]) latestByType[row.sync_type] = row;
        });

        body.innerHTML = SYNC_TYPES.map(t => {
            const last = latestByType[t.key];
            const lastTime = last ? fmtSyncDate(last.finished_at || last.started_at) : '—';
            let statusCell = '<span style="color:var(--color-text-secondary);">—</span>';
            if (last) {
                statusCell = last.status === 'ok'
                    ? '<span class="sync-status-ok">✅</span>'
                    : '<span class="sync-status-error">❌</span>';
            }
            const rows = (last && last.rows_affected != null) ? Number(last.rows_affected).toLocaleString('ru-RU') : '—';
            const next = fmtSyncDate(nextCronRun(t.schedule).toISOString());
            return `<tr>
                <td>${escapeHtml(t.label)}</td>
                <td>${lastTime}</td>
                <td style="text-align:center;">${statusCell}</td>
                <td>${rows}</td>
                <td>${next}</td>
                <td><button class="btn btn-secondary btn-sm" id="syncBtn-${t.key}" onclick="runSync('${t.key}')">▶ Запустить</button></td>
            </tr>`;
        }).join('');
    } catch (e) {
        console.error('Ошибка загрузки статуса синхронизации:', e);
        body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--color-error);">Не удалось загрузить статус синхронизации.</td></tr>';
    }

    // Лог ошибок (последние 20).
    if (errBody) {
        try {
            const { data, error } = await supabaseClient
                .from('sync_log')
                .select('sync_type,started_at,finished_at,error_text')
                .eq('status', 'error')
                .order('id', { ascending: false })
                .limit(20);
            if (error) throw error;
            if (!data || data.length === 0) {
                errBody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--color-text-secondary);">Ошибок нет ✅</td></tr>';
            } else {
                errBody.innerHTML = data.map(r => `<tr>
                    <td>${fmtSyncDate(r.finished_at || r.started_at)}</td>
                    <td>${escapeHtml(r.sync_type || '')}</td>
                    <td style="color:var(--color-error);">${escapeHtml(r.error_text || 'неизвестная ошибка')}</td>
                </tr>`).join('');
            }
        } catch (e) {
            console.error('Ошибка загрузки лога ошибок синхронизации:', e);
            errBody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--color-error);">Не удалось загрузить лог ошибок.</td></tr>';
        }
    }
}

// Запуск одного типа синхронизации. CORS: бэкенд на 1c-sync.vercel.app, тот же домен
// уже успешно вызывается для AI_INSIGHTS_URL обычным fetch. Если CORS всё же помешает,
// триггер на сервере всё равно сработает — поэтому в catch не считаем это фатальной ошибкой,
// а перечитываем sync_log через несколько секунд, чтобы показать фактический результат.
async function runSync(key) {
    const t = SYNC_TYPES.find(x => x.key === key);
    if (!t) return;
    const btn = document.getElementById('syncBtn-' + key);
    const restore = btn ? btn.innerHTML : null;
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Синхронизация…'; }

    const url = `${SYNC_BASE_URL}${t.endpoint}?secret=${encodeURIComponent(SYNC_SECRET)}`;
    try {
        await fetch(url, { cache: 'no-store' });
    } catch (e) {
        // CORS/сеть — запрос всё равно мог достичь сервера. Не роняем страницу.
        console.warn('Запуск синхронизации: fetch не вернул ответ (возможно CORS), триггер мог сработать:', e);
    }

    // Даём серверу время отработать, затем перечитываем лог.
    setTimeout(async () => {
        await loadSyncStatus();
        if (btn) { btn.disabled = false; btn.innerHTML = restore; }
    }, 5000);
}

// Запускает все основные типы по очереди.
async function runAllSyncs() {
    const allBtn = document.getElementById('syncRunAllBtn');
    const restore = allBtn ? allBtn.innerHTML : null;
    if (allBtn) { allBtn.disabled = true; allBtn.innerHTML = '⏳ Запуск…'; }

    for (const t of SYNC_TYPES) {
        const url = `${SYNC_BASE_URL}${t.endpoint}?secret=${encodeURIComponent(SYNC_SECRET)}`;
        try {
            await fetch(url, { cache: 'no-store' });
        } catch (e) {
            console.warn('Запуск «все»: fetch не вернул ответ для ' + t.key + ' (возможно CORS):', e);
        }
    }

    setTimeout(async () => {
        await loadSyncStatus();
        if (allBtn) { allBtn.disabled = false; allBtn.innerHTML = restore; }
    }, 5000);
}

// ───────────────────────────────────────────────────────────────
// ИИ-аналитика
// ───────────────────────────────────────────────────────────────
function isGuid(s) {
    return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

function formatDiffPct(pct) {
    const up = pct >= 0;
    const arrow = up ? '▲' : '▼';
    const sign = up ? '+' : '−';
    const color = up ? 'var(--color-success)' : 'var(--color-error)';
    return `<span style="color:${color};font-weight:600;">${arrow} ${sign}${Math.abs(pct).toFixed(2)}%</span>`;
}

async function loadAiInsights() {
    const loadingEl = document.getElementById('aiInsightsLoading');
    const contentEl = document.getElementById('aiInsightsContent');
    const errorEl = document.getElementById('aiInsightsError');
    const btn = document.getElementById('aiRefreshBtn');
    if (!loadingEl || !contentEl) return;

    loadingEl.style.display = 'flex';
    contentEl.style.display = 'none';
    if (errorEl) errorEl.style.display = 'none';
    if (btn) btn.disabled = true;

    try {
        const res = await fetch(`${AI_INSIGHTS_URL}?ai=1`, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (!data || !data.ok) throw new Error('Эндпоинт вернул ошибку');

        renderAiInsights(data);
        contentEl.style.display = 'block';
    } catch (e) {
        console.error('Ошибка загрузки ИИ-аналитики:', e);
        if (errorEl) {
            errorEl.textContent = 'Не удалось загрузить ИИ-аналитику. Попробуйте обновить.';
            errorEl.style.display = 'block';
        }
    } finally {
        loadingEl.style.display = 'none';
        if (btn) btn.disabled = false;
    }
}

function renderAiInsights(data) {
    // ИИ-комментарий
    const commentEl = document.getElementById('aiComment');
    if (commentEl) {
        const comment = data.ai_comment;
        commentEl.innerHTML = comment
            ? `<div class="ai-comment-title">💬 Комментарий ИИ</div><div class="ai-comment-text">${escapeHtml(comment)}</div>`
            : `<div class="ai-comment-title">💬 Комментарий ИИ</div><div class="ai-comment-text">ИИ-комментарий недоступен.</div>`;
    }

    // Сравнение дня
    const dayEl = document.getElementById('aiDayCompare');
    if (dayEl && data.day_compare) {
        const dc = data.day_compare;
        dayEl.innerHTML = `
            <div class="ai-compare-title">Сравнение дня</div>
            <div class="ai-compare-row"><span>Сегодня (${escapeHtml(dc.today.date)})</span><b>${formatCurrency(dc.today.net)}</b></div>
            <div class="ai-compare-row"><span>Тот же день прошлого мес. (${escapeHtml(dc.same_day_prev.date)})</span><b>${formatCurrency(dc.same_day_prev.net)}</b></div>
            <div class="ai-compare-diff">Разница: ${formatCurrency(dc.diff_net)} ${formatDiffPct(dc.diff_pct)}</div>`;
    }

    // Сравнение месяца
    const monthEl = document.getElementById('aiMonthCompare');
    if (monthEl && data.month_compare) {
        const mc = data.month_compare;
        const noPrev = (mc.diff_net === 0 && mc.current && mc.previous && mc.current.month === mc.previous.month);
        if (noPrev) {
            monthEl.innerHTML = `
                <div class="ai-compare-title">Сравнение месяца</div>
                <div class="ai-compare-row"><span>Текущий месяц (${escapeHtml(mc.current.month)})</span><b>${formatCurrency(mc.current.net)}</b></div>
                <div class="ai-compare-diff" style="color:var(--color-text-secondary);">Недостаточно данных за прошлый месяц для сравнения.</div>`;
        } else {
            monthEl.innerHTML = `
                <div class="ai-compare-title">Сравнение месяца (накопительно, до дня ${mc.upto_day})</div>
                <div class="ai-compare-row"><span>Текущий (${escapeHtml(mc.current.month)})</span><b>${formatCurrency(mc.current.net)}</b></div>
                <div class="ai-compare-row"><span>Прошлый (${escapeHtml(mc.previous.month)})</span><b>${formatCurrency(mc.previous.net)}</b></div>
                <div class="ai-compare-diff">Разница: ${formatCurrency(mc.diff_net)} ${formatDiffPct(mc.diff_pct)}</div>`;
        }
    }

    // Помесячная таблица
    const monthsBody = document.querySelector('#aiMonthsTable tbody');
    if (monthsBody) {
        monthsBody.innerHTML = (data.months || []).map(m => `
            <tr>
                <td>${escapeHtml(m.month)}</td>
                <td>${formatCurrency(m.net)}</td>
                <td>${formatCurrency(m.gross)}</td>
                <td>${formatCurrency(m.returns)}</td>
                <td>${Number(m.receipts || 0).toLocaleString('ru-RU')}</td>
            </tr>`).join('') || '<tr><td colspan="5">Нет данных</td></tr>';
    }

    // Остатки по складам
    const stockBody = document.querySelector('#aiStockTable tbody');
    if (stockBody) {
        const byWh = (data.stock && data.stock.by_warehouse) || [];
        const total = data.stock ? data.stock.total_qty : byWh.reduce((s, w) => s + (w.qty || 0), 0);
        stockBody.innerHTML = byWh.map(w => `
            <tr>
                <td>${escapeHtml(w.warehouse || '—')}</td>
                <td>${Number(w.qty || 0).toLocaleString('ru-RU')}</td>
            </tr>`).join('') +
            `<tr style="font-weight:600;"><td>Итого</td><td>${Number(total || 0).toLocaleString('ru-RU')}</td></tr>`;
    }

    // Топ-100 товаров
    const topBody = document.querySelector('#aiTop100Table tbody');
    if (topBody) {
        topBody.innerHTML = (data.top100_by_qty || []).map(t => {
            let name = escapeHtml(t.name || '');
            if (isGuid(t.name)) name = '<span style="color:var(--color-text-secondary);">(без названия)</span>';
            return `<tr><td>${t.rank}</td><td>${name}</td><td>${Number(t.qty || 0).toLocaleString('ru-RU')}</td></tr>`;
        }).join('') || '<tr><td colspan="3">Нет данных</td></tr>';
    }
}

// Countries
const COUNTRIES = {
    'TJ': { name: 'Таджикистан', flag: '🇹🇯' },
    'RU': { name: 'Россия', flag: '🇷🇺' },
    'TR': { name: 'Турция', flag: '🇹🇷' },
    'CN': { name: 'Китай', flag: '🇨🇳' }
};

// Utility functions
function formatCurrency(amount) {
    return new Intl.NumberFormat('ru-RU', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount) + ' TJS';
}

function formatCurrencyUSD(amount) {
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount) + ' $';
}

function convertTJStoUSD(amountTJS) {
    const rate = appData.exchangeRate || 10.50;
    return amountTJS / rate;
}

function convertUSDtoTJS(amountUSD) {
    const rate = appData.exchangeRate || 10.50;
    return amountUSD * rate;
}

async function updateExchangeRate(newRate) {
    if (!newRate || isNaN(newRate) || newRate <= 0) {
        alert('Пожалуйста, введите корректный курс обмена.');
        return;
    }

    const oldRate = appData.exchangeRate;
    appData.exchangeRate = newRate;

    // Пересчитать все USD значения
    appData.suppliers.forEach(supplier => {
        supplier.debtUSD = convertTJStoUSD(supplier.debt);
    });

    appData.purchases.forEach(purchase => {
        if (purchase.currency === 'TJS') {
            purchase.amountUSD = convertTJStoUSD(purchase.amount);
        } else {
            purchase.amount = convertUSDtoTJS(purchase.amountUSD);
        }
    });

    appData.supplierPayments.forEach(payment => {
        if (payment.currency === 'TJS') {
            payment.amountUSD = convertTJStoUSD(payment.amount);
        } else {
            payment.amount = convertUSDtoTJS(payment.amountUSD);
        }
    });

    await saveData();
    loadSuppliersTable();
    loadPurchasesTable();
    updateDebtSummary();
    alert(`Курс обмена обновлен:\n${oldRate.toFixed(2)} → ${newRate.toFixed(2)} TJS за $1\n\nВсе суммы пересчитаны.`);
}

function formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleDateString('ru-RU');
}

function formatDateTime(date) {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleString('ru-RU');
}

function generateId(prefix = 'id') {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function showLoading(show = true) {
    document.getElementById('loadingIndicator').style.display = show ? 'block' : 'none';
}

function showError(message, containerId = 'loginError') {
    const errorElement = document.getElementById(containerId);
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.style.display = 'block';
        setTimeout(() => {
            errorElement.style.display = 'none';
        }, 5000);
    }
}

function showSuccess(message, containerId) {
    const container = document.getElementById(containerId);
    if (container) {
        const successElement = document.createElement('div');
        successElement.className = 'success-message';
        successElement.textContent = message;
        container.appendChild(successElement);
        setTimeout(() => {
            if (successElement.parentNode) {
                successElement.parentNode.removeChild(successElement);
            }
        }, 3000);
    }
}

// ═══════════════════════════════════════════════════════════════
// SUPABASE DATA FUNCTIONS
// ═══════════════════════════════════════════════════════════════

async function loadData() {
    showLoading(true);
    try {
        const { data, error } = await supabaseClient
            .from('dashboard_data')
            .select('*')
            .order('id', { ascending: false })
            .limit(1);

        if (error) {
            console.error('Supabase error:', error);
            if (error.code === 'PGRST116') {
                console.log('No data found, using initial data');
                appData = {
                    sales: [],
                    expenses: [],
                    employees: [],
                    salaryPayments: [],
                    suppliers: [],
                    supplierPayments: [],
                    purchases: [],
                    auditLog: [],
                    exchangeRate: 10.50
                };
            } else {
                showError('Не удалось загрузить данные из Supabase');
                return;
            }
        } else if (data && data.length > 0 && data[0].app_json) {
            appData = JSON.parse(data[0].app_json);
            console.log('Data loaded from Supabase successfully');
        } else {
            appData = {
                sales: [],
                expenses: [],
                employees: [],
                salaryPayments: [],
                suppliers: [],
                supplierPayments: [],
                purchases: [],
                auditLog: [],
                exchangeRate: 10.50
            };
        }

        if (!appData.exchangeRate || appData.exchangeRate <= 0) {
            appData.exchangeRate = 10.50;
        }

        appData.suppliers = (appData.suppliers || []).map(supplier => ({
            ...supplier,
            debtUSD: supplier.debtUSD !== undefined ? supplier.debtUSD : convertTJStoUSD(supplier.debt || 0)
        }));

        appData.purchases = (appData.purchases || []).map(purchase => ({
            ...purchase,
            amountUSD: purchase.amountUSD !== undefined ? purchase.amountUSD : convertTJStoUSD(purchase.amount || 0),
            currency: purchase.currency || 'TJS'
        }));

        appData.supplierPayments = (appData.supplierPayments || []).map(payment => ({
            ...payment,
            amountUSD: payment.amountUSD !== undefined ? payment.amountUSD : convertTJStoUSD(payment.amount || 0),
            currency: payment.currency || 'TJS'
        }));

        appData.sales = appData.sales || [];
        appData.expenses = appData.expenses || [];
        appData.employees = appData.employees || [];
        appData.salaryPayments = appData.salaryPayments || [];
        appData.auditLog = appData.auditLog || [];
        appData.fixedExpenses = appData.fixedExpenses || [];
        appData.fixedExpenseCategories = appData.fixedExpenseCategories || null;
        appData.fixedExpensesAutofillLog = appData.fixedExpensesAutofillLog || {};
        appData.dailySalesEntries = appData.dailySalesEntries || [];
        appData.shipments = appData.shipments || [];

        console.log('✓ Data loaded successfully. Exchange rate:', appData.exchangeRate);
    } catch (error) {
        console.error('Error loading data:', error);
        showError('Ошибка при загрузке данных');
    } finally {
        showLoading(false);
    }
}

async function saveData() {
    return new Promise((resolve) => {
        saveQueue.push(resolve);
        processSaveQueue();
    });
}

function processSaveQueue() {
    if (isSaving) return;
    if (saveQueue.length === 0) return;
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        await executeSave();
    }, SAVE_DEBOUNCE_DELAY);
}

async function executeSave(retryCount = 0) {
    const now = Date.now();
    const timeSinceLastSave = now - lastSaveTime;

    if (timeSinceLastSave < MIN_SAVE_INTERVAL) {
        setTimeout(() => executeSave(retryCount), MIN_SAVE_INTERVAL - timeSinceLastSave);
        return;
    }

    isSaving = true;
    showSyncIndicator('syncing');

    try {
        const payload = {
            app_json: JSON.stringify(appData),
            updated_at: new Date().toISOString()
        };

        const { data: existingData, error: checkError } = await supabaseClient
            .from('dashboard_data')
            .select('id')
            .order('id', { ascending: false })
            .limit(1);

        if (checkError && checkError.code !== 'PGRST116') {
            throw new Error('CHECK_ERROR: ' + checkError.message);
        }

        let result;
        if (existingData && existingData.length > 0) {
            result = await supabaseClient
                .from('dashboard_data')
                .update(payload)
                .eq('id', existingData[0].id);
        } else {
            result = await supabaseClient
                .from('dashboard_data')
                .insert([payload]);
        }

        if (result.error) {
            throw new Error('SAVE_ERROR: ' + result.error.message);
        }

        lastSaveTime = Date.now();
        isSaving = false;

        const queue = [...saveQueue];
        saveQueue = [];
        queue.forEach(resolve => resolve(true));

        showSyncIndicator('success');
        console.log('✓ Data saved successfully to Supabase');
        return true;

    } catch (error) {
        console.error('Save error:', error.message);

        const shouldRetry = (
            error.message.includes('SAVE_ERROR') ||
            error.message.includes('CHECK_ERROR') ||
            error.name === 'TypeError' ||
            error.name === 'NetworkError'
        );

        if (shouldRetry && retryCount < MAX_RETRIES) {
            const delay = RETRY_DELAYS[retryCount] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
            console.log(`⟳ Retrying save in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
            showSyncIndicator('syncing', `Повторная попытка ${retryCount + 1}/${MAX_RETRIES}...`);
            isSaving = false;
            await new Promise(resolve => setTimeout(resolve, delay));
            return executeSave(retryCount + 1);
        }

        isSaving = false;
        const queue = [...saveQueue];
        saveQueue = [];
        queue.forEach(resolve => resolve(false));
        showSyncIndicator('error', 'Ошибка синхронизации');
        console.error('✗ Failed to save after', MAX_RETRIES, 'attempts');
        return false;
    }
}

function showSyncIndicator(status = 'syncing', message = '') {
    const indicator = document.getElementById('syncIndicator');
    if (!indicator) return;
    const icon = indicator.querySelector('.sync-icon');
    const text = indicator.querySelector('.sync-text');
    indicator.classList.remove('syncing', 'success', 'error');
    if (status === 'syncing') {
        indicator.classList.add('syncing');
        icon.textContent = '🔄';
        text.textContent = message || 'Сохранение...';
    } else if (status === 'success') {
        indicator.classList.add('success');
        icon.textContent = '✓';
        text.textContent = message || 'Сохранено';
    } else if (status === 'error') {
        indicator.classList.add('error');
        icon.textContent = '⚠';
        text.textContent = message || 'Ошибка синхронизации';
    }
    indicator.classList.add('visible');
    if (status !== 'error') {
        setTimeout(() => { indicator.classList.remove('visible'); }, 3000);
    } else {
        setTimeout(() => { indicator.classList.remove('visible'); }, 5000);
    }
}

// Audit log function
function addToAuditLog(action, entityType, details) {
    const logEntry = {
        id: generateId('audit'),
        timestamp: new Date().toISOString(),
        admin: currentUser,
        action: action,
        entityType: entityType,
        details: details
    };
    appData.auditLog.unshift(logEntry);
    
    if (appData.auditLog.length > 1000) {
        appData.auditLog = appData.auditLog.slice(0, 1000);
    }
}


// ═══════════════════════════════════════════════════════════════
// ФУНКЦИИ БЕКАПА ДАННЫХ
// ═══════════════════════════════════════════════════════════════

// Создать бекап всех данных и скачать как JSON файл
function createBackup() {
    try {
        // Создаем объект бекапа с метаданными
        const backupData = {
            metadata: {
                backupDate: new Date().toISOString(),
                backupVersion: '1.0',
                createdBy: currentUser,
                applicationName: 'OrtoSalon Dashboard'
            },
            data: {
                sales: appData.sales || [],
                expenses: appData.expenses || [],
                employees: appData.employees || [],
                salaryPayments: appData.salaryPayments || [],
                suppliers: appData.suppliers || [],
                supplierPayments: appData.supplierPayments || [],
                purchases: appData.purchases || [],
                auditLog: appData.auditLog || [],
                exchangeRate: appData.exchangeRate || 10.50
            },
            statistics: {
                totalSales: (appData.sales || []).length,
                totalExpenses: (appData.expenses || []).length,
                totalEmployees: (appData.employees || []).length,
                totalSuppliers: (appData.suppliers || []).length
            }
        };

        // Конвертируем в JSON с форматированием
        const jsonString = JSON.stringify(backupData, null, 2);

        // Создаем blob
        const blob = new Blob([jsonString], { type: 'application/json' });

        // Создаем имя файла с датой и временем
        const date = new Date();
        const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
        const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
        const fileName = `ortosalon_backup_${dateStr}_${timeStr}.json`;

        // Создаем ссылку для скачивания
        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(blob);
        downloadLink.download = fileName;

        // Добавляем в DOM, кликаем и удаляем
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);

        // Освобождаем URL
        URL.revokeObjectURL(downloadLink.href);

        // Добавляем запись в журнал аудита
        addToAuditLog('BACKUP_CREATED', 'SYSTEM', {
            fileName: fileName,
            recordsCount: {
                sales: backupData.data.sales.length,
                expenses: backupData.data.expenses.length,
                employees: backupData.data.employees.length,
                suppliers: backupData.data.suppliers.length
            }
        });

        alert(`✅ Бекап успешно создан!\n\nФайл: ${fileName}\n\nВсего записей:\n- Продажи: ${backupData.statistics.totalSales}\n- Расходы: ${backupData.statistics.totalExpenses}\n- Сотрудники: ${backupData.statistics.totalEmployees}\n- Поставщики: ${backupData.statistics.totalSuppliers}`);

        console.log('✓ Backup created successfully:', fileName);
        return true;
    } catch (error) {
        console.error('Error creating backup:', error);
        alert('❌ Ошибка при создании бекапа: ' + error.message);
        return false;
    }
}

// Восстановить данные из бекапа
function restoreFromBackup() {
    // Создаем input элемент для выбора файла
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';

    fileInput.onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        // Проверяем тип файла
        if (!file.name.endsWith('.json')) {
            alert('❌ Пожалуйста, выберите JSON файл бекапа');
            return;
        }

        // Подтверждение от пользователя
        const confirmRestore = confirm(
            `⚠️ ВНИМАНИЕ!\n\nВы собираетесь восстановить данные из бекапа:\n"${file.name}"\n\nЭто действие заменит ВСЕ текущие данные!\n\nПродолжить?`
        );

        if (!confirmRestore) {
            return;
        }

        try {
            showLoading(true);

            // Читаем файл
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const backupData = JSON.parse(e.target.result);

                    // Проверяем структуру бекапа
                    if (!backupData.data) {
                        throw new Error('Неверная структура файла бекапа');
                    }

                    // Сохраняем текущие данные на случай отката
                    const previousData = { ...appData };

                    // Восстанавливаем данные
                    appData.sales = backupData.data.sales || [];
                    appData.expenses = backupData.data.expenses || [];
                    appData.employees = backupData.data.employees || [];
                    appData.salaryPayments = backupData.data.salaryPayments || [];
                    appData.suppliers = backupData.data.suppliers || [];
                    appData.supplierPayments = backupData.data.supplierPayments || [];
                    appData.purchases = backupData.data.purchases || [];
                    appData.auditLog = backupData.data.auditLog || [];
                    appData.exchangeRate = backupData.data.exchangeRate || 10.50;

                    // Сохраняем в JSONBin
                    const saveResult = await saveData();

                    if (saveResult !== false) {
                        // Добавляем запись в журнал аудита
                        addToAuditLog('BACKUP_RESTORED', 'SYSTEM', {
                            fileName: file.name,
                            backupDate: backupData.metadata?.backupDate || 'unknown',
                            restoredBy: currentUser
                        });

                        await saveData(); // Сохраняем запись аудита

                        alert(
                            `✅ Данные успешно восстановлены из бекапа!\n\nФайл: ${file.name}\nДата бекапа: ${backupData.metadata?.backupDate ? new Date(backupData.metadata.backupDate).toLocaleString('ru-RU') : 'неизвестна'}\n\nСтраница будет перезагружена.`
                        );

                        // Перезагружаем страницу для обновления всех данных
                        setTimeout(() => {
                            location.reload();
                        }, 1000);
                    } else {
                        // Откатываем изменения
                        appData = previousData;
                        throw new Error('Не удалось сохранить восстановленные данные');
                    }
                } catch (error) {
                    console.error('Error restoring backup:', error);
                    alert('❌ Ошибка при восстановлении бекапа: ' + error.message);
                } finally {
                    showLoading(false);
                }
            };

            reader.onerror = () => {
                alert('❌ Ошибка при чтении файла');
                showLoading(false);
            };

            reader.readAsText(file);
        } catch (error) {
            console.error('Error in restore process:', error);
            alert('❌ Ошибка: ' + error.message);
            showLoading(false);
        }
    };

    // Триггерим выбор файла
    fileInput.click();
}

// Автоматический бекап (можно вызывать периодически)
function autoBackup() {
    const lastBackup = localStorage.getItem('lastAutoBackup');
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000; // 24 часа в миллисекундах

    // Проверяем, прошло ли 24 часа с последнего автобекапа
    if (!lastBackup || (now - parseInt(lastBackup)) > oneDay) {
        console.log('Creating automatic backup...');
        createBackup();
        localStorage.setItem('lastAutoBackup', now.toString());
    }
}


// Authentication functions
// Применить аккаунт: выставить роль/доступ, показать приложение, отметить роль кассира.
function _applyAccount(account) {
    currentUser = account.displayName;
    currentAllowedTabs = account.allowedTabs || '*';
    currentAllowedKassa = account.allowedKassa || null;
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    document.getElementById('currentUser').textContent = currentUser;
    // Класс роли кассира на <body>: только у него центрируем вкладки.
    // Кассир = не админ (allowedTabs с ограничениями), без доступа к expenses/products и т.п.
    const isCashier = currentAllowedTabs !== '*' &&
        Array.isArray(currentAllowedTabs) && currentAllowedTabs.includes('cashier') &&
        !currentAllowedTabs.includes('expenses');
    document.body.classList.toggle('role-cashier', !!isCashier);
}

function login(username, password) {
    // Точное совпадение, иначе — поиск без учёта регистра (удобно для логинов вроде kassir/Kassir/KASSIR)
    let account = ADMIN_ACCOUNTS[username];
    if (!account && username) {
        const key = Object.keys(ADMIN_ACCOUNTS).find(
            k => k.toLowerCase() === String(username).trim().toLowerCase()
        );
        if (key) account = ADMIN_ACCOUNTS[key];
    }
    if (account && account.password === String(password).trim()) {
        // вычисляем канонический ключ аккаунта (для сохранения сессии)
        const acctKey = Object.keys(ADMIN_ACCOUNTS).find(k => ADMIN_ACCOUNTS[k] === account) || username;
        _applyAccount(account);
        // ЗАПОМИНАЕМ ВХОД: сохраняем только ключ аккаунта (НЕ пароль).
        // При следующем открытии касса войдёт автоматически.
        try { localStorage.setItem('ortoSession', acctKey); } catch (_) {}
        applyTabAccess();

        loadData().then(() => {
            loadSales1C().then(() => updateDashboard());
            loadEmployeeSales1C();
            updateDashboard();
            loadAllTables();
	
	 // Обновить поле курса обмена если оно есть
            const exchangeRateInput = document.getElementById('exchangeRateInput');
            if (exchangeRateInput) {
                exchangeRateInput.value = appData.exchangeRate;
            }
        });
        return true;
    }
    return false;
}

function logout() {
    currentUser = null;
    currentAllowedTabs = '*';
    currentAllowedKassa = null;
    // Сбрасываем состояние РМК, чтобы следующий аккаунт загрузил кассы заново
    // (иначе останется отфильтрованный список предыдущего магазина).
    if (typeof POS !== 'undefined') {
        POS.loaded = false;
        POS.kassas = [];
        POS.sellers = [];
        POS.chosen = null;
        POS.shift = null;
    }
    // ЗАБЫВАЕМ СЕССИЮ: после выхода автовхода не будет — можно зайти под другим аккаунтом.
    try { localStorage.removeItem('ortoSession'); } catch (_) {}
    document.body.classList.remove('role-cashier');
    resetTabAccess();
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('loginForm').reset();
}

// Автовход по сохранённой сессии (вызывается при загрузке страницы).
// Возвращает true, если успешно вошли без запроса логина/пароля.
function restoreSession() {
    let acctKey = null;
    try { acctKey = localStorage.getItem('ortoSession'); } catch (_) {}
    if (!acctKey) return false;
    const account = ADMIN_ACCOUNTS[acctKey];
    if (!account) { try { localStorage.removeItem('ortoSession'); } catch (_) {} return false; }
    _applyAccount(account);
    applyTabAccess();
    loadData().then(() => {
        loadSales1C().then(() => updateDashboard());
        loadEmployeeSales1C();
        updateDashboard();
        loadAllTables();
        const exchangeRateInput = document.getElementById('exchangeRateInput');
        if (exchangeRateInput) exchangeRateInput.value = appData.exchangeRate;
    });
    return true;
}

// Navigation functions

// Скрыть кнопки недоступных вкладок и открыть первую доступную.
// Для админов (allowedTabs === '*') показываем всё и не меняем активную вкладку.
function applyTabAccess() {
    const tabs = document.querySelectorAll('.nav-tab');
    if (currentAllowedTabs === '*') {
        tabs.forEach(tab => { tab.style.display = ''; });
        return;
    }
    let firstAllowed = null;
    tabs.forEach(tab => {
        if (isTabAllowed(tab.dataset.tab)) {
            tab.style.display = '';
            if (!firstAllowed) firstAllowed = tab.dataset.tab;
        } else {
            tab.style.display = 'none';
        }
    });
    if (firstAllowed) switchTab(firstAllowed);
}

// Вернуть все кнопки навигации в видимое состояние (после logout).
function resetTabAccess() {
    document.querySelectorAll('.nav-tab').forEach(tab => { tab.style.display = ''; });
}

function switchTab(tabName) {
    if (!isTabAllowed(tabName)) return;

    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });

    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.remove('active');
    });

    document.getElementById(tabName + 'Section').classList.add('active');
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Мобильный оверлей кассы живёт только на вкладке «Касса».
    if (typeof pmobApply === 'function') pmobApply();

    if (tabName === 'dashboard') {
        updateDashboard();
    } else if (tabName === 'suppliers') {
        updateDebtSummary();
        loadSuppliersTable();
        populateSupplierSelects();
        loadSupplierPaymentsHistory();
    } else if (tabName === 'salaries') {
        populateEmployeeSelect();
    if (typeof populateCalcEmployeeSelect === 'function') populateCalcEmployeeSelect();
    } else if (tabName === 'shipments') {
        if (typeof renderShipments === 'function') renderShipments();
    } else if (tabName === 'cards1c') {
        if (typeof loadCards1C === 'function') loadCards1C();
    } else if (tabName === 'aiInsights') {
        if (typeof loadAiInsights === 'function') loadAiInsights();
    } else if (tabName === 'products') {
        if (typeof loadProducts === 'function') loadProducts();
    } else if (tabName === 'barcodes') {
        if (typeof loadBarcodes === 'function') loadBarcodes();
    } else if (tabName === 'anomalies') {
        if (typeof loadAnomalies === 'function') loadAnomalies();
    } else if (tabName === 'cashier') {
        if (typeof loadCashier === 'function') loadCashier();
    } else if (tabName === 'pos') {
        if (typeof loadPos === 'function') loadPos();
    } else if (tabName === 'posHistory') {
        if (typeof loadPosHistory === 'function') loadPosHistory();
    } else if (tabName === 'salesReports') {
        if (typeof loadSalesReports === 'function') loadSalesReports();
    } else if (tabName === 'settings') {
        if (typeof loadSyncStatus === 'function') loadSyncStatus();
    }
}

function switchSectionTab(sectionName, tabName) {
    const section = document.getElementById(sectionName + 'Section');
    if (!section) return;

    section.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    section.querySelectorAll('.section-tab').forEach(tab => {
        tab.classList.remove('active');
    });

    const tabEl = document.getElementById(tabName + 'Tab');
    if (tabEl) tabEl.classList.add('active');
    const btnEl = section.querySelector(`[data-section="${tabName}"]`);
    if (btnEl) btnEl.classList.add('active');

    // Специфичный рендер при переключении подразделов
    if (sectionName === 'shipments' && typeof renderShipments === 'function') {
        renderShipments();
    }
    if (sectionName === 'salaries' && tabName === 'salesSalary' && typeof loadSalesSalarySection === 'function') {
        loadSalesSalarySection();
    }
}

// Dashboard functions
function updateDashboard() {
    const today = new Date();
	const endOfYesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate()); // сегодня в 00:00
    const startOf3DaysAgo = new Date(endOfYesterday.getTime() - 3 * 24 * 60 * 60 * 1000);
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startOfWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // Выручка берётся из реальных данных 1С (sales_daily_1c, net_sales).
    // Если данные 1С ещё не загружены — временный фолбэк на продажи из Excel,
    // чтобы карточки не были пустыми; после загрузки updateDashboard() вызовется снова.
    let last3DaysRevenue, weekRevenue, monthRevenue, totalRevenue;
    if (sales1CLoaded) {
        // "за 3 дня" = три полных прошедших дня (как было: [3 дня назад; сегодня 00:00))
        const end3 = new Date(endOfYesterday.getTime() - 24 * 60 * 60 * 1000); // вчера
        last3DaysRevenue = sumNet1C(startOf3DaysAgo, end3);
        weekRevenue = sumNet1C(startOfWeek, today);
        monthRevenue = sumNet1C(startOfMonth, today);
        totalRevenue = sales1C.reduce((sum, s) => sum + s.net, 0);
    } else {
        last3DaysRevenue = appData.sales
            .filter(sale => { const d = new Date(sale.date); return d >= startOf3DaysAgo && d < endOfYesterday; })
            .reduce((sum, sale) => sum + parseFloat(sale.amount), 0);
        weekRevenue = appData.sales
            .filter(sale => new Date(sale.date) >= startOfWeek)
            .reduce((sum, sale) => sum + parseFloat(sale.amount), 0);
        monthRevenue = appData.sales
            .filter(sale => new Date(sale.date) >= startOfMonth)
            .reduce((sum, sale) => sum + parseFloat(sale.amount), 0);
        totalRevenue = appData.sales.reduce((sum, sale) => sum + parseFloat(sale.amount), 0);
    }
    const netProfit = totalRevenue * 0.3;

    document.getElementById('todayRevenue').textContent = formatCurrency(last3DaysRevenue);
    document.getElementById('weekRevenue').textContent = formatCurrency(weekRevenue);
    document.getElementById('monthRevenue').textContent = formatCurrency(monthRevenue);
    document.getElementById('netProfit').textContent = formatCurrency(netProfit);

    if (typeof renderDashboardSalonRevenue1C === 'function') renderDashboardSalonRevenue1C();

    rolloverFixedExpensesIfNeeded().then(() => renderDashboardFixedExpenses());
    if (typeof renderDashboardDailySales === 'function') renderDashboardDailySales();
    if (typeof renderDashboardShipments === 'function') renderDashboardShipments();

    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const reportFromDate = document.getElementById('reportFromDate');
    const reportToDate = document.getElementById('reportToDate');
    
    if (reportFromDate) {
        reportFromDate.valueAsDate = firstDay;
    }
    if (reportToDate) {
        reportToDate.valueAsDate = today;
    }

    generateReport();
}

// Sales functions (остаются без изменений)
function handleFileUpload() {
    const fileInput = document.getElementById('fileInput');
    const file = fileInput.files[0];

    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            parseSalesData(jsonData);
        } catch (error) {
            console.error('Error parsing file:', error);
            alert('Ошибка при чтении файла. Убедитесь, что файл имеет правильный формат.');
        }
    };
    reader.readAsArrayBuffer(file);
}

function parseSalesData(data) {
    const salesData = [];
    let currentSalon = null;

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length === 0) continue;

        const cell0 = String(row[0] || '').trim();

        if (cell0.includes('Ортосалон')) {
            currentSalon = cell0;
            continue;
        }

        const dateMatch = cell0.match(/\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2}/);
        if (dateMatch && currentSalon && row[3] !== undefined && row[3] !== null && row[3] !== '') {
            const dateStr = dateMatch[0].split(' ')[0];
            const amount = parseFloat(row[3]);
            
            if (!isNaN(amount) && amount > 0) {
                salesData.push({
                    salon: currentSalon,
                    date: convertDateFormat(dateStr),
                    amount: amount
                });
            }
        }
    }

    if (salesData.length === 0) {
        alert('Не найдено данных для импорта. Проверьте формат файла.');
        return;
    }

    showPreview(salesData);
}

function convertDateFormat(dateStr) {
    const parts = dateStr.split('.');
    if (parts.length === 3) {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    return dateStr;
}

function showPreview(salesData) {
    const previewTable = document.querySelector('#previewTable tbody');
    previewTable.innerHTML = salesData.map(sale => `
        <tr>
            <td>${sale.salon}</td>
            <td>${formatDate(sale.date)}</td>
            <td>${formatCurrency(sale.amount)}</td>
        </tr>
    `).join('');

    document.getElementById('filePreview').style.display = 'block';
    document.getElementById('filePreview').scrollIntoView({ behavior: 'smooth' });
    
    window.parsedSalesData = salesData;
}

async function confirmImport() {
    if (!window.parsedSalesData || window.parsedSalesData.length === 0) {
        alert('Нет данных для импорта.');
        return;
    }

    showLoading(true);
    try {
        const timestamp = new Date().toISOString();
        window.parsedSalesData.forEach(saleData => {
            const sale = {
                id: generateId('sale'),
                salon: saleData.salon,
                date: saleData.date,
                amount: saleData.amount,
                addedBy: 'import',
                timestamp: timestamp
            };
            appData.sales.push(sale);
        });

        addToAuditLog('Добавлено', 'Продажа', `${window.parsedSalesData.length} продаж`);
        await saveData();

        document.getElementById('fileInput').value = '';
        document.getElementById('filePreview').style.display = 'none';
        window.parsedSalesData = null;

        loadAllSalesTable();
        updateDashboard();
        alert(`Импортировано ${window.parsedSalesData ? window.parsedSalesData.length : 0} продаж!`);
    } catch (error) {
        console.error('Error importing data:', error);
        alert('Ошибка при импорте данных.');
    } finally {
        showLoading(false);
    }
}

function cancelImport() {
    document.getElementById('fileInput').value = '';
    document.getElementById('filePreview').style.display = 'none';
    window.parsedSalesData = null;
}

async function addSale(event) {
    event.preventDefault();

    const salon = document.getElementById('salonSelect').value;
    const date = document.getElementById('saleDate').value;
    const amount = parseFloat(document.getElementById('saleAmount').value);

    if (!salon || !date || isNaN(amount) || amount <= 0) {
        alert('Пожалуйста, заполните все поля корректно.');
        return;
    }

    const sale = {
        id: generateId('sale'),
        salon: salon,
        date: date,
        amount: amount,
        addedBy: currentUser,
        timestamp: new Date().toISOString()
    };

    appData.sales.push(sale);
    addToAuditLog('Добавлено', 'Продажа', `${salon} - ${formatCurrency(amount)}`);
    await saveData();

    document.getElementById('addSaleForm').reset();
    loadAllSalesTable();
    updateDashboard();
    alert('Продажа добавлена!');
}

function loadAllSalesTable() {
    const tbody = document.querySelector('#allSalesTable tbody');
    const sortedSales = appData.sales.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    tbody.innerHTML = sortedSales.map(sale => `
        <tr>
            <td>${sale.id.slice(-8)}</td>
            <td>${sale.salon}</td>
            <td>${formatDate(sale.date)}</td>
            <td>${formatCurrency(sale.amount)}</td>
            <td>${sale.addedBy}</td>
            <td>${formatDateTime(sale.timestamp)}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-danger btn-sm" onclick="deleteSale('${sale.id}')">Удалить</button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function deleteSale(saleId) {
    if (!confirm('Вы уверены, что хотите удалить эту продажу?')) return;

    const saleIndex = appData.sales.findIndex(sale => sale.id === saleId);
    if (saleIndex === -1) {
        alert('Продажа не найдена.');
        return;
    }

    const sale = appData.sales[saleIndex];
    appData.sales.splice(saleIndex, 1);
    addToAuditLog('Удалено', 'Продажа', `${sale.salon} - ${formatCurrency(sale.amount)}`);
    await saveData();

    loadAllSalesTable();
    updateDashboard();
    alert('Продажа удалена.');
}

// Expenses functions (остаются без изменений)
async function addExpense(event) {
    event.preventDefault();

    const salon = document.getElementById('expenseSalon').value;
    const category = document.getElementById('expenseCategory').value;
    const customCategory = document.getElementById('customCategory').value;
    const name = document.getElementById('expenseName').value;
    const amount = parseFloat(document.getElementById('expenseAmount').value);
    const date = document.getElementById('expenseDate').value;
    const description = document.getElementById('expenseDescription').value;

    const finalCategory = category === 'Другое' ? customCategory : category;

    if (!salon || !finalCategory || !name || !date || isNaN(amount) || amount <= 0) {
        alert('Пожалуйста, заполните все обязательные поля.');
        return;
    }

    const expense = {
        id: generateId('expense'),
        salon: salon,
        name: name,
        category: finalCategory,
        amount: amount,
        date: date,
        description: description,
        addedBy: currentUser,
        timestamp: new Date().toISOString()
    };

    appData.expenses.push(expense);
    addToAuditLog('Добавлено', 'Расход', `${salon} - ${name} - ${formatCurrency(amount)}`);
    await saveData();

    document.getElementById('addExpenseForm').reset();
    document.getElementById('customCategoryGroup').style.display = 'none';
    loadExpensesTable();
    updateDashboard();
    alert('Расход добавлен!');
}

function loadExpensesTable() {
    const tbody = document.querySelector('#expensesTable tbody');

    // Get filter values
    const filterSalon = document.getElementById('filterExpenseSalon')?.value || '';
    const filterCategory = document.getElementById('filterExpenseCategory')?.value || '';

    // Filter expenses
    let filteredExpenses = appData.expenses;

    if (filterSalon) {
        filteredExpenses = filteredExpenses.filter(expense => expense.salon === filterSalon);
    }

    if (filterCategory) {
        filteredExpenses = filteredExpenses.filter(expense => expense.category === filterCategory);
    }

    const sortedExpenses = filteredExpenses.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    tbody.innerHTML = sortedExpenses.map(expense => `
        <tr>
            <td>${expense.id.slice(-8)}</td>
            <td>${expense.salon}</td>
            <td>${expense.name || '-'}</td>
            <td>${expense.category}</td>
            <td>${formatCurrency(expense.amount)}</td>
            <td>${expense.description || '-'}</td>
            <td>${formatDate(expense.date)}</td>
            <td>${expense.addedBy}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-danger btn-sm" onclick="deleteExpense('${expense.id}')">Удалить</button>
                </div>
            </td>
        </tr>
    `).join('');

    // Update summary cards
    updateExpensesSummary();
}

function updateExpensesSummary() {
    // Calculate expenses by salon
    const expensesBySalon = {
        'Ортосалон СитиМолл': 0,
        'Ортосалон Сиема': 0,
        'Ортосалон Баракат': 0,
        'Ортосалон Айни': 0,
        'Общие': 0
    };

    appData.expenses.forEach(expense => {
        if (expensesBySalon.hasOwnProperty(expense.salon)) {
            expensesBySalon[expense.salon] += parseFloat(expense.amount);
        }
    });

    const totalExpenses = Object.values(expensesBySalon).reduce((sum, amount) => sum + amount, 0);

    // Update UI
    document.getElementById('expenseMunisa').textContent = formatCurrency(expensesBySalon['Ортосалон СитиМолл']);
    document.getElementById('expenseSiema').textContent = formatCurrency(expensesBySalon['Ортосалон Сиема']);
    document.getElementById('expenseBarakat').textContent = formatCurrency(expensesBySalon['Ортосалон Баракат']);
    document.getElementById('expenseAini').textContent = formatCurrency(expensesBySalon['Ортосалон Айни']);
    document.getElementById('expenseObshie').textContent = formatCurrency(expensesBySalon['Общие']);
    document.getElementById('expenseTotal').textContent = formatCurrency(totalExpenses);
}

async function deleteExpense(expenseId) {
    if (!confirm('Вы уверены, что хотите удалить этот расход?')) return;

    const expenseIndex = appData.expenses.findIndex(expense => expense.id === expenseId);
    if (expenseIndex === -1) {
        alert('Расход не найден.');
        return;
    }

    const expense = appData.expenses[expenseIndex];
    appData.expenses.splice(expenseIndex, 1);
    addToAuditLog('Удалено', 'Расход', `${expense.category} - ${formatCurrency(expense.amount)}`);
    await saveData();

    loadExpensesTable();
    alert('Расход удалён.');
}

// Employee functions (остаются без изменений)
function showAddEmployeeModal() {
    document.getElementById('employeeForm').reset();
    document.getElementById('modalOverlay').style.display = 'flex';
    document.getElementById('addEmployeeModal').style.display = 'block';
}

async function saveEmployee() {
    const name = document.getElementById('employeeName').value;
    const position = document.getElementById('employeePosition').value;
    const salary = parseFloat(document.getElementById('employeeSalary').value);
    const commission = parseFloat(document.getElementById('employeeCommission').value);
    const walletEl = document.getElementById('employeeWallet');
    const wallet = walletEl ? walletEl.value.trim() : '';

    if (!name || !position || isNaN(salary) || isNaN(commission) || salary < 0 || commission < 0 || commission > 100) {
        alert('Пожалуйста, заполните все поля корректно.');
        return;
    }

    const employee = {
        id: generateId('employee'),
        name: name,
        position: position,
        salary: salary,
        commission: commission,
        wallet: wallet,
        addedBy: currentUser,
        timestamp: new Date().toISOString()
    };

    appData.employees.push(employee);
    addToAuditLog('Добавлено', 'Сотрудник', `${name} - ${position}`);
    await saveData();

    hideModal();
    loadEmployeesTable();
    populateEmployeeSelect();
    if (typeof populateCalcEmployeeSelect === 'function') populateCalcEmployeeSelect();
    alert('Сотрудник добавлен!');
}

function loadEmployeesTable() {
    const tbody = document.querySelector('#employeesTable tbody');
    tbody.innerHTML = appData.employees.map(employee => {
        const walletDisplay = employee.wallet || '';
        const walletCellHtml = employee.wallet
            ? `<span class="wallet-chip" onclick="copyWalletToClipboard(event, this, '${escapeHtml(employee.wallet).replace(/'/g, "\\'")}')" title="Клик — скопировать">
                <span class="wallet-chip-text">${escapeHtml(employee.wallet)}</span>
                <span class="wallet-chip-icon">📋</span>
               </span>`
            : `<span class="wallet-empty">не указан</span>`;
        return `
        <tr data-emp-id="${employee.id}">
            <td>${employee.id.slice(-8)}</td>
            <td>${escapeHtml(employee.name)}</td>
            <td>${escapeHtml(employee.position)}</td>
            <td class="editable-cell"
                contenteditable="true"
                data-field="salary"
                data-emp-id="${employee.id}"
                title="Клик — редактировать"
                onblur="saveEmployeeField(this)"
                onkeydown="handleEditableKey(event)"
                onfocus="selectAllText(this)"
            >${formatCurrency(employee.salary)}</td>
            <td class="editable-cell"
                contenteditable="true"
                data-field="commission"
                data-emp-id="${employee.id}"
                title="Клик — редактировать"
                onblur="saveEmployeeField(this)"
                onkeydown="handleEditableKey(event)"
                onfocus="selectAllText(this)"
            >${employee.commission}%</td>
            <td class="editable-cell wallet-cell"
                data-field="wallet"
                data-emp-id="${employee.id}"
                data-wallet="${escapeHtml(walletDisplay)}">
                <span class="wallet-display">${walletCellHtml}</span>
                <button class="wallet-edit-btn" title="Изменить" onclick="startWalletEdit(this)">✏️</button>
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-danger btn-sm" onclick="deleteEmployee('${employee.id}')">Удалить</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function populateEmployeeSelect() {
    const select = document.getElementById('employeeSelect');
    const currentValue = select.value;

    select.innerHTML = '<option value="">Выберите сотрудника</option>' +
        appData.employees.map(employee => 
            `<option value="${employee.id}">${employee.name} - ${employee.position}</option>`
        ).join('');

    if (currentValue) select.value = currentValue;
}

async function deleteEmployee(employeeId) {
    if (!confirm('Вы уверены, что хотите удалить этого сотрудника?')) return;

    const employeeIndex = appData.employees.findIndex(employee => employee.id === employeeId);
    if (employeeIndex === -1) {
        alert('Сотрудник не найден.');
        return;
    }

    const employee = appData.employees[employeeIndex];
    appData.employees.splice(employeeIndex, 1);
    addToAuditLog('Удалено', 'Сотрудник', `${employee.name} - ${employee.position}`);
    await saveData();

    loadEmployeesTable();
    populateEmployeeSelect();
    if (typeof populateCalcEmployeeSelect === 'function') populateCalcEmployeeSelect();
    alert('Сотрудник удалён.');
}

// Salary payment functions (остаются без изменений)
async function addSalaryPayment(event) {
    event.preventDefault();

    const employeeId = document.getElementById('employeeSelect').value;
    const paymentType = document.getElementById('paymentType').value;
    const amount = parseFloat(document.getElementById('paymentAmount').value);
    const date = document.getElementById('paymentDate').value;

    if (!employeeId || !paymentType || !date || isNaN(amount) || amount <= 0) {
        alert('Пожалуйста, заполните все поля корректно.');
        return;
    }

    const employee = appData.employees.find(emp => emp.id === employeeId);
    if (!employee) {
        alert('Сотрудник не найден.');
        return;
    }

    const payment = {
        id: generateId('salary'),
        employeeId: employeeId,
        employeeName: employee.name,
        type: paymentType,
        typeLabel: paymentType === 'base' ? 'Оклад (15-е)' : 'Процент (31-е)',
        amount: amount,
        date: date,
        addedBy: currentUser,
        timestamp: new Date().toISOString()
    };

    appData.salaryPayments.push(payment);
    addToAuditLog('Добавлено', 'Выплата зарплаты', `${employee.name} - ${payment.typeLabel} - ${formatCurrency(amount)}`);
    await saveData();

    document.getElementById('addSalaryPaymentForm').reset();
    loadSalaryPaymentsTable();
    alert('Выплата добавлена!');
}

function loadSalaryPaymentsTable() {
    const tbody = document.querySelector('#salaryPaymentsTable tbody');
    const sortedPayments = appData.salaryPayments.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    tbody.innerHTML = sortedPayments.map(payment => `
        <tr>
            <td>${payment.id.slice(-8)}</td>
            <td>${payment.employeeName}</td>
            <td>${payment.typeLabel}</td>
            <td>${formatCurrency(payment.amount)}</td>
            <td>${formatDate(payment.date)}</td>
            <td>${payment.addedBy}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-danger btn-sm" onclick="deleteSalaryPayment('${payment.id}')">Удалить</button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function deleteSalaryPayment(paymentId) {
    if (!confirm('Вы уверены, что хотите удалить эту выплату?')) return;

    const paymentIndex = appData.salaryPayments.findIndex(payment => payment.id === paymentId);
    if (paymentIndex === -1) {
        alert('Выплата не найдена.');
        return;
    }

    const payment = appData.salaryPayments[paymentIndex];
    appData.salaryPayments.splice(paymentIndex, 1);
    addToAuditLog('Удалено', 'Выплата зарплаты', `${payment.employeeName} - ${payment.typeLabel} - ${formatCurrency(payment.amount)}`);
    await saveData();

    loadSalaryPaymentsTable();
    alert('Выплата удалена.');
}

// Supplier functions - ОБНОВЛЕНО ДЛЯ ПОДДЕРЖКИ USD
function showAddSupplierModal() {
    document.getElementById('supplierForm').reset();
    document.getElementById('modalOverlay').style.display = 'flex';
    document.getElementById('addSupplierModal').style.display = 'block';
}

async function saveSupplier() {
    const name = document.getElementById('supplierName').value;
    const country = document.getElementById('supplierCountry').value;
    const initialDebtTJS = parseFloat(document.getElementById('supplierInitialDebt').value);

    if (!name || !country || isNaN(initialDebtTJS) || initialDebtTJS < 0) {
        alert('Пожалуйста, заполните все поля корректно.');
        return;
    }

    const supplier = {
        id: generateId('supplier'),
        name: name,
        country: country,
        debt: initialDebtTJS,
        debtUSD: convertTJStoUSD(initialDebtTJS),
        addedBy: currentUser,
        timestamp: new Date().toISOString()
    };

    appData.suppliers.push(supplier);
    addToAuditLog('Добавлено', 'Поставщик', `${name} (${COUNTRIES[country].name}) - ${formatCurrency(initialDebtTJS)}`);
    await saveData();

    hideModal();
    loadSuppliersTable();
    populateSupplierSelects();
    updateDebtSummary();
    alert('Поставщик добавлен!');
}

function loadSuppliersTable() {
    const tbody = document.querySelector('#suppliersTable tbody');
    tbody.innerHTML = appData.suppliers.map(supplier => `
        <tr>
            <td>${supplier.id.slice(-8)}</td>
            <td>${supplier.name}</td>
            <td>${COUNTRIES[supplier.country].flag} ${COUNTRIES[supplier.country].name}</td>
            <td>
                <div>${formatCurrency(supplier.debt)}</div>
                <div style="font-size: 0.85em; color: #666;">${formatCurrencyUSD(supplier.debtUSD || 0)}</div>
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-primary btn-sm" onclick="showSupplierPaymentModal('${supplier.id}')">Выплата</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteSupplier('${supplier.id}')">Удалить</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function updateDebtSummary() {
    const debtByCountry = {};
    const debtByCountryUSD = {};
    let totalDebt = 0;
    let totalDebtUSD = 0;

    Object.keys(COUNTRIES).forEach(countryCode => {
        debtByCountry[countryCode] = 0;
        debtByCountryUSD[countryCode] = 0;
    });

    appData.suppliers.forEach(supplier => {
        debtByCountry[supplier.country] += supplier.debt;
        debtByCountryUSD[supplier.country] += (supplier.debtUSD || 0);
        totalDebt += supplier.debt;
        totalDebtUSD += (supplier.debtUSD || 0);
    });

    document.getElementById('debtTJ').innerHTML = `${formatCurrency(debtByCountry.TJ)}<br><span style="font-size: 0.85em; opacity: 0.7;">${formatCurrencyUSD(debtByCountryUSD.TJ)}</span>`;
    document.getElementById('debtRU').innerHTML = `${formatCurrency(debtByCountry.RU)}<br><span style="font-size: 0.85em; opacity: 0.7;">${formatCurrencyUSD(debtByCountryUSD.RU)}</span>`;
    document.getElementById('debtTR').innerHTML = `${formatCurrency(debtByCountry.TR)}<br><span style="font-size: 0.85em; opacity: 0.7;">${formatCurrencyUSD(debtByCountryUSD.TR)}</span>`;
    document.getElementById('debtCN').innerHTML = `${formatCurrency(debtByCountry.CN)}<br><span style="font-size: 0.85em; opacity: 0.7;">${formatCurrencyUSD(debtByCountryUSD.CN)}</span>`;
    document.getElementById('totalDebt').innerHTML = `${formatCurrency(totalDebt)}<br><span style="font-size: 0.85em; opacity: 0.7;">${formatCurrencyUSD(totalDebtUSD)}</span>`;
}

function populateSupplierSelects() {
    const select = document.getElementById('supplierSelect');
    const currentValue = select.value;

    select.innerHTML = '<option value="">Выберите поставщика</option>' +
        appData.suppliers.map(supplier => 
            `<option value="${supplier.id}">${supplier.name} (${COUNTRIES[supplier.country].flag})</option>`
        ).join('');

    if (currentValue) select.value = currentValue;
}

function showSupplierPaymentModal(supplierId) {
    const supplier = appData.suppliers.find(s => s.id === supplierId);
    if (!supplier) {
        alert('Поставщик не найден.');
        return;
    }

    document.getElementById('paymentSupplierName').textContent = supplier.name;
    document.getElementById('paymentCurrentDebt').innerHTML = `${formatCurrency(supplier.debt)}<br><span style="font-size: 0.9em; opacity: 0.8;">${formatCurrencyUSD(supplier.debtUSD || 0)}</span>`;
    document.getElementById('supplierPaymentForm').reset();
    document.getElementById('supplierPaymentDate').value = new Date().toISOString().split('T')[0];

    document.getElementById('supplierPaymentModal').dataset.supplierId = supplierId;
    document.getElementById('modalOverlay').style.display = 'flex';
    document.getElementById('supplierPaymentModal').style.display = 'block';
}

async function confirmSupplierPayment() {
    const supplierId = document.getElementById('supplierPaymentModal').dataset.supplierId;
    const amount = parseFloat(document.getElementById('supplierPaymentAmount').value);
    const date = document.getElementById('supplierPaymentDate').value;
    const currency = document.getElementById('supplierPaymentCurrency').value;
    const commission = parseFloat(document.getElementById('supplierPaymentCommission').value) || 0;
    const paymentMethod = document.getElementById('supplierPaymentMethod').value;

    if (!amount || isNaN(amount) || amount <= 0 || !date || !paymentMethod) {
        alert('Пожалуйста, заполните все обязательные поля корректно.');
        return;
    }

    const supplier = appData.suppliers.find(s => s.id === supplierId);
    if (!supplier) {
        alert('Поставщик не найден.');
        return;
    }

    let amountTJS, amountUSD;

    if (currency === 'TJS') {
        amountTJS = amount;
        amountUSD = convertTJStoUSD(amount);
    } else {
        amountUSD = amount;
        amountTJS = convertUSDtoTJS(amount);
    }

    if (amountTJS > supplier.debt) {
        alert(`Сумма выплаты (${formatCurrency(amountTJS)}) превышает текущий долг (${formatCurrency(supplier.debt)}).`);
        return;
    }

    const payment = {
        id: generateId('supplierpayment'),
        supplierId: supplierId,
        supplierName: supplier.name,
        amount: amountTJS,
        amountUSD: amountUSD,
        currency: currency,
        commission: commission,
        paymentMethod: paymentMethod,
        date: date,
        addedBy: currentUser,
        timestamp: new Date().toISOString()
    };

    appData.supplierPayments.push(payment);
    supplier.debt -= amountTJS;
    supplier.debtUSD -= amountUSD;

    addToAuditLog('Добавлено', 'Выплата поставщику', `${supplier.name} - ${formatCurrency(amountTJS)} / ${formatCurrencyUSD(amountUSD)} (${paymentMethod})`);
    await saveData();

    hideModal();
    loadSuppliersTable();
    loadSupplierPaymentsHistory();
    updateDebtSummary();
    alert('Выплата добавлена!');
}
async function deleteSupplier(supplierId) {
    if (!confirm('Вы уверены, что хотите удалить этого поставщика?')) return;

    const supplierIndex = appData.suppliers.findIndex(supplier => supplier.id === supplierId);
    if (supplierIndex === -1) {
        alert('Поставщик не найден.');
        return;
    }

    const supplier = appData.suppliers[supplierIndex];
    appData.suppliers.splice(supplierIndex, 1);
    
    appData.supplierPayments = appData.supplierPayments.filter(payment => payment.supplierId !== supplierId);
    appData.purchases = appData.purchases.filter(purchase => purchase.supplierId !== supplierId);

    addToAuditLog('Удалено', 'Поставщик', supplier.name);
    await saveData();

    loadSuppliersTable();
    populateSupplierSelects();
    updateDebtSummary();
    alert('Поставщик удалён.');
}


// Supplier payment history functions
function loadSupplierPaymentsHistory(filterFromDate = null, filterToDate = null) {
    const tbody = document.querySelector('#supplierPaymentsHistoryTable tbody');

    let payments = [...appData.supplierPayments];

    // Apply date filtering
    if (filterFromDate || filterToDate) {
        payments = payments.filter(payment => {
            const paymentDate = new Date(payment.date);
            const fromDate = filterFromDate ? new Date(filterFromDate) : null;
            const toDate = filterToDate ? new Date(filterToDate) : null;

            if (fromDate && paymentDate < fromDate) return false;
            if (toDate && paymentDate > toDate) return false;
            return true;
        });
    }

    // Sort by date descending (most recent first)
    payments.sort((a, b) => new Date(b.date) - new Date(a.date));

    tbody.innerHTML = payments.map(payment => {
        const displayAmount = payment.currency === 'USD' 
            ? `${formatCurrencyUSD(payment.amountUSD || payment.amount)}`
            : `${formatCurrency(payment.amount)}`;
        const displayCommission = payment.commission 
            ? (payment.currency === 'USD' ? formatCurrencyUSD(payment.commission) : formatCurrency(payment.commission))
            : '0';

        return `
            <tr>
                <td>${payment.id.slice(-8)}</td>
                <td>${formatDate(payment.date)}</td>
                <td>${payment.supplierName}</td>
                <td>${displayAmount}</td>
                <td>${displayCommission}</td>
                <td>${payment.paymentMethod || '—'}</td>
                <td>${payment.addedBy}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn btn-sm btn-secondary" onclick="showEditPaymentModal('${payment.id}')">Редактировать</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteSupplierPayment('${payment.id}')">Удалить</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    if (payments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px; color: #999;">Нет выплат для отображения</td></tr>';
    }
}

function showEditPaymentModal(paymentId) {
    const payment = appData.supplierPayments.find(p => p.id === paymentId);
    if (!payment) {
        alert('Выплата не найдена.');
        return;
    }

    // Fill the form with current payment data
    document.getElementById('editPaymentAmount').value = payment.currency === 'USD' ? payment.amountUSD : payment.amount;
    document.getElementById('editPaymentCurrency').value = payment.currency || 'TJS';
    document.getElementById('editPaymentCommission').value = payment.commission || 0;
    document.getElementById('editPaymentMethod').value = payment.paymentMethod || '';
    document.getElementById('editPaymentDate').value = payment.date;

    // Store the payment ID in the modal
    document.getElementById('editPaymentModal').dataset.paymentId = paymentId;

    // Show the modal
    document.getElementById('modalOverlay').style.display = 'flex';
    document.getElementById('editPaymentModal').style.display = 'block';
}

async function confirmEditPayment() {
    const paymentId = document.getElementById('editPaymentModal').dataset.paymentId;
    const payment = appData.supplierPayments.find(p => p.id === paymentId);

    if (!payment) {
        alert('Выплата не найдена.');
        return;
    }

    const newAmount = parseFloat(document.getElementById('editPaymentAmount').value);
    const newCurrency = document.getElementById('editPaymentCurrency').value;
    const newCommission = parseFloat(document.getElementById('editPaymentCommission').value) || 0;
    const newPaymentMethod = document.getElementById('editPaymentMethod').value;
    const newDate = document.getElementById('editPaymentDate').value;

    if (!newAmount || isNaN(newAmount) || newAmount <= 0 || !newPaymentMethod || !newDate) {
        alert('Пожалуйста, заполните все обязательные поля корректно.');
        return;
    }

    // Get the supplier
    const supplier = appData.suppliers.find(s => s.id === payment.supplierId);
    if (!supplier) {
        alert('Поставщик не найден.');
        return;
    }

    // Restore old amount to supplier debt
    supplier.debt += payment.amount;
    supplier.debtUSD += payment.amountUSD;

    // Calculate new amounts
    let newAmountTJS, newAmountUSD;
    if (newCurrency === 'TJS') {
        newAmountTJS = newAmount;
        newAmountUSD = convertTJStoUSD(newAmount);
    } else {
        newAmountUSD = newAmount;
        newAmountTJS = convertUSDtoTJS(newAmount);
    }

    // Update payment object
    payment.amount = newAmountTJS;
    payment.amountUSD = newAmountUSD;
    payment.currency = newCurrency;
    payment.commission = newCommission;
    payment.paymentMethod = newPaymentMethod;
    payment.date = newDate;

    // Subtract new amount from supplier debt
    supplier.debt -= newAmountTJS;
    supplier.debtUSD -= newAmountUSD;

    addToAuditLog('Изменено', 'Выплата поставщику', `${supplier.name} - ${formatCurrency(newAmountTJS)} / ${formatCurrencyUSD(newAmountUSD)}`);
    await saveData();

    hideModal();
    loadSuppliersTable();
    loadSupplierPaymentsHistory();
    updateDebtSummary();
    alert('Выплата обновлена!');
}

async function deleteSupplierPayment(paymentId) {
    if (!confirm('Вы уверены, что хотите удалить эту выплату?')) {
        return;
    }

    const paymentIndex = appData.supplierPayments.findIndex(p => p.id === paymentId);
    if (paymentIndex === -1) {
        alert('Выплата не найдена.');
        return;
    }

    const payment = appData.supplierPayments[paymentIndex];
    const supplier = appData.suppliers.find(s => s.id === payment.supplierId);

    if (supplier) {
        // Restore the debt
        supplier.debt += payment.amount;
        supplier.debtUSD += (payment.amountUSD || 0);
    }

    appData.supplierPayments.splice(paymentIndex, 1);

    addToAuditLog('Удалено', 'Выплата поставщику', `${payment.supplierName} - ${formatCurrency(payment.amount)}`);
    await saveData();

    loadSuppliersTable();
    loadSupplierPaymentsHistory();
    updateDebtSummary();
    alert('Выплата удалена!');
}

// Purchase functions - ОБНОВЛЕНО ДЛЯ ПОДДЕРЖКИ USD
async function addPurchase(event) {
    event.preventDefault();

    const supplierId = document.getElementById('supplierSelect').value;
    const amount = parseFloat(document.getElementById('purchaseAmount').value);
    const date = document.getElementById('purchaseDate').value;
    const description = document.getElementById('purchaseDescription').value;
    const currency = document.getElementById('purchaseCurrency').value;

    if (!supplierId || !date || !description || isNaN(amount) || amount <= 0) {
        alert('Пожалуйста, заполните все поля корректно.');
        return;
    }

    const supplier = appData.suppliers.find(s => s.id === supplierId);
    if (!supplier) {
        alert('Поставщик не найден.');
        return;
    }

    let amountTJS, amountUSD;
    
    if (currency === 'TJS') {
        amountTJS = amount;
        amountUSD = convertTJStoUSD(amount);
    } else {
        amountUSD = amount;
        amountTJS = convertUSDtoTJS(amount);
    }

    const purchase = {
        id: generateId('purchase'),
        supplierId: supplierId,
        supplierName: supplier.name,
        amount: amountTJS,
        amountUSD: amountUSD,
        currency: currency,
        date: date,
        description: description,
        addedBy: currentUser,
        timestamp: new Date().toISOString()
    };

    appData.purchases.push(purchase);
    supplier.debt += amountTJS;
    supplier.debtUSD += amountUSD;

    addToAuditLog('Добавлено', 'Закупка', `${supplier.name} - ${formatCurrency(amountTJS)} / ${formatCurrencyUSD(amountUSD)} - ${description}`);
    await saveData();

    document.getElementById('addPurchaseForm').reset();
    loadPurchasesTable();
    loadSuppliersTable();
    updateDebtSummary();
    alert('Закупка добавлена!');
}

function loadPurchasesTable() {
    const tbody = document.querySelector('#purchasesTable tbody');
    const sortedPurchases = appData.purchases.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    tbody.innerHTML = sortedPurchases.map(purchase => `
        <tr>
            <td>${purchase.id.slice(-8)}</td>
            <td>${purchase.supplierName}</td>
            <td>
                <div>${formatCurrency(purchase.amount)}</div>
                <div style="font-size: 0.85em; color: #666;">${formatCurrencyUSD(purchase.amountUSD || 0)}</div>
            </td>
            <td>${purchase.description}</td>
            <td>${formatDate(purchase.date)}</td>
            <td>${purchase.addedBy}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-danger btn-sm" onclick="deletePurchase('${purchase.id}')">Удалить</button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function deletePurchase(purchaseId) {
    if (!confirm('Вы уверены, что хотите удалить эту закупку?')) return;

    const purchaseIndex = appData.purchases.findIndex(purchase => purchase.id === purchaseId);
    if (purchaseIndex === -1) {
        alert('Закупка не найдена.');
        return;
    }

    const purchase = appData.purchases[purchaseIndex];
    appData.purchases.splice(purchaseIndex, 1);

    const supplier = appData.suppliers.find(s => s.id === purchase.supplierId);
    if (supplier) {
        supplier.debt -= purchase.amount;
        supplier.debtUSD -= (purchase.amountUSD || 0);
    }

    addToAuditLog('Удалено', 'Закупка', `${purchase.supplierName} - ${formatCurrency(purchase.amount)}`);
    await saveData();

    loadPurchasesTable();
    loadSuppliersTable();
    updateDebtSummary();
    alert('Закупка удалена.');
}

// Reports functions
function generateReport() {
    const fromDate = document.getElementById('reportFromDate').value;
    const toDate = document.getElementById('reportToDate').value;

    if (!fromDate || !toDate) {
        alert('Пожалуйста, выберите период отчета.');
        return;
    }

    if (new Date(fromDate) > new Date(toDate)) {
        alert('Начальная дата не может быть больше конечной даты.');
        return;
    }

    const fromDateTime = new Date(fromDate);
    const toDateTime = new Date(toDate);
    toDateTime.setHours(23, 59, 59, 999);

    const periodSales = appData.sales.filter(sale => {
        const saleDate = new Date(sale.date);
        return saleDate >= fromDateTime && saleDate <= toDateTime;
    });

    const periodExpenses = appData.expenses.filter(expense => {
        const expenseDate = new Date(expense.date);
        return expenseDate >= fromDateTime && expenseDate <= toDateTime;
    });

    const periodPurchases = appData.purchases.filter(purchase => {
        const purchaseDate = new Date(purchase.date);
        return purchaseDate >= fromDateTime && purchaseDate <= toDateTime;
    });

    const periodSupplierPayments = appData.supplierPayments.filter(payment => {
        const paymentDate = new Date(payment.date);
        return paymentDate >= fromDateTime && paymentDate <= toDateTime;
    });

    const periodSalaryPayments = appData.salaryPayments.filter(payment => {
        const paymentDate = new Date(payment.date);
        return paymentDate >= fromDateTime && paymentDate <= toDateTime;
    });

    // Выручка из 1С (net_sales) за период; фолбэк на Excel-продажи, пока 1С не загружена.
    const totalRevenue = sales1CLoaded
        ? sumNet1C(fromDateTime, toDateTime)
        : periodSales.reduce((sum, sale) => sum + parseFloat(sale.amount), 0);
    const totalExpenses = periodExpenses.reduce((sum, expense) => sum + parseFloat(expense.amount), 0);
    const totalProfit = totalRevenue * 0.3;
    const totalPurchases = periodPurchases.reduce((sum, purchase) => sum + parseFloat(purchase.amount), 0);
    const totalSupplierPayments = periodSupplierPayments.reduce((sum, payment) => sum + parseFloat(payment.amount), 0);
    const totalSalaryPayments = periodSalaryPayments.reduce((sum, payment) => sum + parseFloat(payment.amount), 0);
    const balance = totalRevenue - totalExpenses - totalPurchases - totalSupplierPayments - totalSalaryPayments;

    const salesCount = periodSales.length;
    const avgCheck = salesCount > 0 ? totalRevenue / salesCount : 0;
    const profitMargin = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(1) : '0';

    const salesBySalon = {};
    SALONS.forEach(salon => {
        salesBySalon[salon] = periodSales
            .filter(sale => sale.salon === salon)
            .reduce((sum, sale) => sum + parseFloat(sale.amount), 0);
    });

    let bestSalon = '-';
    let bestSalonRevenue = 0;
    Object.entries(salesBySalon).forEach(([salon, revenue]) => {
        if (revenue > bestSalonRevenue) {
            bestSalonRevenue = revenue;
            bestSalon = salon.replace('Ортосалон ', '');
        }
    });

    const currentDebt = appData.suppliers.reduce((sum, supplier) => sum + parseFloat(supplier.debt), 0);

    document.getElementById('reportRevenue').textContent = formatCurrency(totalRevenue);
    document.getElementById('reportExpenses').textContent = formatCurrency(totalExpenses);
    document.getElementById('reportProfit').textContent = formatCurrency(totalProfit);
    document.getElementById('reportPurchases').textContent = formatCurrency(totalPurchases);
    document.getElementById('reportSupplierPayments').textContent = formatCurrency(totalSupplierPayments);
    document.getElementById('reportSalaries').textContent = formatCurrency(totalSalaryPayments);
    document.getElementById('reportBalance').textContent = formatCurrency(balance);
    document.getElementById('reportBalance').style.color = balance >= 0 ? '#38a169' : '#e53e3e';

    document.getElementById('reportCurrentDebt').textContent = formatCurrency(currentDebt);

    loadAuditLogTable(fromDateTime, toDateTime);
    generateExpensesBySalonChart(periodExpenses);

    document.getElementById('reportResults').style.display = 'block';
    document.getElementById('reportResults').scrollIntoView({ behavior: 'smooth' });
}

function generateExpensesBySalonChart(expenses) {
    const canvas = document.getElementById('expensesBySalonChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const expensesBySalon = {
        'Ортосалон СитиМолл': 0,
        'Ортосалон Сиема': 0,
        'Ортосалон Баракат': 0,
        'Ортосалон Айни': 0,
        'Общие': 0
    };

    expenses.forEach(expense => {
        const salon = expense.salon;
        if (expensesBySalon.hasOwnProperty(salon)) {
            expensesBySalon[salon] += parseFloat(expense.amount);
        } else {
            expensesBySalon['Общие'] += parseFloat(expense.amount);
        }
    });

    if (window.expensesBySalonChartInstance) {
        window.expensesBySalonChartInstance.destroy();
    }

    window.expensesBySalonChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(expensesBySalon).map(salon => salon.replace('Ортосалон ', '')),
            datasets: [{
                label: 'TJS',
                data: Object.values(expensesBySalon),
                backgroundColor: ['#FF9A76', '#8B7CFF', '#E361FF', '#4DD4AC', '#FFC185'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return formatCurrency(context.parsed.y);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return formatCurrency(value);
                        }
                    }
                }
            }
        }
    });
}

function loadAuditLogTable(fromDate, toDate) {
    const tbody = document.querySelector('#auditLogTable tbody');
    
    const filteredLog = appData.auditLog.filter(entry => {
        const entryDate = new Date(entry.timestamp);
        return entryDate >= fromDate && entryDate <= toDate;
    }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    tbody.innerHTML = filteredLog.map(entry => `
        <tr>
            <td>${formatDateTime(entry.timestamp)}</td>
            <td>${entry.admin}</td>
            <td>${entry.action}</td>
            <td>${entry.entityType}</td>
            <td>${entry.details}</td>
        </tr>
    `).join('');
}

// Modal functions
function hideModal() {
    document.getElementById('modalOverlay').style.display = 'none';
    document.querySelectorAll('.modal').forEach(modal => {
        modal.style.display = 'none';
    });
}

// Load all tables function
function loadAllTables() {
    loadAllSalesTable();
    loadExpensesTable();
    loadEmployeesTable();
    loadSalaryPaymentsTable();
    loadSuppliersTable();
    loadPurchasesTable();
    loadSupplierPaymentsHistory();
    populateEmployeeSelect();
    if (typeof populateCalcEmployeeSelect === 'function') populateCalcEmployeeSelect();
    populateSupplierSelects();
    updateDebtSummary();
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    // Login form
    document.getElementById('loginForm').addEventListener('submit', function(e) {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        if (login(username, password)) {
            document.getElementById('loginError').style.display = 'none';
        } else {
            showError('Неверное имя пользователя или пароль.', 'loginError');
        }
    });

    document.getElementById('logoutBtn').addEventListener('click', logout);

    // Автовход: если прошлый раз входили — сразу открываем приложение без запроса логина/пароля.
    restoreSession();

    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            switchTab(this.dataset.tab);
        });
    });

    document.querySelectorAll('.section-tab').forEach(tab => {
        if (tab.dataset.prodtab) return; // подразделы «Товары» обрабатываются отдельно
        if (tab.dataset.btab) return;    // подразделы «Штрихкоды» обрабатываются отдельно
        tab.addEventListener('click', function() {
            const section = this.closest('.section').id.replace('Section', '');
            switchSectionTab(section, this.dataset.section);
        });
    });

    document.querySelectorAll('#barcodesSubTabs .section-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            switchBarcodesSubtab(this.dataset.btab);
        });
    });

    document.querySelectorAll('#productsSubTabs .section-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            switchProductTab(this.dataset.prodtab);
        });
    });

    const fileUploadArea = document.getElementById('fileUploadArea');
    const fileInput = document.getElementById('fileInput');

    fileUploadArea.addEventListener('click', () => fileInput.click());
    fileUploadArea.addEventListener('dragover', function(e) {
        e.preventDefault();
        this.classList.add('dragover');
    });
    fileUploadArea.addEventListener('dragleave', function() {
        this.classList.remove('dragover');
    });
    fileUploadArea.addEventListener('drop', function(e) {
        e.preventDefault();
        this.classList.remove('dragover');
        fileInput.files = e.dataTransfer.files;
        handleFileUpload();
    });

    fileInput.addEventListener('change', handleFileUpload);

    document.getElementById('confirmImport').addEventListener('click', confirmImport);
    document.getElementById('cancelImport').addEventListener('click', cancelImport);

    document.getElementById('addSaleForm').addEventListener('submit', addSale);
    document.getElementById('addExpenseForm').addEventListener('submit', addExpense);
    document.getElementById('addSalaryPaymentForm').addEventListener('submit', addSalaryPayment);
    document.getElementById('addPurchaseForm').addEventListener('submit', addPurchase);

    document.getElementById('addEmployeeBtn').addEventListener('click', showAddEmployeeModal);
    document.getElementById('saveEmployee').addEventListener('click', saveEmployee);

    document.getElementById('addSupplierBtn').addEventListener('click', showAddSupplierModal);
    document.getElementById('saveSupplier').addEventListener('click', saveSupplier);
    document.getElementById('confirmSupplierPayment').addEventListener('click', confirmSupplierPayment);
    document.getElementById('confirmEditPayment').addEventListener('click', confirmEditPayment);
    document.getElementById('filterPaymentHistoryBtn').addEventListener('click', function() {
        const fromDate = document.getElementById('paymentHistoryFromDate').value;
        const toDate = document.getElementById('paymentHistoryToDate').value;
        loadSupplierPaymentsHistory(fromDate, toDate);
    });
    document.getElementById('resetPaymentHistoryFilterBtn').addEventListener('click', function() {
        document.getElementById('paymentHistoryFromDate').value = '';
        document.getElementById('paymentHistoryToDate').value = '';
        loadSupplierPaymentsHistory();
    });


    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', hideModal);
    });

    document.getElementById('modalOverlay').addEventListener('click', function(e) {
        if (e.target === this) hideModal();
    });

    document.getElementById('expenseCategory').addEventListener('change', function() {
        const customGroup = document.getElementById('customCategoryGroup');
        if (this.value === 'Другое') {
            customGroup.style.display = 'block';
            document.getElementById('customCategory').required = true;
        } else {
            customGroup.style.display = 'none';
            document.getElementById('customCategory').required = false;
        }
    });

    document.getElementById('paymentType').addEventListener('change', function() {
        const paymentDate = document.getElementById('paymentDate');
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');

        if (this.value === 'base') {
            paymentDate.value = `${year}-${month}-15`;
        } else if (this.value === 'commission') {
            const lastDay = new Date(year, today.getMonth() + 1, 0).getDate();
            paymentDate.value = `${year}-${month}-${lastDay}`;
        }
    });

    document.getElementById('generateReport').addEventListener('click', generateReport);

    // Обработчик кнопки обновления курса обмена
    const updateExchangeRateBtn = document.getElementById('updateExchangeRateBtn');
    if (updateExchangeRateBtn) {
        updateExchangeRateBtn.addEventListener('click', async function() {
            const newRate = parseFloat(document.getElementById('exchangeRateInput').value);
            await updateExchangeRate(newRate);
        });
    }

    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
    document.getElementById('saleDate').value = today.toISOString().split('T')[0];
    document.getElementById('expenseDate').value = today.toISOString().split('T')[0];
    document.getElementById('paymentDate').value = today.toISOString().split('T')[0];
    document.getElementById('purchaseDate').value = today.toISOString().split('T')[0];
    document.getElementById('reportFromDate').value = firstDayOfMonth.toISOString().split('T')[0];
    document.getElementById('reportToDate').value = today.toISOString().split('T')[0];

    window.updateExchangeRate = updateExchangeRate;
    window.deleteSale = deleteSale;
    window.deleteExpense = deleteExpense;
    window.deleteEmployee = deleteEmployee;
    window.deleteSalaryPayment = deleteSalaryPayment;
    window.deleteSupplier = deleteSupplier;
    window.showSupplierPaymentModal = showSupplierPaymentModal;
    window.deletePurchase = deletePurchase;
    window.switchExpensesTab = switchExpensesTab;
    window.renderFixedExpenses = renderFixedExpenses;
    window.toggleSalonBlock = toggleSalonBlock;
    window.addFixedExpenseItem = addFixedExpenseItem;
    window.deleteFixedExpenseItem = deleteFixedExpenseItem;
    window.addFixedExpenseCategory = addFixedExpenseCategory;

    // Init fixed expenses month selector
    const fxMonthInput = document.getElementById('fixedExpensesMonth');
    if (fxMonthInput) {
        const t = new Date();
        const ym = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}`;
        fxMonthInput.value = ym;
    }
});

// ═════════════════════════════════════════════════════════════
// FIXED EXPENSES — ПОСТОЯННЫЕ ЗАТРАТЫ ПО САЛОНАМ
// ═════════════════════════════════════════════════════════════

const DEFAULT_FX_CATEGORIES = [
    { key: 'rent',     name: 'Аренда',              icon: '🏢', isSalary: false },
    { key: 'salary',   name: 'Зарплаты',           icon: '👥', isSalary: true  },
    { key: 'utility',  name: 'Коммунальные услуги', icon: '💧', isSalary: false },
    { key: 'electric', name: 'Электроэнергия',     icon: '⚡', isSalary: false },
    { key: 'tax',      name: 'Налоги',              icon: '📝', isSalary: false }
];

function getFixedExpenseCategories() {
    // Не мутируем дефолт. Сохраняем в appData только пользовательские расширения.
    const userExtra = (appData.fixedExpenseCategories || []).filter(c => !DEFAULT_FX_CATEGORIES.find(d => d.key === c.key));
    return [...DEFAULT_FX_CATEGORIES, ...userExtra];
}

function getSelectedFixedMonth() {
    const el = document.getElementById('fixedExpensesMonth');
    if (el && el.value) return el.value; // 'YYYY-MM'
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}`;
}

function isInMonth(dateStr, ym) {
    if (!dateStr || !ym) return false;
    return String(dateStr).startsWith(ym);
}

function switchExpensesTab(tabName) {
    const section = document.getElementById('expensesSection');
    if (!section) return;
    section.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    section.querySelectorAll('.section-tab').forEach(t => t.classList.remove('active'));
    const tabEl = document.getElementById(tabName + 'Tab');
    if (tabEl) tabEl.classList.add('active');
    const btn = section.querySelector(`[data-section="${tabName}"]`);
    if (btn) btn.classList.add('active');
    if (tabName === 'fixed-expenses') {
        rolloverFixedExpensesIfNeeded().then(() => {
            renderFixedExpenses();
            renderDashboardFixedExpenses();
        });
    }
}

function sumFixedExpensesBySalon(salon, ym) {
    return (appData.fixedExpenses || [])
        .filter(e => e.salon === salon && isInMonth(e.date, ym))
        .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
}

function sumFixedExpensesByCategory(salon, categoryKey, ym) {
    return (appData.fixedExpenses || [])
        .filter(e => e.salon === salon && e.categoryKey === categoryKey && isInMonth(e.date, ym))
        .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
}

function getCurrentYM() {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}`;
}

function getPrevYM(ym) {
    // ym format 'YYYY-MM'
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 2, 1); // m-2: month is 1-indexed, go back 1
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

// Автоперенос постоянных затрат из предыдущего месяца на текущий.
// Срабатывает только один раз в месяц (флаг в appData.fixedExpensesAutofillLog).
async function rolloverFixedExpensesIfNeeded() {
    try {
        if (!appData) return;
        appData.fixedExpenses = appData.fixedExpenses || [];
        appData.fixedExpensesAutofillLog = appData.fixedExpensesAutofillLog || {};

        const currentYM = getCurrentYM();

        // Уже переносили в этом месяце?
        if (appData.fixedExpensesAutofillLog[currentYM]) return;

        const prevYM = getPrevYM(currentYM);
        const prevItems = appData.fixedExpenses.filter(e => isInMonth(e.date, prevYM));
        if (prevItems.length === 0) {
            // Нечего копировать — помечаем как выполненный, чтобы не проверять каждый раз
            appData.fixedExpensesAutofillLog[currentYM] = { ts: new Date().toISOString(), copied: 0 };
            try { await saveData(); } catch(e) {}
            return;
        }

        // Доп. защита: если в текущем месяце уже есть записи — пропускаем
        const hasCurrent = appData.fixedExpenses.some(e => isInMonth(e.date, currentYM));
        if (hasCurrent) {
            appData.fixedExpensesAutofillLog[currentYM] = { ts: new Date().toISOString(), copied: 0, skippedReason: 'already_has_records' };
            try { await saveData(); } catch(e) {}
            return;
        }

        // Копируем записи прошлого месяца с датой 1-го числа текущего
        const newDate = `${currentYM}-01`;
        const copied = prevItems.map(it => ({
            ...it,
            id: 'fx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            date: newDate,
            rolledFrom: it.id,
            rolledFromMonth: prevYM,
            createdAt: new Date().toISOString(),
            createdBy: 'auto-rollover'
        }));

        appData.fixedExpenses.push(...copied);
        appData.fixedExpensesAutofillLog[currentYM] = {
            ts: new Date().toISOString(),
            copied: copied.length,
            from: prevYM
        };

        await saveData();
        console.log(`✓ Fixed expenses rollover: ${copied.length} записей из ${prevYM} в ${currentYM}`);

        if (typeof showSuccess === 'function') {
            showSuccess(`Постоянные затраты за ${prevYM} автоматически перенесены на ${currentYM} (${copied.length} записей). При необходимости откорректируйте.`);
        }
    } catch (err) {
        console.error('Rollover error:', err);
    }
}

function renderDashboardFixedExpenses() {
    const container = document.getElementById('dashboardFixedExpenses');
    if (!container) return;
    const t = new Date();
    const ym = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}`;
    const allSalons = [...SALONS, 'Общие'];
    let total = 0;
    let html = '';
    allSalons.forEach(salon => {
        const sum = sumFixedExpensesBySalon(salon, ym);
        total += sum;
        html += `
            <div class="fx-summary-card">
                <div class="fx-salon-name">${salon}</div>
                <div class="fx-amount">${formatCurrency(sum)}</div>
                <div class="fx-amount-sub">за текущий месяц</div>
            </div>`;
    });
    html += `
        <div class="fx-summary-card total">
            <div class="fx-salon-name">Итого</div>
            <div class="fx-amount">${formatCurrency(total)}</div>
            <div class="fx-amount-sub">по всем салонам</div>
        </div>`;
    container.innerHTML = html;
}

function renderFixedExpenses() {
    const container = document.getElementById('fixedExpensesContainer');
    if (!container) return;
    const ym = getSelectedFixedMonth();
    const categories = getFixedExpenseCategories();
    const allSalons = [...SALONS, 'Общие'];
    const employees = (appData.employees || []).filter(e => e.isActive !== false && e.is_active !== false);

    // сохраняем открытое состояние перед перерисовкой
    const openSalons = Array.from(container.querySelectorAll('.fx-salon-block.open'))
        .map(b => b.getAttribute('data-salon'));

    let html = '';
    allSalons.forEach(salon => {
        const salonTotal = sumFixedExpensesBySalon(salon, ym);
        const isOpen = openSalons.includes(salon);
        html += `
        <div class="fx-salon-block ${isOpen ? 'open' : ''}" data-salon="${escapeHtml(salon)}">
            <div class="fx-salon-header" onclick="toggleSalonBlock(this)">
                <div class="fx-salon-title">🏪 ${escapeHtml(salon)}</div>
                <div class="fx-salon-total">
                    <span>${formatCurrency(salonTotal)}</span>
                    <span class="fx-arrow">▼</span>
                </div>
            </div>
            <div class="fx-salon-body">`;
        categories.forEach(cat => {
            const catTotal = sumFixedExpensesByCategory(salon, cat.key, ym);
            const items = (appData.fixedExpenses || []).filter(e =>
                e.salon === salon && e.categoryKey === cat.key && isInMonth(e.date, ym)
            );
            html += `
            <div class="fx-category" data-cat="${cat.key}">
                <div class="fx-category-header">
                    <div class="fx-category-title">${cat.icon || ''} ${escapeHtml(cat.name)}</div>
                    <div class="fx-category-total">${formatCurrency(catTotal)}</div>
                </div>
                <div class="fx-items-list">`;
            if (items.length === 0) {
                html += `<div style="color: var(--color-text-secondary); font-size: 12px; padding: 4px 6px;">Записей нет</div>`;
            } else {
                items.forEach(it => {
                    html += `
                    <div class="fx-item">
                        <div class="fx-item-name">${escapeHtml(it.name || '—')}</div>
                        <div class="fx-item-amount">${formatCurrency(it.amount)}</div>
                        <div class="fx-item-date">${escapeHtml(it.date || '')}</div>
                        <button class="fx-btn-delete" onclick="deleteFixedExpenseItem('${it.id}')">✕</button>
                    </div>`;
                });
            }
            html += `</div>`;

            // форма добавления
            if (cat.isSalary) {
                // выбор сотрудника
                const empOptions = employees.map(e => {
                    const id = e.id;
                    const label = `${escapeHtml(e.name)}${e.position ? ' (' + escapeHtml(e.position) + ')' : ''}`;
                    return `<option value="${id}" data-name="${escapeHtml(e.name)}">${label}</option>`;
                }).join('');
                html += `
                <div class="fx-add-row" data-row="${cat.key}-${escapeHtml(salon)}">
                    <select class="fx-employee">
                        <option value="">— выберите сотрудника —</option>
                        ${empOptions}
                    </select>
                    <input type="number" class="fx-amount-input" placeholder="Сумма (TJS)" step="0.01" min="0">
                    <input type="date" class="fx-date-input" value="${ym}-01">
                    <button class="fx-btn-add" onclick="addFixedExpenseItem('${escapeHtml(salon)}','${cat.key}', this)">+ Добавить</button>
                </div>
                <div style="margin-top: 6px; font-size: 12px; color: var(--color-text-secondary);">
                    Сотрудника можно добавить в разделе «Зарплаты» → «Сотрудники».
                </div>`;
            } else {
                html += `
                <div class="fx-add-row" data-row="${cat.key}-${escapeHtml(salon)}">
                    <input type="text" class="fx-name-input" placeholder="Название (например: Октябрь)">
                    <input type="number" class="fx-amount-input" placeholder="Сумма (TJS)" step="0.01" min="0">
                    <input type="date" class="fx-date-input" value="${ym}-01">
                    <button class="fx-btn-add" onclick="addFixedExpenseItem('${escapeHtml(salon)}','${cat.key}', this)">+ Добавить</button>
                </div>`;
            }
            html += `</div>`;
        });

        // блок добавления новой категории
        html += `
            <div class="fx-add-category-row">
                <input type="text" placeholder="Новая категория (например: Охрана)" id="newCat-${escapeAttr(salon)}">
                <button class="fx-btn-add" onclick="addFixedExpenseCategory(document.getElementById('newCat-${escapeAttr(salon)}').value)">+ Категория</button>
            </div>`;

        html += `
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

function toggleSalonBlock(headerEl) {
    const block = headerEl.closest('.fx-salon-block');
    if (block) block.classList.toggle('open');
}

async function addFixedExpenseItem(salon, categoryKey, btnEl) {
    const row = btnEl.closest('.fx-add-row');
    const amountInput = row.querySelector('.fx-amount-input');
    const dateInput = row.querySelector('.fx-date-input');
    const amount = parseFloat(amountInput.value);
    const date = dateInput.value;

    if (!amount || amount <= 0) { showError('Укажите сумму'); return; }
    if (!date) { showError('Укажите дату'); return; }

    let name = '';
    let employeeId = null;
    const empSelect = row.querySelector('.fx-employee');
    if (empSelect) {
        const opt = empSelect.options[empSelect.selectedIndex];
        employeeId = empSelect.value;
        if (!employeeId) { showError('Выберите сотрудника'); return; }
        name = opt ? opt.getAttribute('data-name') : '';
    } else {
        const nameInput = row.querySelector('.fx-name-input');
        name = nameInput ? nameInput.value.trim() : '';
        if (!name) name = '—';
    }

    const cat = getFixedExpenseCategories().find(c => c.key === categoryKey);
    const item = {
        id: 'fx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        salon,
        categoryKey,
        categoryName: cat ? cat.name : categoryKey,
        name,
        amount,
        date,
        employeeId,
        createdBy: (currentUser && currentUser.displayName) || (currentUser && currentUser.username) || 'system',
        createdAt: new Date().toISOString()
    };

    appData.fixedExpenses = appData.fixedExpenses || [];
    appData.fixedExpenses.push(item);

    try {
        await saveData();
        showSuccess('Запись добавлена');
        renderFixedExpenses();
        renderDashboardFixedExpenses();
    } catch (e) {
        console.error(e);
        showError('Не удалось сохранить');
    }
}

async function deleteFixedExpenseItem(itemId) {
    if (!confirm('Удалить эту запись?')) return;
    appData.fixedExpenses = (appData.fixedExpenses || []).filter(e => e.id !== itemId);
    try {
        await saveData();
        showSuccess('Удалено');
        renderFixedExpenses();
        renderDashboardFixedExpenses();
    } catch (e) {
        showError('Ошибка удаления');
    }
}

async function addFixedExpenseCategory(name) {
    name = (name || '').trim();
    if (!name) { showError('Введите название категории'); return; }
    const key = 'custom_' + name.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '_').slice(0, 24) + '_' + Math.random().toString(36).substr(2, 5);
    appData.fixedExpenseCategories = appData.fixedExpenseCategories || [];
    appData.fixedExpenseCategories.push({ key, name, icon: '📌', isSalary: false });
    try {
        await saveData();
        showSuccess('Категория добавлена');
        renderFixedExpenses();
    } catch (e) {
        showError('Не удалось сохранить');
    }
}

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/[^a-z0-9А-яЁё_-]/gi, '_');
}

// ═════════════════════════════════════════════════════════════
// SALARY CALCULATOR — Калькулятор процента от оборота
// ═════════════════════════════════════════════════════════════

function populateCalcEmployeeSelect() {
    const select = document.getElementById('calcEmployee');
    if (!select) return;
    const current = select.value;
    const emps = (appData.employees || []);
    select.innerHTML = '<option value="">— выберите сотрудника —</option>' +
        emps.map(e => {
            const pct = (e.commission != null) ? ` · ${e.commission}%` : '';
            return `<option value="${e.id}" data-commission="${e.commission || ''}">${escapeHtml(e.name)} (${escapeHtml(e.position || '')})${pct}</option>`;
        }).join('');
    if (current) select.value = current;
}

function onCalcEmployeeChange() {
    const select = document.getElementById('calcEmployee');
    const opt = select.options[select.selectedIndex];
    const commissionAttr = opt ? opt.getAttribute('data-commission') : '';
    const pctInput = document.getElementById('calcPercent');
    // Если процент не введён пользователем — подставим из карточки сотрудника
    if (pctInput && !pctInput.value && commissionAttr) {
        pctInput.value = commissionAttr;
    }
    recalcSalaryPercent();
}

function recalcSalaryPercent() {
    const turnover = parseFloat(document.getElementById('calcTurnover').value);
    const percent = parseFloat(document.getElementById('calcPercent').value);
    const select = document.getElementById('calcEmployee');
    const empId = select ? select.value : '';
    const empObj = empId ? (appData.employees || []).find(e => e.id === empId) : null;
    const empName = empObj ? empObj.name : '';

    const box = document.getElementById('calcResultBox');
    if (isNaN(turnover) || isNaN(percent) || turnover <= 0 || percent < 0) {
        box.style.display = 'none';
        return;
    }
    const amount = turnover * percent / 100;
    box.style.display = 'block';

    const txt = document.getElementById('calcResultText');
    if (empName) {
        txt.innerHTML = `${percent}% от оборота <b>${formatCurrency(turnover)}</b><br>для сотрудника <b>${escapeHtml(empName)}</b> составляет:`;
    } else {
        txt.innerHTML = `${percent}% от оборота <b>${formatCurrency(turnover)}</b> составляет:`;
    }
    document.getElementById('calcResultAmount').textContent = formatCurrency(amount);

    // Сохраняем посчитанные значения для других кнопок
    box.dataset.amount = amount;
    box.dataset.empName = empName;
    box.dataset.empId = empId || '';
}

async function copyCalcResult() {
    const box = document.getElementById('calcResultBox');
    const amount = parseFloat(box.dataset.amount || 0);
    const empName = box.dataset.empName || '';
    const turnover = parseFloat(document.getElementById('calcTurnover').value);
    const percent = parseFloat(document.getElementById('calcPercent').value);

    const text = empName
        ? `Процент от продаж ${empName} составляет ${formatCurrency(amount)} (${percent}% от ${formatCurrency(turnover)})`
        : `${percent}% от ${formatCurrency(turnover)} = ${formatCurrency(amount)}`;

    try {
        await navigator.clipboard.writeText(text);
        if (typeof showSuccess === 'function') showSuccess('Скопировано в буфер обмена');
        else alert('Скопировано: ' + text);
    } catch (err) {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); alert('Скопировано'); } catch(e) { alert(text); }
        document.body.removeChild(ta);
    }
}

function applyCalcAsPayment() {
    const box = document.getElementById('calcResultBox');
    const amount = parseFloat(box.dataset.amount || 0);
    const empId = box.dataset.empId || '';

    if (!empId) { alert('Выберите сотрудника в калькуляторе'); return; }
    if (!amount || amount <= 0) { alert('Введите корректные данные в калькуляторе'); return; }

    // Переключаемся на вкладку выплат
    if (typeof switchSectionTab === 'function') {
        switchSectionTab('salaries', 'payments');
    }

    // Заполняем форму выплаты
    setTimeout(() => {
        const empSel = document.getElementById('employeeSelect');
        const typeSel = document.getElementById('paymentType');
        const amtInp = document.getElementById('paymentAmount');
        const dateInp = document.getElementById('paymentDate');
        if (empSel) empSel.value = empId;
        if (typeSel) typeSel.value = 'commission';
        if (amtInp) amtInp.value = amount.toFixed(2);
        if (dateInp && !dateInp.value) {
            const t = new Date();
            dateInp.value = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
        }
        if (amtInp) amtInp.focus();
    }, 100);
}

// ═════════════════════════════════════════════════════════════
// WALLET COPY — копирование номера кошелька одним кликом
// ═════════════════════════════════════════════════════════════
async function copyWalletToClipboard(evt, chipEl, walletText) {
    if (evt && evt.stopPropagation) evt.stopPropagation();
    try {
        await navigator.clipboard.writeText(walletText);
    } catch (err) {
        const ta = document.createElement('textarea');
        ta.value = walletText;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch(e) {}
        document.body.removeChild(ta);
    }
    // Визуальный фидбек
    if (chipEl) {
        const textSpan = chipEl.querySelector('.wallet-chip-text');
        const original = textSpan ? textSpan.textContent : walletText;
        chipEl.classList.add('copied');
        if (textSpan) textSpan.textContent = '✓ Скопировано';
        setTimeout(() => {
            chipEl.classList.remove('copied');
            if (textSpan) textSpan.textContent = original;
        }, 1500);
    }
}

// Экспортируем на window для inline-обработчиков
window.recalcSalaryPercent = recalcSalaryPercent;
window.onCalcEmployeeChange = onCalcEmployeeChange;
window.copyCalcResult = copyCalcResult;
window.applyCalcAsPayment = applyCalcAsPayment;
window.copyWalletToClipboard = copyWalletToClipboard;
window.populateCalcEmployeeSelect = populateCalcEmployeeSelect;

// ═════════════════════════════════════════════════════════════
// INLINE EMPLOYEE EDIT — редактирование оклада/процента/кошелька
// ═════════════════════════════════════════════════════════════

function selectAllText(el) {
    // выделить весь текст в contenteditable, чтобы пользователь сразу мог печатать
    setTimeout(() => {
        try {
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            el._origValue = el.textContent;
        } catch (e) {}
    }, 0);
}

function handleEditableKey(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
    } else if (event.key === 'Escape') {
        event.preventDefault();
        if (event.target._origValue !== undefined) {
            event.target.textContent = event.target._origValue;
        }
        event.target.blur();
    }
}

async function saveEmployeeField(cell) {
    const empId = cell.getAttribute('data-emp-id');
    const field = cell.getAttribute('data-field');
    const raw = cell.textContent.trim();
    const origValue = cell._origValue;

    // Если значение не менялось — ничего не делаем
    if (raw === origValue) return;

    const emp = (appData.employees || []).find(e => e.id === empId);
    if (!emp) return;

    let newValue;
    let displayValue;

    if (field === 'salary') {
        // Убираем все нечисловые символы (TJS, пробелы, запятые)
        const num = parseFloat(raw.replace(/[^\d.,-]/g, '').replace(',', '.'));
        if (isNaN(num) || num < 0) {
            flashCell(cell, false);
            cell.textContent = formatCurrency(emp.salary);
            return;
        }
        newValue = num;
        displayValue = formatCurrency(num);
        emp.salary = num;
    } else if (field === 'commission') {
        const num = parseFloat(raw.replace(/[^\d.,-]/g, '').replace(',', '.'));
        if (isNaN(num) || num < 0 || num > 100) {
            flashCell(cell, false);
            cell.textContent = emp.commission + '%';
            return;
        }
        newValue = num;
        displayValue = num + '%';
        emp.commission = num;
    } else {
        return;
    }

    cell.textContent = displayValue;

    try {
        await saveData();
        flashCell(cell, true);
        if (typeof addToAuditLog === 'function') {
            addToAuditLog('Изменено', 'Сотрудник', `${emp.name}: ${field} → ${newValue}`);
        }
        // Обновляем зависимые элементы
        if (typeof populateEmployeeSelect === 'function') populateEmployeeSelect();
        if (typeof populateCalcEmployeeSelect === 'function') populateCalcEmployeeSelect();
    } catch (err) {
        console.error('Ошибка сохранения:', err);
        flashCell(cell, false);
        alert('Не удалось сохранить изменения. Попробуйте ещё раз.');
    }
}

function flashCell(cell, success) {
    cell.classList.remove('cell-saved', 'cell-error');
    cell.classList.add(success ? 'cell-saved' : 'cell-error');
    setTimeout(() => cell.classList.remove('cell-saved', 'cell-error'), 1200);
}

function startWalletEdit(btnEl) {
    const cell = btnEl.closest('.wallet-cell');
    if (!cell || cell.querySelector('input.wallet-input')) return;
    const empId = cell.getAttribute('data-emp-id');
    const currentVal = cell.getAttribute('data-wallet') || '';

    const display = cell.querySelector('.wallet-display');
    if (display) display.style.display = 'none';
    btnEl.style.display = 'none';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'wallet-input';
    input.value = currentVal;
    input.placeholder = '+992... или номер карты';
    input.setAttribute('data-emp-id', empId);
    input.onblur = () => saveWalletEdit(input);
    input.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        else if (e.key === 'Escape') {
            e.preventDefault();
            input.value = currentVal; // отменим
            cancelWalletEdit(cell);
        }
    };
    cell.appendChild(input);
    input.focus();
    input.select();
}

function cancelWalletEdit(cell) {
    const input = cell.querySelector('input.wallet-input');
    const display = cell.querySelector('.wallet-display');
    const btn = cell.querySelector('.wallet-edit-btn');
    if (input) input.remove();
    if (display) display.style.display = '';
    if (btn) btn.style.display = '';
}

async function saveWalletEdit(input) {
    const cell = input.closest('.wallet-cell');
    if (!cell) return;
    const empId = input.getAttribute('data-emp-id');
    const newVal = input.value.trim();
    const emp = (appData.employees || []).find(e => e.id === empId);
    if (!emp) { cancelWalletEdit(cell); return; }

    const oldVal = emp.wallet || '';
    if (newVal === oldVal) {
        cancelWalletEdit(cell);
        return;
    }

    emp.wallet = newVal;
    cell.setAttribute('data-wallet', newVal);

    try {
        await saveData();
        flashCell(cell, true);
        if (typeof addToAuditLog === 'function') {
            addToAuditLog('Изменено', 'Сотрудник', `${emp.name}: wallet → ${newVal || '(пусто)'}`);
        }
        loadEmployeesTable(); // перерисуем строку, чтобы появился чип
    } catch (err) {
        console.error(err);
        emp.wallet = oldVal;
        flashCell(cell, false);
        alert('Не удалось сохранить кошелёк');
        cancelWalletEdit(cell);
    }
}

window.saveEmployeeField = saveEmployeeField;
window.handleEditableKey = handleEditableKey;
window.selectAllText = selectAllText;
window.startWalletEdit = startWalletEdit;

// ============================================================
// ЕЖЕДНЕВНЫЕ ПРОДАЖИ (Daily Sales)
// Формула: Прибыль = (Выручка / 2) - (Постоянные затраты салона за месяц / дней в месяце)
// ============================================================

function getDaysInMonth(ym) {
    // ym: 'YYYY-MM'
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m, 0).getDate();
}

function ymFromDateStr(dateStr) {
    // dateStr: 'YYYY-MM-DD' -> 'YYYY-MM'
    if (!dateStr || typeof dateStr !== 'string') return getCurrentYM();
    return dateStr.slice(0, 7);
}

function getDailyFixedShare(salon, dateStr) {
    const ym = ymFromDateStr(dateStr);
    const monthlyFixed = sumFixedExpensesBySalon(salon, ym);
    const days = getDaysInMonth(ym) || 30;
    return monthlyFixed / days;
}

function findDailySalesEntry(salon, dateStr) {
    return (appData.dailySalesEntries || []).find(e => e.salon === salon && e.date === dateStr);
}

function renderDailySales() {
    const dateInput = document.getElementById('dailySalesDate');
    if (!dateInput) return;
    if (!dateInput.value) {
        const t = new Date();
        dateInput.value = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
    }
    const dateStr = dateInput.value;
    const container = document.getElementById('dailySalesContainer');
    if (!container) return;

    container.innerHTML = '';

    SALONS.forEach(salon => {
        const entry = findDailySalesEntry(salon, dateStr);
        const revenue = entry ? parseFloat(entry.revenue) || 0 : 0;
        const fixedShare = getDailyFixedShare(salon, dateStr);
        const cogs = revenue / 2;
        const profit = (revenue / 2) - fixedShare;

        const profitClass = revenue === 0 ? 'neutral' : (profit >= 0 ? 'positive' : 'negative');
        const profitSign = profit >= 0 ? '+' : '';
        const safeId = salon.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_');

        const card = document.createElement('div');
        card.className = 'ds-salon-card';
        card.innerHTML = `
            <div class="ds-salon-header">
                <span>🏪 ${escapeHtml(salon)}</span>
            </div>
            <div class="ds-salon-body">
                <div class="ds-input-group">
                    <div class="form-group">
                        <label for="dsRevenue_${safeId}">Выручка за день (TJS)</label>
                        <input type="number" step="0.01" min="0"
                            id="dsRevenue_${safeId}"
                            value="${revenue || ''}"
                            placeholder="0.00"
                            oninput="updateDailySalesPreview('${escapeHtml(salon)}', '${dateStr}', this.value)">
                    </div>
                </div>
                <div class="ds-breakdown" id="dsBreakdown_${safeId}">
                    <div class="ds-row ds-row-revenue">
                        <span>Выручка</span>
                        <span>${formatCurrency(revenue)}</span>
                    </div>
                    <div class="ds-row ds-row-cogs">
                        <span>− Себестоимость товара (50%)</span>
                        <span>−${formatCurrency(cogs)}</span>
                    </div>
                    <div class="ds-row ds-row-fixed">
                        <span>− Постоянные затраты за день</span>
                        <span>−${formatCurrency(fixedShare)}</span>
                    </div>
                    <div class="ds-row-divider"></div>
                    <div class="ds-row ds-row-profit ${profitClass}">
                        <span>Чистая прибыль дня</span>
                        <span>${profitSign}${formatCurrency(profit)}</span>
                    </div>
                </div>
                <div class="ds-actions">
                    <button type="button" class="ds-save-btn" id="dsSaveBtn_${safeId}"
                        onclick="handleDailySalesSaveClick('${escapeHtml(salon)}', '${dateStr}')">
                        💾 Сохранить
                    </button>
                </div>
            </div>
        `;
        container.appendChild(card);
    });

    renderDailySalesTotals(dateStr);
}

async function handleDailySalesSaveClick(salon, dateStr) {
    const safeId = salon.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_');
    const input = document.getElementById(`dsRevenue_${safeId}`);
    const btn = document.getElementById(`dsSaveBtn_${safeId}`);
    if (!input) return;
    const value = input.value;
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Сохранение...';
    }
    try {
        await saveDailySalesEntry(salon, dateStr, value);
        if (btn) {
            btn.classList.add('saved');
            btn.textContent = '✓ Сохранено';
            setTimeout(() => {
                btn.classList.remove('saved');
                btn.textContent = '💾 Сохранить';
                btn.disabled = false;
            }, 1600);
        }
        if (typeof renderDashboardDailySales === 'function') {
            renderDashboardDailySales();
        }
    } catch (e) {
        console.error(e);
        if (btn) {
            btn.textContent = '❌ Ошибка';
            setTimeout(() => {
                btn.textContent = '💾 Сохранить';
                btn.disabled = false;
            }, 1600);
        }
    }
}

function updateDailySalesPreview(salon, dateStr, rawValue) {
    // Live preview without saving — updates breakdown numbers as user types
    const revenue = Math.max(0, parseFloat(rawValue) || 0);
    const fixedShare = getDailyFixedShare(salon, dateStr);
    const cogs = revenue / 2;
    const profit = (revenue / 2) - fixedShare;
    const safeId = salon.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_');
    const breakdown = document.getElementById(`dsBreakdown_${safeId}`);
    if (!breakdown) return;

    const profitClass = revenue === 0 ? 'neutral' : (profit >= 0 ? 'positive' : 'negative');
    const profitSign = profit >= 0 ? '+' : '';
    breakdown.innerHTML = `
        <div class="ds-row ds-row-revenue">
            <span>Выручка</span>
            <span>${formatCurrency(revenue)}</span>
        </div>
        <div class="ds-row ds-row-cogs">
            <span>− Себестоимость товара (50%)</span>
            <span>−${formatCurrency(cogs)}</span>
        </div>
        <div class="ds-row ds-row-fixed">
            <span>− Постоянные затраты за день</span>
            <span>−${formatCurrency(fixedShare)}</span>
        </div>
        <div class="ds-row-divider"></div>
        <div class="ds-row ds-row-profit ${profitClass}">
            <span>Чистая прибыль дня</span>
            <span>${profitSign}${formatCurrency(profit)}</span>
        </div>
    `;
    // also live-update totals
    renderDailySalesTotals(dateStr, { [salon]: revenue });
}

async function saveDailySalesEntry(salon, dateStr, rawValue) {
    const revenue = Math.max(0, parseFloat(rawValue) || 0);
    const fixedShare = getDailyFixedShare(salon, dateStr);
    const cogs = revenue / 2;
    const profit = (revenue / 2) - fixedShare;

    appData.dailySalesEntries = appData.dailySalesEntries || [];
    const existing = appData.dailySalesEntries.find(e => e.salon === salon && e.date === dateStr);

    if (revenue === 0 && existing) {
        // Remove zero entries to keep data clean
        appData.dailySalesEntries = appData.dailySalesEntries.filter(e => !(e.salon === salon && e.date === dateStr));
    } else if (revenue > 0) {
        if (existing) {
            existing.revenue = revenue;
            existing.cogs = cogs;
            existing.fixedShare = fixedShare;
            existing.profit = profit;
            existing.updatedAt = new Date().toISOString();
        } else {
            appData.dailySalesEntries.push({
                id: Date.now() + Math.floor(Math.random() * 1000),
                salon,
                date: dateStr,
                revenue,
                cogs,
                fixedShare,
                profit,
                createdAt: new Date().toISOString()
            });
        }
    } else {
        // revenue=0 and no existing entry: nothing to save
        return;
    }

    try {
        await saveData();
        // Subtle visual confirmation
        const safeId = salon.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_');
        const input = document.getElementById(`dsRevenue_${safeId}`);
        if (input) {
            const orig = input.style.borderColor;
            input.style.borderColor = '#10b981';
            setTimeout(() => { input.style.borderColor = orig; }, 700);
        }
        renderDailySalesTotals(dateStr);
    } catch (e) {
        console.error('Ошибка сохранения ежедневной продажи:', e);
        if (typeof showError === 'function') showError('Не удалось сохранить запись');
    }
}

function renderDailySalesTotals(dateStr, overrides = {}) {
    const container = document.getElementById('dailySalesTotals');
    if (!container) return;

    let totalRevenue = 0;
    let totalCogs = 0;
    let totalFixed = 0;
    let totalProfit = 0;

    SALONS.forEach(salon => {
        const entry = findDailySalesEntry(salon, dateStr);
        const revenue = (salon in overrides)
            ? (parseFloat(overrides[salon]) || 0)
            : (entry ? parseFloat(entry.revenue) || 0 : 0);
        const fixedShare = getDailyFixedShare(salon, dateStr);
        const cogs = revenue / 2;
        const profit = (revenue / 2) - fixedShare;
        totalRevenue += revenue;
        totalCogs += cogs;
        totalFixed += fixedShare;
        totalProfit += profit;
    });

    const profitClass = totalRevenue === 0 ? '' : (totalProfit >= 0 ? 'profit-positive' : 'profit-negative');
    const profitSign = totalProfit >= 0 ? '+' : '';

    container.innerHTML = `
        <div class="ds-total-tile">
            <div class="ds-total-label">Общая выручка</div>
            <div class="ds-total-value">${formatCurrency(totalRevenue)}</div>
        </div>
        <div class="ds-total-tile">
            <div class="ds-total-label">Себестоимость (50%)</div>
            <div class="ds-total-value">−${formatCurrency(totalCogs)}</div>
        </div>
        <div class="ds-total-tile">
            <div class="ds-total-label">Постоянные затраты за день</div>
            <div class="ds-total-value">−${formatCurrency(totalFixed)}</div>
        </div>
        <div class="ds-total-tile ${profitClass}">
            <div class="ds-total-label">Чистая прибыль дня</div>
            <div class="ds-total-value">${profitSign}${formatCurrency(totalProfit)}</div>
        </div>
    `;
}

window.renderDailySales = renderDailySales;
window.updateDailySalesPreview = updateDailySalesPreview;
window.saveDailySalesEntry = saveDailySalesEntry;
window.handleDailySalesSaveClick = handleDailySalesSaveClick;

// ============================================================
// Дашборд: сводка ежедневных продаж за вчера по салонам
// (отдельная логика, не влияет на основные продажи Excel)
// ============================================================

function getYesterdayDateStr() {
    const t = new Date();
    t.setDate(t.getDate() - 1);
    return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
}

function formatDateRu(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    return `${d} ${months[m-1]} ${y}`;
}

// 'YYYY-MM' -> 'месяц YYYY' в именительном падеже (напр. 'май 2026').
function formatMonthRu(ym) {
    if (!ym) return '';
    const [y, m] = ym.split('-').map(Number);
    const months = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
    return `${months[m-1]} ${y}`;
}

function renderDashboardDailySales() {
    const container = document.getElementById('dashboardDailySales');
    const label = document.getElementById('dashboardDailySalesDateLabel');
    if (!container) return;

    const dateStr = getYesterdayDateStr();
    if (label) label.textContent = `за ${formatDateRu(dateStr)}`;

    let totalRevenue = 0;
    let totalProfit = 0;
    let cardsHtml = '';

    SALONS.forEach(salon => {
        const entry = findDailySalesEntry(salon, dateStr);
        const revenue = entry ? parseFloat(entry.revenue) || 0 : 0;
        const fixedShare = getDailyFixedShare(salon, dateStr);
        const profit = (revenue / 2) - fixedShare;

        totalRevenue += revenue;
        totalProfit += profit;

        let cardClass, statusText, profitDisplay;
        if (revenue === 0) {
            cardClass = 'empty';
            statusText = 'Нет данных';
            profitDisplay = '—';
        } else if (profit >= 0) {
            cardClass = 'positive';
            statusText = '▲ В плюсе';
            profitDisplay = `+${formatCurrency(profit)}`;
        } else {
            cardClass = 'negative';
            statusText = '▼ В минусе';
            profitDisplay = `−${formatCurrency(Math.abs(profit))}`;
        }

        cardsHtml += `
            <div class="dds-card ${cardClass}">
                <div class="dds-salon-name">🏪 ${escapeHtml(salon)}</div>
                <div class="dds-revenue">Выручка: ${formatCurrency(revenue)}</div>
                <div class="dds-profit">${profitDisplay}</div>
                <div class="dds-status">${statusText}</div>
            </div>`;
    });

    let totalClass = '';
    let totalValueDisplay;
    if (totalRevenue === 0) {
        totalClass = '';
        totalValueDisplay = '— нет данных';
    } else if (totalProfit >= 0) {
        totalClass = 'positive';
        totalValueDisplay = `▲ +${formatCurrency(totalProfit)} — в плюсе`;
    } else {
        totalClass = 'negative';
        totalValueDisplay = `▼ −${formatCurrency(Math.abs(totalProfit))} — в минусе`;
    }

    cardsHtml += `
        <div class="dds-total-card ${totalClass}">
            <div>
                <div class="dds-total-label">Итого за вчера (все салоны)</div>
                <div style="font-size:12px;opacity:0.75;margin-top:2px;">Общая выручка: ${formatCurrency(totalRevenue)}</div>
            </div>
            <div class="dds-total-value">${totalValueDisplay}</div>
        </div>`;

    container.innerHTML = cardsHtml;
}

window.renderDashboardDailySales = renderDashboardDailySales;

// ============================================================
// Дашборд: история ежедневных продаж за последнюю неделю (аккордеон)
// ============================================================

function dateToStr(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function getLastNDaysStrs(n) {
    // Возвращает список из N последних прошедших дней (без сегодня), начиная со вчера
    const result = [];
    const today = new Date();
    for (let i = 1; i <= n; i++) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
        result.push(dateToStr(d));
    }
    return result; // от вчера (i=1) до i=N
}

function getDayNameShortRu(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const names = ['вс','пн','вт','ср','чт','пт','сб'];
    return names[date.getDay()];
}

function toggleDashboardDailyHistory() {
    const btn = document.getElementById('dashboardDailyHistoryToggle');
    const text = document.getElementById('dashboardDailyHistoryToggleText');
    const content = document.getElementById('dashboardDailyHistory');
    if (!btn || !content || !text) return;

    const isOpen = content.style.display !== 'none';
    if (isOpen) {
        content.style.display = 'none';
        btn.classList.remove('expanded');
        text.textContent = '📊 Показать историю за неделю';
    } else {
        renderDashboardDailyHistory();
        content.style.display = 'block';
        btn.classList.add('expanded');
        text.textContent = '📊 Скрыть историю';
    }
}

function renderDashboardDailyHistory() {
    const container = document.getElementById('dashboardDailyHistory');
    if (!container) return;

    const days = getLastNDaysStrs(7); // вчера + 6 дней до него = 7 дней

    let rowsHtml = '';
    let weekTotalRevenue = 0;
    let weekTotalProfit = 0;
    let hasAnyData = false;

    days.forEach(dateStr => {
        let dayRevenue = 0;
        let dayProfit = 0;
        let dayHasData = false;
        const salonRows = [];

        SALONS.forEach(salon => {
            const entry = findDailySalesEntry(salon, dateStr);
            const revenue = entry ? parseFloat(entry.revenue) || 0 : 0;
            const fixedShare = getDailyFixedShare(salon, dateStr);
            const profit = (revenue / 2) - fixedShare;

            if (revenue > 0) {
                dayHasData = true;
                hasAnyData = true;
                dayRevenue += revenue;
                dayProfit += profit;
            }

            let profitClass, profitDisplay;
            if (revenue === 0) {
                profitClass = 'empty';
                profitDisplay = '—';
            } else if (profit >= 0) {
                profitClass = 'positive';
                profitDisplay = `+${formatCurrency(profit)}`;
            } else {
                profitClass = 'negative';
                profitDisplay = `−${formatCurrency(Math.abs(profit))}`;
            }

            salonRows.push({ salon, revenue, profit, profitClass, profitDisplay });
        });

        const dayLabel = formatDateRu(dateStr);
        const dayName = getDayNameShortRu(dateStr);

        // Строки по салонам (первая строка в дне — с датой, остальные пустые rowspan)
        salonRows.forEach((r, idx) => {
            const dateCell = idx === 0
                ? `<td class="date-cell" rowspan="${salonRows.length + 1}">${dayLabel}<br><span class="day-label">${dayName}</span></td>`
                : '';
            rowsHtml += `
                <tr>
                    ${dateCell}
                    <td class="salon-cell">${escapeHtml(r.salon)}</td>
                    <td class="revenue-cell">${r.revenue > 0 ? formatCurrency(r.revenue) : '—'}</td>
                    <td class="profit-cell ${r.profitClass}">${r.profitDisplay}</td>
                </tr>`;
        });

        // Строка-итог за день
        let dayTotalClass, dayTotalDisplay;
        if (!dayHasData) {
            dayTotalClass = 'empty';
            dayTotalDisplay = '—';
        } else if (dayProfit >= 0) {
            dayTotalClass = 'positive';
            dayTotalDisplay = `▲ +${formatCurrency(dayProfit)}`;
        } else {
            dayTotalClass = 'negative';
            dayTotalDisplay = `▼ −${formatCurrency(Math.abs(dayProfit))}`;
        }
        rowsHtml += `
            <tr class="day-total">
                <td class="salon-cell">Итого за день</td>
                <td class="revenue-cell">${dayHasData ? formatCurrency(dayRevenue) : '—'}</td>
                <td class="profit-cell ${dayTotalClass}">${dayTotalDisplay}</td>
            </tr>`;

        weekTotalRevenue += dayRevenue;
        weekTotalProfit += dayProfit;
    });

    let tableHtml;
    if (!hasAnyData) {
        tableHtml = `<div class="dds-history-empty">Нет данных за последнюю неделю. Добавьте выручку в подразделе Продажи → Ежедневные продажи.</div>`;
    } else {
        tableHtml = `
            <div class="dds-history-table-wrap">
                <table class="dds-history-table">
                    <thead>
                        <tr>
                            <th>Дата</th>
                            <th>Салон</th>
                            <th style="text-align:right;">Выручка</th>
                            <th style="text-align:right;">Прибыль</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>`;
    }

    // Итог за неделю
    let weekSummaryHtml = '';
    if (hasAnyData) {
        let summaryClass, summaryValue;
        if (weekTotalProfit >= 0) {
            summaryClass = 'positive';
            summaryValue = `▲ +${formatCurrency(weekTotalProfit)} — в плюсе`;
        } else {
            summaryClass = 'negative';
            summaryValue = `▼ −${formatCurrency(Math.abs(weekTotalProfit))} — в минусе`;
        }
        weekSummaryHtml = `
            <div class="dds-history-summary ${summaryClass}">
                <div>
                    <div class="label">Итого за 7 дней (все салоны)</div>
                    <div style="font-size:12px;opacity:0.75;margin-top:2px;">Общая выручка: ${formatCurrency(weekTotalRevenue)}</div>
                </div>
                <div class="value">${summaryValue}</div>
            </div>`;
    }

    container.innerHTML = tableHtml + weekSummaryHtml;
}

window.toggleDashboardDailyHistory = toggleDashboardDailyHistory;
window.renderDashboardDailyHistory = renderDashboardDailyHistory;

// ============================================================
// ТОВАР В ПУТИ (Shipments)
//   Модель: appData.shipments = [{
//     id, sendDate, cargo, supplier, placesTotal, weightTotal,
//     deliveryCost, contents,
//     receipts: [{id, date, places, weightKg, note}],
//     archived: false, createdAt
//   }]
//   Статусы:
//     - in-transit : ничего не получено
//     - partial    : часть получена, ещё в пути
//     - received   : всё получено (archived = true)
// ============================================================

function shipmentReceivedPlaces(s) {
    return (s.receipts || []).reduce((sum, r) => sum + (parseInt(r.places, 10) || 0), 0);
}
function shipmentReceivedWeight(s) {
    return (s.receipts || []).reduce((sum, r) => sum + (parseFloat(r.weightKg) || 0), 0);
}
function shipmentRemainingPlaces(s) {
    return Math.max(0, (parseInt(s.placesTotal, 10) || 0) - shipmentReceivedPlaces(s));
}
function shipmentStatus(s) {
    if (s.archived) return 'received';
    const total = parseInt(s.placesTotal, 10) || 0;
    const recvd = shipmentReceivedPlaces(s);
    if (recvd === 0) return 'in-transit';
    if (recvd >= total) return 'received';
    return 'partial';
}
function shipmentStatusLabel(status) {
    if (status === 'received') return { text: '✓ Получено', cls: 'received', icon: '✓' };
    if (status === 'partial')  return { text: '🚚 Частично получено', cls: 'partial', icon: '🚚' };
    return { text: 'В пути', cls: 'in-transit', icon: '🚚' };
}

function formatShipmentDate(dateStr) {
    if (!dateStr) return '—';
    return formatDateRu(dateStr);
}

function openShipmentForm(editId = null) {
    const container = document.getElementById('shipmentFormContainer');
    const title     = document.getElementById('shipmentFormTitle');
    const idField   = document.getElementById('shipmentEditId');
    if (!container) return;

    if (editId) {
        const sh = (appData.shipments || []).find(x => x.id == editId);
        if (!sh) return;
        title.textContent = 'Редактировать отправку';
        idField.value = sh.id;
        document.getElementById('shipmentSendDate').value     = sh.sendDate || '';
        document.getElementById('shipmentCargo').value        = sh.cargo || '';
        document.getElementById('shipmentPlacesTotal').value  = sh.placesTotal || '';
        document.getElementById('shipmentWeightTotal').value  = sh.weightTotal || '';
        document.getElementById('shipmentSupplier').value     = sh.supplier || '';
        document.getElementById('shipmentDeliveryCost').value = sh.deliveryCost || '';
        document.getElementById('shipmentContents').value     = sh.contents || '';
    } else {
        title.textContent = 'Новая отправка';
        idField.value = '';
        const t = new Date();
        const today = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
        document.getElementById('shipmentSendDate').value     = today;
        document.getElementById('shipmentCargo').value        = '';
        document.getElementById('shipmentPlacesTotal').value  = '';
        document.getElementById('shipmentWeightTotal').value  = '';
        document.getElementById('shipmentSupplier').value     = '';
        document.getElementById('shipmentDeliveryCost').value = '';
        document.getElementById('shipmentContents').value     = '';
    }
    container.style.display = 'block';
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeShipmentForm() {
    const container = document.getElementById('shipmentFormContainer');
    if (container) container.style.display = 'none';
}

async function saveShipment() {
    const editId       = document.getElementById('shipmentEditId').value;
    const sendDate     = document.getElementById('shipmentSendDate').value;
    const cargo        = document.getElementById('shipmentCargo').value.trim();
    const placesTotal  = parseInt(document.getElementById('shipmentPlacesTotal').value, 10);
    const weightTotal  = parseFloat(document.getElementById('shipmentWeightTotal').value) || 0;
    const supplier     = document.getElementById('shipmentSupplier').value.trim();
    const deliveryCost = parseFloat(document.getElementById('shipmentDeliveryCost').value) || 0;
    const contents     = document.getElementById('shipmentContents').value.trim();

    if (!sendDate)                  { alert('Укажите дату отправки'); return; }
    if (!cargo)                     { alert('Укажите карго / перевозчика'); return; }
    if (!placesTotal || placesTotal < 1) { alert('Укажите количество мест (минимум 1)'); return; }

    appData.shipments = appData.shipments || [];

    if (editId) {
        const sh = appData.shipments.find(x => x.id == editId);
        if (!sh) return;
        sh.sendDate     = sendDate;
        sh.cargo        = cargo;
        sh.placesTotal  = placesTotal;
        sh.weightTotal  = weightTotal;
        sh.supplier     = supplier;
        sh.deliveryCost = deliveryCost;
        sh.contents     = contents;
        sh.updatedAt    = new Date().toISOString();
    } else {
        appData.shipments.push({
            id: Date.now() + Math.floor(Math.random() * 1000),
            sendDate, cargo, supplier,
            placesTotal, weightTotal, deliveryCost, contents,
            receipts: [],
            archived: false,
            createdAt: new Date().toISOString()
        });
    }

    try {
        await saveData();
        closeShipmentForm();
        renderShipments();
        if (typeof renderDashboardShipments === 'function') renderDashboardShipments();
        if (typeof showSuccess === 'function') showSuccess('Отправка сохранена');
    } catch (e) {
        console.error(e);
        alert('Не удалось сохранить отправку');
    }
}

async function deleteShipment(id) {
    if (!confirm('Удалить эту отправку? Это действие необратимо.')) return;
    appData.shipments = (appData.shipments || []).filter(x => x.id != id);
    try {
        await saveData();
        renderShipments();
        if (typeof renderDashboardShipments === 'function') renderDashboardShipments();
    } catch (e) {
        console.error(e);
        alert('Не удалось удалить отправку');
    }
}

function toggleReceiveForm(id) {
    const form = document.getElementById(`receiveForm_${id}`);
    if (!form) return;
    const isOpen = form.style.display !== 'none';
    // Закрываем все остальные формы приёма
    document.querySelectorAll('.receive-form').forEach(f => { f.style.display = 'none'; });
    form.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
        const placesInput = form.querySelector(`#receivePlaces_${id}`);
        if (placesInput) {
            placesInput.focus();
            placesInput.select();
        }
    }
}

function toggleReceiptsHistory(id) {
    const block = document.getElementById(`receiptsHistory_${id}`);
    if (!block) return;
    block.style.display = block.style.display === 'none' ? 'block' : 'none';
}

async function addReceipt(id) {
    const placesInput = document.getElementById(`receivePlaces_${id}`);
    const weightInput = document.getElementById(`receiveWeight_${id}`);
    const dateInput   = document.getElementById(`receiveDate_${id}`);
    const noteInput   = document.getElementById(`receiveNote_${id}`);
    if (!placesInput || !dateInput) return;

    const places = parseInt(placesInput.value, 10);
    const weight = parseFloat(weightInput.value) || 0;
    const date   = dateInput.value;
    const note   = (noteInput && noteInput.value || '').trim();

    if (!places || places < 1) { alert('Укажите количество прибывших мест'); return; }
    if (!date)                 { alert('Укажите дату прибытия'); return; }

    const sh = (appData.shipments || []).find(x => x.id == id);
    if (!sh) return;

    const remaining = shipmentRemainingPlaces(sh);
    if (places > remaining) {
        if (!confirm(`Указано ${places} мест, а в пути осталось только ${remaining}. Всё равно записать ${places}?`)) return;
    }

    sh.receipts = sh.receipts || [];
    sh.receipts.push({
        id: Date.now() + Math.floor(Math.random() * 1000),
        date, places, weightKg: weight, note
    });

    // Если всё получено — архивировать автоматически
    const totalRecvd = shipmentReceivedPlaces(sh);
    if (totalRecvd >= (parseInt(sh.placesTotal, 10) || 0)) {
        sh.archived = true;
        sh.archivedAt = new Date().toISOString();
    }

    try {
        await saveData();
        renderShipments();
        if (typeof renderDashboardShipments === 'function') renderDashboardShipments();
    } catch (e) {
        console.error(e);
        alert('Не удалось записать приём');
    }
}

async function deleteReceipt(shipmentId, receiptId) {
    if (!confirm('Удалить эту запись о приёме?')) return;
    const sh = (appData.shipments || []).find(x => x.id == shipmentId);
    if (!sh) return;
    sh.receipts = (sh.receipts || []).filter(r => r.id != receiptId);
    // Если был архив, но теперь не всё получено — вернуть в активные
    const totalRecvd = shipmentReceivedPlaces(sh);
    if (totalRecvd < (parseInt(sh.placesTotal, 10) || 0)) {
        sh.archived = false;
        delete sh.archivedAt;
    }
    try {
        await saveData();
        renderShipments();
        if (typeof renderDashboardShipments === 'function') renderDashboardShipments();
    } catch (e) {
        console.error(e);
        alert('Не удалось удалить запись');
    }
}

async function unarchiveShipment(id) {
    const sh = (appData.shipments || []).find(x => x.id == id);
    if (!sh) return;
    if (!confirm('Вернуть отправку из архива в активные?')) return;
    sh.archived = false;
    delete sh.archivedAt;
    try {
        await saveData();
        renderShipments();
        if (typeof renderDashboardShipments === 'function') renderDashboardShipments();
    } catch (e) {
        console.error(e);
    }
}

function switchShipmentsTab(tabName) {
    document.querySelectorAll('#shipmentsSection .tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('#shipmentsSection .section-tab').forEach(t => t.classList.remove('active'));
    const map = { 'active-shipments': 'activeShipmentsTab', 'archived-shipments': 'archivedShipmentsTab' };
    const tabEl = document.getElementById(map[tabName]);
    if (tabEl) tabEl.classList.add('active');
    const btn = document.querySelector(`#shipmentsSection .section-tab[data-section="${tabName}"]`);
    if (btn) btn.classList.add('active');
    renderShipments();
}

function renderShipmentCard(s) {
    const status = shipmentStatus(s);
    const statusInfo = shipmentStatusLabel(status);
    const totalPlaces = parseInt(s.placesTotal, 10) || 0;
    const recvdPlaces = shipmentReceivedPlaces(s);
    const remPlaces   = shipmentRemainingPlaces(s);
    const recvdWeight = shipmentReceivedWeight(s);
    const totalWeight = parseFloat(s.weightTotal) || 0;
    const percentage  = totalPlaces > 0 ? Math.min(100, (recvdPlaces / totalPlaces) * 100) : 0;

    const statusIconHtml = status === 'in-transit' || status === 'partial'
        ? `<span class="shipment-status-icon in-transit-truck">🚚</span>`
        : `<span class="shipment-status-icon">✓</span>`;

    const contentsHtml = s.contents ? `
        <div class="shipment-contents">
            <div class="label">Содержимое</div>
            <div>${escapeHtml(s.contents)}</div>
        </div>` : '';

    const receiptsHtml = (s.receipts && s.receipts.length > 0) ? `
        <div class="receipts-history" id="receiptsHistory_${s.id}" style="display:none;">
            <h5>История приёмов (${s.receipts.length})</h5>
            ${s.receipts.slice().sort((a,b) => (a.date || '').localeCompare(b.date || '')).map(r => `
                <div class="receipt-event">
                    <span class="date">${formatShipmentDate(r.date)}${r.note ? ` · ${escapeHtml(r.note)}` : ''}</span>
                    <span class="qty">
                        ${r.places} мест${r.weightKg > 0 ? ` · ${r.weightKg} кг` : ''}
                        <button class="mini-del" onclick="deleteReceipt(${s.id}, ${r.id})" title="Удалить запись">×</button>
                    </span>
                </div>
            `).join('')}
        </div>` : '';

    const receiveFormHtml = !s.archived ? `
        <div class="receive-form" id="receiveForm_${s.id}" style="display:none;">
            <h5>📥 Приём груза</h5>
            <div class="receive-form-grid">
                <div class="form-group">
                    <label>Дата прибытия</label>
                    <input type="date" id="receiveDate_${s.id}" value="${new Date().toISOString().slice(0,10)}">
                </div>
                <div class="form-group">
                    <label>Прибыло мест (осталось: ${remPlaces})</label>
                    <input type="number" min="1" step="1" id="receivePlaces_${s.id}" placeholder="0" value="${remPlaces}">
                </div>
                <div class="form-group">
                    <label>Прибыло (кг)</label>
                    <input type="number" min="0" step="0.01" id="receiveWeight_${s.id}" placeholder="0">
                </div>
                <div class="form-group">
                    <label>Комментарий (необяз.)</label>
                    <input type="text" id="receiveNote_${s.id}" placeholder="Напр. 2 коробки повреждены">
                </div>
            </div>
            <div class="receive-form-actions">
                <button class="shipment-btn shipment-btn-receive" onclick="addReceipt(${s.id})">✓ Записать приём</button>
                <button class="shipment-btn shipment-btn-history" onclick="toggleReceiveForm(${s.id})">Отмена</button>
            </div>
        </div>` : '';

    const itemsCount = (s.items && s.items.length) ? s.items.length : 0;
    const itemsBtn = `<button class="shipment-btn shipment-btn-items" onclick="toggleShipmentItems(${s.id})">📋 Состав${itemsCount ? ` (${itemsCount})` : ''}</button>`;

    const actionsHtml = s.archived ? `
        <div class="shipment-actions">
            ${itemsBtn}
            ${(s.receipts && s.receipts.length > 0) ? `<button class="shipment-btn shipment-btn-history" onclick="toggleReceiptsHistory(${s.id})">📋 История приёмов</button>` : ''}
            <button class="shipment-btn shipment-btn-edit" onclick="unarchiveShipment(${s.id})">↩️ Вернуть в активные</button>
            <button class="shipment-btn shipment-btn-delete" onclick="deleteShipment(${s.id})">🗑 Удалить</button>
        </div>` : `
        <div class="shipment-actions">
            <button class="shipment-btn shipment-btn-receive" onclick="toggleReceiveForm(${s.id})">📥 Принять груз</button>
            ${itemsBtn}
            ${(s.receipts && s.receipts.length > 0) ? `<button class="shipment-btn shipment-btn-history" onclick="toggleReceiptsHistory(${s.id})">📋 История (${s.receipts.length})</button>` : ''}
            <button class="shipment-btn shipment-btn-edit" onclick="openShipmentForm(${s.id})">✎ Редактировать</button>
            <button class="shipment-btn shipment-btn-delete" onclick="deleteShipment(${s.id})">🗑 Удалить</button>
        </div>`;

    return `
        <div class="shipment-card status-${status}">
            <div class="shipment-header">
                <div>
                    <div class="shipment-title">📦 ${escapeHtml(s.cargo || 'Без названия')}</div>
                    <div class="shipment-date-info">
                        Отправлено: ${formatShipmentDate(s.sendDate)}
                        ${s.supplier ? ` · Поставщик: ${escapeHtml(s.supplier)}` : ''}
                    </div>
                </div>
                <span class="shipment-status-badge ${statusInfo.cls}">
                    ${statusIconHtml}
                    ${statusInfo.text}
                </span>
            </div>
            <div class="shipment-body">
                <div class="shipment-info-grid">
                    <div class="shipment-info-item">
                        <div class="label">Мест всего</div>
                        <div class="value">${totalPlaces}</div>
                    </div>
                    <div class="shipment-info-item">
                        <div class="label">Получено</div>
                        <div class="value received">${recvdPlaces}</div>
                    </div>
                    <div class="shipment-info-item">
                        <div class="label">Ещё в пути</div>
                        <div class="value ${remPlaces > 0 ? 'transit' : ''}">${remPlaces}</div>
                    </div>
                    <div class="shipment-info-item">
                        <div class="label">Вес получено / всего</div>
                        <div class="value">${recvdWeight ? recvdWeight.toFixed(2) : '0'} / ${totalWeight || '—'} кг</div>
                    </div>
                    ${s.deliveryCost > 0 ? `
                    <div class="shipment-info-item">
                        <div class="label">Стоимость доставки</div>
                        <div class="value">${formatCurrency(s.deliveryCost)}</div>
                    </div>` : ''}
                </div>
                <div class="shipment-progress">
                    <div class="shipment-progress-bar">
                        <div class="shipment-progress-fill" style="width: ${percentage}%;"></div>
                    </div>
                    <div class="shipment-progress-text">
                        <span>${recvdPlaces} из ${totalPlaces} мест</span>
                        <span>${percentage.toFixed(0)}%</span>
                    </div>
                </div>
                ${contentsHtml}
                ${receiptsHtml}
                ${receiveFormHtml}
                ${actionsHtml}
                <div class="shipment-items" id="shipmentItems_${s.id}" style="display:none;"></div>
            </div>
        </div>`;
}

// ═════════════════════════════════════════════════════════════
// СОСТАВ ОТПРАВКИ (товары внутри отправки)  [добавлено]
// ─────────────────────────────────────────────────────────────
//   Модель: shipment.items = [{
//     id, name, category, size,
//     qty,             // количество пар
//     photo,           // base64 data-URL (сжатое фото-превью) | ''
//     priceArrival,    // цена прихода (себестоимость)
//     priceFirst,      // первая цена
//     priceSecond,     // вторая цена
//     createdAt
//   }]
//   Категории/размеры берутся из раздела «Товары» (ОРТОБОТ):
//   products.category и product_variants.size_label.
// ═════════════════════════════════════════════════════════════

// Фиксированный список категорий обуви (как в разделе «Товары»).
const SHIPMENT_CATEGORIES = [
    'Мужская обувь',
    'Женская обувь',
    'Обувь для мальчиков',
    'Обувь для девочек',
    'Товар'
];

// Кэш чистых размеров по категории: { 'Мужская обувь': ['36','37',...] }
let shipmentSizesByCategory = null;
let shipmentSizesLoading = false;
let shipmentProductNames = null; // [{name, category}] для подсказок номенклатуры

// Нормализует «грязный» size_label из 1С в короткую метку размера.
// Примеры: "размер:42.5" -> "42.5", "Размер 38" -> "38",
//          "цвет:черный размер:40" -> "40", "размер:стандарт" -> "стандарт"
function normalizeSizeLabel(raw) {
    if (!raw) return '';
    let s = String(raw).trim();
    // вырезаем "цвет:... " префикс
    s = s.replace(/цвет:[^\s]+\s*/gi, '');
    // если есть "размер" — берём то, что после него
    const m = s.match(/размер[ы]?\s*[:\-]?\s*(.+)$/i);
    if (m && m[1]) s = m[1];
    s = s.replace(/\s+/g, ' ').trim();
    // приводим запятую к точке в числах: 38,5 -> 38.5
    s = s.replace(/(\d),(\d)/g, '$1.$2');
    return s;
}

// Загружает и кэширует чистые размеры по категориям из ОРТОБОТ.
async function loadShipmentSizeOptions() {
    if (shipmentSizesByCategory || shipmentSizesLoading) return;
    shipmentSizesLoading = true;
    try {
        // products: id, name_ru, category
        const products = await fetchAllRows('products', 'id,name_ru,category,is_active');
        // product_variants: product_id, size_label
        const variants = await fetchAllRows('product_variants', 'product_id,size_label');

        const prodCat = {};
        const namesSet = [];
        const seenNames = new Set();
        (products || []).forEach(p => {
            prodCat[p.id] = (p.category || '').trim();
            const nm = (p.name_ru || '').trim();
            if (nm && !seenNames.has(nm.toLowerCase())) {
                seenNames.add(nm.toLowerCase());
                namesSet.push({ name: nm, category: (p.category || '').trim() });
            }
        });
        shipmentProductNames = namesSet.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

        const byCat = {};
        SHIPMENT_CATEGORIES.forEach(c => { byCat[c] = new Set(); });
        (variants || []).forEach(v => {
            const cat = prodCat[v.product_id];
            if (!cat || !(cat in byCat)) return;
            const norm = normalizeSizeLabel(v.size_label);
            if (norm) byCat[cat].add(norm);
        });

        // Сортировка: числовые размеры по возрастанию, затем буквенные/прочие.
        const sortSizes = arr => arr.sort((a, b) => {
            const na = parseFloat(String(a).replace(',', '.'));
            const nb = parseFloat(String(b).replace(',', '.'));
            const aNum = !isNaN(na), bNum = !isNaN(nb);
            if (aNum && bNum) return na - nb;
            if (aNum) return -1;
            if (bNum) return 1;
            return String(a).localeCompare(String(b), 'ru');
        });

        shipmentSizesByCategory = {};
        Object.keys(byCat).forEach(c => {
            shipmentSizesByCategory[c] = sortSizes(Array.from(byCat[c]));
        });
    } catch (e) {
        console.warn('Не удалось загрузить размеры для отправок:', e);
        shipmentSizesByCategory = {};
        SHIPMENT_CATEGORIES.forEach(c => { shipmentSizesByCategory[c] = []; });
    } finally {
        shipmentSizesLoading = false;
    }
}

// Сжимает выбранное фото в небольшое JPEG-превью (data-URL).
// maxSize — максимальная сторона в px; quality — качество JPEG (0..1).
function compressImageFile(file, maxSize = 420, quality = 0.6) {
    return new Promise((resolve, reject) => {
        if (!file || !file.type || !file.type.startsWith('image/')) {
            reject(new Error('Это не изображение'));
            return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Ошибка чтения файла'));
        reader.onload = e => {
            const img = new Image();
            img.onerror = () => reject(new Error('Ошибка загрузки изображения'));
            img.onload = () => {
                let { width, height } = img;
                if (width > height && width > maxSize) {
                    height = Math.round(height * maxSize / width);
                    width = maxSize;
                } else if (height >= width && height > maxSize) {
                    width = Math.round(width * maxSize / height);
                    height = maxSize;
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                // белый фон (на случай PNG с прозрачностью)
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                try {
                    resolve(canvas.toDataURL('image/jpeg', quality));
                } catch (err) {
                    reject(err);
                }
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// HTML списка <option> размеров для категории.
function shipmentSizeOptionsHtml(category, selected) {
    const sizes = (shipmentSizesByCategory && shipmentSizesByCategory[category]) || [];
    let html = '<option value="">— размер —</option>';
    sizes.forEach(sz => {
        const sel = (selected != null && String(selected) === String(sz)) ? ' selected' : '';
        html += `<option value="${escapeHtml(sz)}"${sel}>${escapeHtml(sz)}</option>`;
    });
    // если у товара сохранён нестандартный размер — показать его тоже
    if (selected && !sizes.some(s => String(s) === String(selected))) {
        html += `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}</option>`;
    }
    return html;
}

function shipmentCategoryOptionsHtml(selected) {
    let html = '<option value="">— категория —</option>';
    SHIPMENT_CATEGORIES.forEach(c => {
        const sel = (selected === c) ? ' selected' : '';
        html += `<option value="${escapeHtml(c)}"${sel}>${escapeHtml(c)}</option>`;
    });
    return html;
}

// Открыть/закрыть блок состава отправки.
async function toggleShipmentItems(shipmentId) {
    const block = document.getElementById(`shipmentItems_${shipmentId}`);
    if (!block) return;
    const willOpen = block.style.display === 'none' || !block.style.display;
    if (willOpen) {
        // подгружаем справочник размеров при первом раскрытии
        if (!shipmentSizesByCategory) {
            block.innerHTML = `<div class="ship-items-loading">Загрузка справочника товаров…</div>`;
            block.style.display = 'block';
            await loadShipmentSizeOptions();
        }
        renderShipmentItems(shipmentId);
        block.style.display = 'block';
    } else {
        block.style.display = 'none';
    }
}

// Отрисовка состава конкретной отправки.
function renderShipmentItems(shipmentId) {
    const block = document.getElementById(`shipmentItems_${shipmentId}`);
    if (!block) return;
    const sh = (appData.shipments || []).find(x => x.id == shipmentId);
    if (!sh) return;
    sh.items = sh.items || [];

    const list = sh.items.map(it => renderShipmentItemRow(shipmentId, it)).join('');
    const datalistId = `shipItemNames_${shipmentId}`;
    const namesDatalist = shipmentProductNames && shipmentProductNames.length
        ? `<datalist id="${datalistId}">${shipmentProductNames.slice(0, 1500).map(n => `<option value="${escapeHtml(n.name)}">`).join('')}</datalist>`
        : '';

    // Итого: сколько пар всего должны получить по отправке.
    const totalQty = sh.items.reduce((sum, it) => sum + itemTotalQty(it), 0);
    const totalPositions = sh.items.length;
    const totalsHtml = totalPositions > 0 ? `
        <div class="ship-items-total">
            <span>Позиций: <b>${totalPositions}</b></span>
            <span>Всего к получению: <b>${totalQty}</b> ${pluralizeRu(totalQty, ['пара','пары','пар'])}</span>
        </div>` : '';

    block.innerHTML = `
        ${namesDatalist}
        <div class="ship-items-head">
            <h5 style="margin:0;">📋 Состав отправки (${sh.items.length})</h5>
            <button class="shipment-btn shipment-btn-receive" onclick="addShipmentItem(${shipmentId})">➕ Добавить товар</button>
        </div>
        <div class="ship-items-list">
            ${list || '<div class="ship-items-empty">Товары ещё не добавлены.</div>'}
        </div>
        ${totalsHtml}`;
}

// Обновляет только строку итогов (без перерисовки списка — чтобы не терять фокус).
function updateShipmentItemsTotal(shipmentId) {
    const block = document.getElementById(`shipmentItems_${shipmentId}`);
    if (!block) return;
    const sh = (appData.shipments || []).find(x => x.id == shipmentId);
    if (!sh || !sh.items) return;
    const totalQty = sh.items.reduce((sum, it) => sum + itemTotalQty(it), 0);
    const totalPositions = sh.items.length;
    let totalEl = block.querySelector('.ship-items-total');
    if (totalPositions === 0) { if (totalEl) totalEl.remove(); return; }
    const html = `
            <span>Позиций: <b>${totalPositions}</b></span>
            <span>Всего к получению: <b>${totalQty}</b> ${pluralizeRu(totalQty, ['пара','пары','пар'])}</span>`;
    if (totalEl) {
        totalEl.innerHTML = html;
    } else {
        totalEl = document.createElement('div');
        totalEl.className = 'ship-items-total';
        totalEl.innerHTML = html;
        block.appendChild(totalEl);
    }
    // обновляем счётчик пар на кнопке «Состав» в карточке отправки
    const btn = document.querySelector(`.shipment-card .shipment-btn-items[onclick*="toggleShipmentItems(${shipmentId})"]`);
    if (btn) btn.innerHTML = `📋 Состав (${totalPositions})`;
}

// Приводит товар к новой модели (sizes: [{id,size,qty}]).
// Старые товары имели одиночные поля size/qty — переносим их в массив.
function normalizeShipmentItem(it) {
    if (!Array.isArray(it.sizes)) {
        const arr = [];
        if (it.size || (it.qty !== '' && it.qty != null)) {
            arr.push({ id: 'sz' + Date.now() + Math.floor(Math.random()*1000), size: it.size || '', qty: (it.qty === '' || it.qty == null) ? '' : it.qty });
        }
        it.sizes = arr;
    }
    delete it.size; delete it.qty;
    return it;
}

// Сумма пар по всем размерам товара.
function itemTotalQty(it) {
    if (!Array.isArray(it.sizes)) return 0;
    return it.sizes.reduce((s, r) => s + (parseInt(r.qty, 10) || 0), 0);
}

// Строка одного размера внутри товара.
function renderItemSizeRow(shipmentId, it, row) {
    return `
        <div class="ship-size-row" id="shipSizeRow_${shipmentId}_${it.id}_${row.id}">
            <select class="ship-size-select" id="shipSizeSel_${shipmentId}_${it.id}_${row.id}"
                    onchange="updateItemSize(${shipmentId}, '${it.id}', '${row.id}', 'size', this.value)">
                ${shipmentSizeOptionsHtml(it.category || '', row.size || '')}
            </select>
            <input type="number" min="0" step="1" class="ship-size-qty"
                   value="${row.qty != null && row.qty !== '' ? row.qty : ''}" placeholder="кол-во"
                   oninput="updateItemSize(${shipmentId}, '${it.id}', '${row.id}', 'qty', this.value)">
            <button class="ship-size-del" onclick="deleteItemSize(${shipmentId}, '${it.id}', '${row.id}')" title="Удалить размер">×</button>
        </div>`;
}

// Карточка одного товара в составе отправки.
function renderShipmentItemRow(shipmentId, it) {
    normalizeShipmentItem(it);
    const photoHtml = it.photo
        ? `<img src="${it.photo}" class="ship-item-photo" alt="фото" onclick="viewShipmentPhoto('${shipmentId}','${it.id}')" title="Открыть фото">`
        : `<div class="ship-item-photo ship-item-photo-empty">нет фото</div>`;

    const sizeRows = it.sizes.map(r => renderItemSizeRow(shipmentId, it, r)).join('');
    const itemQty = itemTotalQty(it);

    return `
    <div class="ship-item-card" id="shipItem_${shipmentId}_${it.id}">
        <div class="ship-item-photo-wrap">
            ${photoHtml}
            <label class="ship-item-photo-btn">
                📷 Фото
                <input type="file" accept="image/*" style="display:none;"
                       onchange="onShipmentItemPhoto(${shipmentId}, '${it.id}', this)">
            </label>
        </div>
        <div class="ship-item-fields">
            <div class="ship-item-field ship-item-field-name">
                <label>Номенклатура</label>
                <input type="text" list="shipItemNames_${shipmentId}" value="${escapeHtml(it.name || '')}"
                       placeholder="Название товара"
                       onchange="updateShipmentItem(${shipmentId}, '${it.id}', 'name', this.value)">
            </div>
            <div class="ship-item-field">
                <label>Категория</label>
                <select onchange="updateShipmentItem(${shipmentId}, '${it.id}', 'category', this.value)">
                    ${shipmentCategoryOptionsHtml(it.category || '')}
                </select>
            </div>
            <div class="ship-item-field">
                <label>Цена прихода</label>
                <input type="number" min="0" step="0.01" value="${it.priceArrival != null ? it.priceArrival : ''}"
                       placeholder="0.00"
                       onchange="updateShipmentItem(${shipmentId}, '${it.id}', 'priceArrival', this.value)">
            </div>
            <div class="ship-item-field">
                <label>Первая цена</label>
                <input type="number" min="0" step="0.01" value="${it.priceFirst != null ? it.priceFirst : ''}"
                       placeholder="0.00"
                       onchange="updateShipmentItem(${shipmentId}, '${it.id}', 'priceFirst', this.value)">
            </div>
            <div class="ship-item-field">
                <label>Вторая цена</label>
                <input type="number" min="0" step="0.01" value="${it.priceSecond != null ? it.priceSecond : ''}"
                       placeholder="0.00"
                       onchange="updateShipmentItem(${shipmentId}, '${it.id}', 'priceSecond', this.value)">
            </div>
            <div class="ship-item-field ship-item-field-sizes">
                <label>Размеры и количество</label>
                <div class="ship-sizes-list" id="shipSizes_${shipmentId}_${it.id}">
                    ${sizeRows || '<div class="ship-sizes-empty">Размеры не добавлены</div>'}
                </div>
                <div class="ship-sizes-foot">
                    <button class="ship-addsize-btn" onclick="addItemSize(${shipmentId}, '${it.id}')">➕ Добавить размер</button>
                    <span class="ship-item-qty-total" id="shipItemQty_${shipmentId}_${it.id}">Итого: <b>${itemQty}</b> ${pluralizeRu(itemQty, ['пара','пары','пар'])}</span>
                </div>
            </div>
        </div>
        <button class="ship-item-del" onclick="deleteShipmentItem(${shipmentId}, '${it.id}')" title="Удалить товар">×</button>
    </div>`;
}

async function addShipmentItem(shipmentId) {
    const sh = (appData.shipments || []).find(x => x.id == shipmentId);
    if (!sh) return;
    sh.items = sh.items || [];
    sh.items.push({
        id: 'it' + Date.now() + Math.floor(Math.random() * 1000),
        name: '', category: '',
        photo: '', priceArrival: '', priceFirst: '', priceSecond: '',
        sizes: [{ id: 'sz' + Date.now() + Math.floor(Math.random()*1000), size: '', qty: '' }],
        createdAt: new Date().toISOString()
    });
    renderShipmentItems(shipmentId);
    try { await saveData(); } catch (e) { console.error(e); }
}

async function updateShipmentItem(shipmentId, itemId, field, value) {
    const sh = (appData.shipments || []).find(x => x.id == shipmentId);
    if (!sh || !sh.items) return;
    const it = sh.items.find(x => x.id === itemId);
    if (!it) return;

    if (field === 'priceArrival' || field === 'priceFirst' || field === 'priceSecond') {
        it[field] = value === '' ? '' : (parseFloat(value) || 0);
    } else {
        it[field] = value;
    }

    // При смене категории — обновляем списки размеров во всех строках размеров товара
    if (field === 'category') {
        normalizeShipmentItem(it);
        const available = (shipmentSizesByCategory && shipmentSizesByCategory[value]) || [];
        it.sizes.forEach(row => {
            if (row.size && !available.some(s => String(s) === String(row.size))) row.size = '';
            const sel = document.getElementById(`shipSizeSel_${shipmentId}_${itemId}_${row.id}`);
            if (sel) sel.innerHTML = shipmentSizeOptionsHtml(value, row.size || '');
        });
    }
    try { await saveData(); } catch (e) { console.error(e); }
}

// ——— Размеры внутри товара ———
async function addItemSize(shipmentId, itemId) {
    const sh = (appData.shipments || []).find(x => x.id == shipmentId);
    if (!sh || !sh.items) return;
    const it = sh.items.find(x => x.id === itemId);
    if (!it) return;
    normalizeShipmentItem(it);
    it.sizes.push({ id: 'sz' + Date.now() + Math.floor(Math.random()*1000), size: '', qty: '' });
    rerenderItemSizes(shipmentId, it);
    try { await saveData(); } catch (e) { console.error(e); }
}

async function updateItemSize(shipmentId, itemId, rowId, field, value) {
    const sh = (appData.shipments || []).find(x => x.id == shipmentId);
    if (!sh || !sh.items) return;
    const it = sh.items.find(x => x.id === itemId);
    if (!it || !Array.isArray(it.sizes)) return;
    const row = it.sizes.find(r => r.id === rowId);
    if (!row) return;
    if (field === 'qty') {
        row.qty = value === '' ? '' : (parseInt(value, 10) || 0);
        // обновляем итоги без перерисовки (чтобы не терять фокус)
        updateItemQtyTotal(shipmentId, it);
        updateShipmentItemsTotal(shipmentId);
    } else {
        row.size = value;
    }
    try { await saveData(); } catch (e) { console.error(e); }
}

async function deleteItemSize(shipmentId, itemId, rowId) {
    const sh = (appData.shipments || []).find(x => x.id == shipmentId);
    if (!sh || !sh.items) return;
    const it = sh.items.find(x => x.id === itemId);
    if (!it || !Array.isArray(it.sizes)) return;
    it.sizes = it.sizes.filter(r => r.id !== rowId);
    rerenderItemSizes(shipmentId, it);
    updateShipmentItemsTotal(shipmentId);
    try { await saveData(); } catch (e) { console.error(e); }
}

// Перерисовывает только список размеров одного товара.
function rerenderItemSizes(shipmentId, it) {
    const cont = document.getElementById(`shipSizes_${shipmentId}_${it.id}`);
    if (cont) {
        const rows = it.sizes.map(r => renderItemSizeRow(shipmentId, it, r)).join('');
        cont.innerHTML = rows || '<div class="ship-sizes-empty">Размеры не добавлены</div>';
    }
    updateItemQtyTotal(shipmentId, it);
}

// Обновляет итог по одному товару (всего пар).
function updateItemQtyTotal(shipmentId, it) {
    const el = document.getElementById(`shipItemQty_${shipmentId}_${it.id}`);
    if (!el) return;
    const q = itemTotalQty(it);
    el.innerHTML = `Итого: <b>${q}</b> ${pluralizeRu(q, ['пара','пары','пар'])}`;
}

async function onShipmentItemPhoto(shipmentId, itemId, input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const sh = (appData.shipments || []).find(x => x.id == shipmentId);
    if (!sh || !sh.items) return;
    const it = sh.items.find(x => x.id === itemId);
    if (!it) return;
    try {
        const dataUrl = await compressImageFile(file, 420, 0.6);
        it.photo = dataUrl;
        renderShipmentItems(shipmentId);
        await saveData();
        if (typeof showSuccess === 'function') showSuccess('Фото добавлено');
    } catch (e) {
        console.error(e);
        alert('Не удалось обработать фото: ' + (e && e.message ? e.message : ''));
    }
}

function viewShipmentPhoto(shipmentId, itemId) {
    const sh = (appData.shipments || []).find(x => x.id == shipmentId);
    if (!sh || !sh.items) return;
    const it = sh.items.find(x => x.id === itemId);
    if (!it || !it.photo) return;
    let overlay = document.getElementById('shipPhotoOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'shipPhotoOverlay';
        overlay.className = 'ship-photo-overlay';
        overlay.onclick = () => { overlay.style.display = 'none'; };
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<img src="${it.photo}" alt="фото товара">`;
    overlay.style.display = 'flex';
}

async function deleteShipmentItem(shipmentId, itemId) {
    if (!confirm('Удалить этот товар из состава отправки?')) return;
    const sh = (appData.shipments || []).find(x => x.id == shipmentId);
    if (!sh || !sh.items) return;
    sh.items = sh.items.filter(x => x.id !== itemId);
    renderShipmentItems(shipmentId);
    try { await saveData(); } catch (e) { console.error(e); }
}

window.toggleShipmentItems  = toggleShipmentItems;
window.loadShipmentSizeOptions = loadShipmentSizeOptions;
window.compressImageFile    = compressImageFile;
window.renderShipmentItems  = renderShipmentItems;
window.addShipmentItem      = addShipmentItem;
window.updateShipmentItem   = updateShipmentItem;
window.deleteShipmentItem   = deleteShipmentItem;
window.addItemSize          = addItemSize;
window.updateItemSize       = updateItemSize;
window.deleteItemSize       = deleteItemSize;
window.onShipmentItemPhoto  = onShipmentItemPhoto;
window.viewShipmentPhoto    = viewShipmentPhoto;


function renderShipments() {
    const activeCont   = document.getElementById('activeShipmentsContainer');
    const archivedCont = document.getElementById('archivedShipmentsContainer');
    if (!activeCont && !archivedCont) return;

    const all = appData.shipments || [];
    // Сортировка: сначала по дате отправки (новые сверху)
    const sortByDateDesc = (a, b) => (b.sendDate || '').localeCompare(a.sendDate || '');

    const active   = all.filter(s => !s.archived).sort(sortByDateDesc);
    const archived = all.filter(s =>  s.archived).sort(sortByDateDesc);

    if (activeCont) {
        if (active.length === 0) {
            activeCont.innerHTML = `<div class="shipments-empty">📭 Нет активных отправок. Нажмите «Новая отправка», чтобы добавить груз.</div>`;
        } else {
            activeCont.innerHTML = active.map(renderShipmentCard).join('');
        }
    }
    if (archivedCont) {
        if (archived.length === 0) {
            archivedCont.innerHTML = `<div class="shipments-empty">📭 Архив пуст. Полученные отправки будут появляться здесь.</div>`;
        } else {
            archivedCont.innerHTML = archived.map(renderShipmentCard).join('');
        }
    }
}

function renderDashboardShipments() {
    const container = document.getElementById('dashboardShipmentsList');
    const counter   = document.getElementById('dashboardShipmentsCount');
    if (!container) return;

    const active = (appData.shipments || []).filter(s => !s.archived);
    if (counter) counter.textContent = `${active.length} ${pluralizeRu(active.length, ['отправка','отправки','отправок'])} в пути`;

    if (active.length === 0) {
        container.innerHTML = `<div class="dashboard-shipments-empty">📭 Сейчас нет активных отправок.</div>`;
        return;
    }

    const sorted = active.slice().sort((a, b) => (b.sendDate || '').localeCompare(a.sendDate || ''));
    container.innerHTML = sorted.map(s => {
        const status = shipmentStatus(s);
        const total = parseInt(s.placesTotal, 10) || 0;
        const recvd = shipmentReceivedPlaces(s);
        const rem   = shipmentRemainingPlaces(s);
        const statusInfo = shipmentStatusLabel(status);
        return `
            <div class="dashboard-shipment-row ${status === 'partial' ? 'partial' : ''}" onclick="switchTab('shipments')" style="cursor:pointer;">
                <div class="dsh-main">
                    <span style="font-size:18px;">🚚</span>
                    <div>
                        <div class="dsh-cargo">${escapeHtml(s.cargo || 'Без названия')}</div>
                        <div class="dsh-meta">
                            Отправлено: ${formatShipmentDate(s.sendDate)}
                            ${s.supplier ? ` · ${escapeHtml(s.supplier)}` : ''}
                            · ${recvd}/${total} мест (${rem} ещё в пути)
                        </div>
                    </div>
                </div>
                <span class="dsh-status ${statusInfo.cls}">${statusInfo.text}</span>
            </div>`;
    }).join('');
}

function pluralizeRu(n, forms) {
    // forms: ['отправка','отправки','отправок']
    const mod10  = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if ([2,3,4].includes(mod10) && ![12,13,14].includes(mod100)) return forms[1];
    return forms[2];
}

window.openShipmentForm        = openShipmentForm;
window.closeShipmentForm       = closeShipmentForm;
window.saveShipment            = saveShipment;
window.deleteShipment          = deleteShipment;
window.toggleReceiveForm       = toggleReceiveForm;
window.toggleReceiptsHistory   = toggleReceiptsHistory;
window.addReceipt              = addReceipt;
window.deleteReceipt           = deleteReceipt;
window.unarchiveShipment       = unarchiveShipment;
window.switchShipmentsTab      = switchShipmentsTab;
window.renderShipments         = renderShipments;
window.renderDashboardShipments = renderDashboardShipments;


// ═════════════════════════════════════════════════════════════
// ЗАРПЛАТА ОТ ПРОДАЖ (2%) — подраздел вкладки «Зарплаты»
// ═════════════════════════════════════════════════════════════
// Считает зарплату продавцов как процент от выручки за выбранный период.
// Источник продаж — таблица Supabase employee_sales_1c (продажи по сотрудникам
// из 1С по дням, gross_sales — выручка БЕЗ возвратов). Процент по умолчанию 2%,
// либо commission_rate из справочника employees, если сотрудник сопоставлен по
// имени. Кнопка «Выплатить» фиксирует выплату в salary_payouts, добавляет
// затрату в expenses (категория «Зарплата») и в appData.fixedExpenses (чтобы
// выплата отразилась в чистой прибыли на главной), и блокирует повторную выплату
// за тот же период.

const SALES_SALARY_DEFAULT_RATE = 2.0;

// Кэш данных подраздела.
let employeeSales1C = [];        // [{ sellerRef, sellerName, date, gross, returns, receipts }]
let employeeSales1CLoaded = false;
let employeesDirectory = [];     // из таблицы employees: [{ id, name, commission_rate, is_active }]
let salaryPayoutsCache = [];     // из таблицы salary_payouts (для защиты от двойной выплаты)
let salaryExpenseCategoryId = null; // id категории «Зарплата» в expense_categories
let salesSalaryRange = null;     // { from:'YYYY-MM-DD', to:'YYYY-MM-DD' }
let salesSalaryLoading = false;
let employeeSales1CInflight = null; // промис текущей загрузки (защита от двойного запроса)

// Загрузка продаж по сотрудникам, справочника сотрудников и журнала выплат.
// Реентрантна: при параллельных вызовах (предзагрузка после логина + ленивый
// рендер подраздела) запрос к Supabase выполняется один раз.
function loadEmployeeSales1C() {
    if (employeeSales1CInflight) return employeeSales1CInflight;
    employeeSales1CInflight = (async () => {
    try {
        const [salesRes, empRes, payoutRes] = await Promise.all([
            supabaseClient.from('employee_sales_1c')
                .select('seller_ref,seller_name,sale_date,gross_sales,returns_sum,receipts_count'),
            supabaseClient.from('employees').select('id,name,commission_rate,is_active'),
            supabaseClient.from('salary_payouts')
                .select('id,seller_ref,employee_name,period_from,period_to,gross_sales,commission_rate,amount,created_at')
        ]);

        if (salesRes.error) throw salesRes.error;
        employeeSales1C = (salesRes.data || []).map(r => ({
            sellerRef: r.seller_ref,
            sellerName: (r.seller_name || '').trim(),
            date: r.sale_date,
            gross: parseFloat(r.gross_sales) || 0,
            returns: parseFloat(r.returns_sum) || 0,
            receipts: parseInt(r.receipts_count, 10) || 0
        }));
        employeeSales1CLoaded = true;

        // Справочник сотрудников и журнал выплат — не критичны: при ошибке просто
        // работаем без сопоставления процента / без истории выплат.
        employeesDirectory = (empRes && !empRes.error) ? (empRes.data || []) : [];
        salaryPayoutsCache = (payoutRes && !payoutRes.error) ? (payoutRes.data || []) : [];

        console.log(`employee_sales_1c загружено: ${employeeSales1C.length} строк, продавцов: ${new Set(employeeSales1C.map(s => s.sellerRef)).size}`);
    } catch (e) {
        console.error('Ошибка загрузки employee_sales_1c:', e);
        employeeSales1CLoaded = false;
    } finally {
        employeeSales1CInflight = null;
    }
    })();
    return employeeSales1CInflight;
}

// Доступные месяцы ('YYYY-MM', свежие сверху) по данным employee_sales_1c.
function availableEmployeeSalesYM() {
    const seen = new Set();
    employeeSales1C.forEach(s => { if (s.date) seen.add(s.date.slice(0, 7)); });
    return Array.from(seen).sort((a, b) => b.localeCompare(a));
}

function earliestEmployeeSaleDate() {
    let min = '';
    employeeSales1C.forEach(s => { if (s.date && (!min || s.date < min)) min = s.date; });
    return min;
}

function latestEmployeeSaleDate() {
    let max = '';
    employeeSales1C.forEach(s => { if (s.date && s.date > max) max = s.date; });
    return max;
}

function latestEmployeeSalesYM() {
    const months = availableEmployeeSalesYM();
    return months.length ? months[0] : getCurrentYM();
}

// Сопоставление имени продавца из 1С (короткое, напр. «Гавхар») с записью в
// справочнике employees (полное, напр. «Шерова Гавхар»). Сопоставляем по
// вхождению короткого имени как ОТДЕЛЬНОГО СЛОВА в полное (без учёта регистра).
// Возвращает запись employees или null.
function matchEmployeeBySellerName(sellerName) {
    const short = String(sellerName || '').trim().toLowerCase();
    if (!short) return null;
    return employeesDirectory.find(emp => {
        const full = String(emp.name || '').toLowerCase();
        if (!full) return false;
        // Короткое имя как отдельное слово в полном имени.
        const words = full.split(/\s+/);
        return words.includes(short) || full === short;
    }) || null;
}

// Процент для сотрудника: commission_rate из справочника, если сопоставлен и
// значение задано (включая 0% для не-продавцов), иначе 2% по умолчанию.
function rateForEmployee(matchedEmp) {
    if (!matchedEmp || matchedEmp.commission_rate == null || matchedEmp.commission_rate === '') {
        return SALES_SALARY_DEFAULT_RATE;
    }
    const r = parseFloat(matchedEmp.commission_rate);
    return isNaN(r) ? SALES_SALARY_DEFAULT_RATE : r;
}

// Агрегирует продажи по сотрудникам за диапазон [from..to] включительно.
// Возвращает [{ sellerRef, sellerName, gross, matchedEmp, rate, amount }] —
// только те, у кого выручка > 0, отсортировано по выручке по убыванию.
function aggregateEmployeeSales(from, to) {
    const byRef = {};
    employeeSales1C.forEach(s => {
        if (s.date < from || s.date > to) return;
        const key = s.sellerRef || s.sellerName;
        if (!byRef[key]) {
            byRef[key] = { sellerRef: s.sellerRef, sellerName: s.sellerName, gross: 0 };
        }
        byRef[key].gross += s.gross;
        // Имя берём непустое (на случай рассинхрона строк).
        if (!byRef[key].sellerName && s.sellerName) byRef[key].sellerName = s.sellerName;
    });

    return Object.values(byRef)
        .filter(e => e.gross > 0)
        .map(e => {
            const matchedEmp = matchEmployeeBySellerName(e.sellerName);
            const rate = rateForEmployee(matchedEmp);
            const amount = e.gross * rate / 100;
            return { ...e, matchedEmp, rate, amount };
        })
        .sort((a, b) => b.gross - a.gross);
}

// Ищет существующую выплату за тот же период (seller_ref + period_from + period_to).
function findExistingPayout(sellerRef, from, to) {
    return salaryPayoutsCache.find(p =>
        p.seller_ref === sellerRef && p.period_from === from && p.period_to === to
    ) || null;
}

// Заполняет месячный пресет реально доступными периодами employee_sales_1c.
function populateSalesSalaryPeriodSelect() {
    const sel = document.getElementById('salesSalaryPeriod');
    if (!sel) return;
    const months = availableEmployeeSalesYM();
    if (!months.length) {
        sel.innerHTML = '';
        sel.disabled = true;
        return;
    }
    sel.disabled = false;
    sel.innerHTML = months
        .map(ym => `<option value="${ym}">${escapeHtml(formatMonthRu(ym))}</option>`)
        .join('');
}

// Гарантирует, что salesSalaryRange задан и не выходит за пределы данных.
// По умолчанию — последний месяц с данными.
function ensureSalesSalaryRange() {
    const minDate = earliestEmployeeSaleDate();
    const maxDate = latestEmployeeSaleDate();
    if (!minDate) { salesSalaryRange = null; return; }

    if (!salesSalaryRange) {
        const { start, end } = monthBounds(latestEmployeeSalesYM());
        salesSalaryRange = {
            from: start < minDate ? minDate : start,
            to: end > maxDate ? maxDate : end
        };
        return;
    }
    let { from, to } = salesSalaryRange;
    if (from < minDate) from = minDate;
    if (to > maxDate) to = maxDate;
    if (from > to) from = to;
    salesSalaryRange = { from, to };
}

// Синхронизирует поля дат и месячный пресет с текущим диапазоном.
function syncSalesSalaryControls() {
    const fromEl = document.getElementById('salesSalaryFrom');
    const toEl = document.getElementById('salesSalaryTo');
    const sel = document.getElementById('salesSalaryPeriod');
    const minDate = earliestEmployeeSaleDate();
    const maxDate = latestEmployeeSaleDate();

    if (fromEl) {
        fromEl.min = minDate || '';
        fromEl.max = maxDate || '';
        fromEl.value = salesSalaryRange ? salesSalaryRange.from : '';
    }
    if (toEl) {
        toEl.min = minDate || '';
        toEl.max = maxDate || '';
        toEl.value = salesSalaryRange ? salesSalaryRange.to : '';
    }
    if (sel && salesSalaryRange) {
        const ym = salesSalaryRange.from.slice(0, 7);
        const { start, end } = monthBounds(ym);
        if (salesSalaryRange.from === start && salesSalaryRange.to === end) sel.value = ym;
    }
}

function onSalesSalaryMonthPreset() {
    const sel = document.getElementById('salesSalaryPeriod');
    if (!sel || !sel.value) return;
    const { start, end } = monthBounds(sel.value);
    const minDate = earliestEmployeeSaleDate();
    const maxDate = latestEmployeeSaleDate();
    salesSalaryRange = {
        from: minDate && start < minDate ? minDate : start,
        to: maxDate && end > maxDate ? maxDate : end
    };
    renderSalesSalary();
}

function onSalesSalaryDateRangeChange() {
    const fromEl = document.getElementById('salesSalaryFrom');
    const toEl = document.getElementById('salesSalaryTo');
    if (!fromEl || !toEl) return;
    let from = fromEl.value;
    let to = toEl.value;
    if (!from || !to) return;
    if (to < from) { const t = from; from = to; to = t; }
    salesSalaryRange = { from, to };
    renderSalesSalary();
}

// Точка входа: грузит данные (один раз) и рендерит подраздел.
async function loadSalesSalarySection() {
    if (salesSalaryLoading) return;
    if (!employeeSales1CLoaded) {
        salesSalaryLoading = true;
        renderSalesSalary(); // покажет «Загрузка…»
        await loadEmployeeSales1C();
        salesSalaryLoading = false;
    }
    renderSalesSalary();
}

// Рендер таблицы сотрудников, итогов и кнопок выплаты за выбранный период.
function renderSalesSalary() {
    const tbody = document.querySelector('#salesSalaryTable tbody');
    const tableEl = document.getElementById('salesSalaryTable');
    const emptyEl = document.getElementById('salesSalaryEmpty');
    const summaryEl = document.getElementById('salesSalarySummary');
    const labelEl = document.getElementById('salesSalaryDateLabel');
    if (!tbody) return;

    const setEmpty = (msg) => {
        if (tableEl) tableEl.style.display = 'none';
        if (summaryEl) summaryEl.innerHTML = '';
        if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.textContent = msg; }
    };

    if (!employeeSales1CLoaded) {
        setEmpty(salesSalaryLoading
            ? 'Загрузка данных о продажах сотрудников…'
            : 'Не удалось загрузить данные о продажах сотрудников.');
        return;
    }

    populateSalesSalaryPeriodSelect();
    ensureSalesSalaryRange();
    syncSalesSalaryControls();

    if (!salesSalaryRange) {
        if (labelEl) labelEl.textContent = '';
        setEmpty('Нет данных о продажах сотрудников.');
        return;
    }

    const { from, to } = salesSalaryRange;
    if (labelEl) labelEl.textContent = `за ${formatDateRu(from)} — ${formatDateRu(to)}`;

    const rows = aggregateEmployeeSales(from, to);
    if (!rows.length) {
        setEmpty('Нет продаж сотрудников за выбранный период.');
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    if (tableEl) tableEl.style.display = '';

    let totalGross = 0, totalSalary = 0, totalPaid = 0;

    tbody.innerHTML = rows.map(r => {
        totalGross += r.gross;
        totalSalary += r.amount;

        const existing = findExistingPayout(r.sellerRef, from, to);
        let statusCell, actionCell;
        if (existing) {
            totalPaid += parseFloat(existing.amount) || 0;
            const paidDate = existing.created_at ? formatDate(existing.created_at) : '';
            statusCell = `<span class="ss-status ss-status-paid">✅ Выплачено${paidDate ? ' (' + escapeHtml(paidDate) + ')' : ''}</span>`;
            actionCell = `<button class="btn btn-secondary btn-sm" disabled title="Уже выплачено за этот период">Выплачено</button>`;
        } else {
            statusCell = `<span class="ss-status ss-status-pending">К выплате</span>`;
            actionCell = `<button class="btn btn-primary btn-sm" onclick="payoutSalesSalary('${escapeHtml(r.sellerRef || '')}')">Выплатить</button>`;
        }

        const matchHint = r.matchedEmp
            ? ` <span class="ss-match" title="Сопоставлен: ${escapeHtml(r.matchedEmp.name)}">🔗</span>`
            : ` <span class="ss-nomatch" title="Не сопоставлен — применён процент по умолчанию">—</span>`;

        return `
            <tr>
                <td>${escapeHtml(r.sellerName || '—')}${matchHint}</td>
                <td>${formatCurrency(r.gross)}</td>
                <td>${r.rate}%</td>
                <td><b>${formatCurrency(r.amount)}</b></td>
                <td>${statusCell}</td>
                <td>${actionCell}</td>
            </tr>`;
    }).join('');

    const remaining = totalSalary - totalPaid;
    if (summaryEl) {
        summaryEl.innerHTML = `
            <div class="ss-summary-card"><div class="ss-summary-label">Суммарная выручка</div><div class="ss-summary-value">${formatCurrency(totalGross)}</div></div>
            <div class="ss-summary-card"><div class="ss-summary-label">Зарплата (2%) всего</div><div class="ss-summary-value">${formatCurrency(totalSalary)}</div></div>
            <div class="ss-summary-card"><div class="ss-summary-label">Уже выплачено</div><div class="ss-summary-value">${formatCurrency(totalPaid)}</div></div>
            <div class="ss-summary-card ss-summary-remaining"><div class="ss-summary-label">Осталось выплатить</div><div class="ss-summary-value">${formatCurrency(remaining)}</div></div>`;
    }
}

// Находит/создаёт категорию «Зарплата» в expense_categories, кэширует id.
// Возвращает id или null (если создание невозможно — выплата всё равно пройдёт,
// в name затраты будет указано «Зарплата»).
async function ensureSalaryExpenseCategory() {
    if (salaryExpenseCategoryId != null) return salaryExpenseCategoryId;
    try {
        const { data, error } = await supabaseClient
            .from('expense_categories').select('id,name').eq('name', 'Зарплата').limit(1);
        if (!error && data && data.length) {
            salaryExpenseCategoryId = data[0].id;
            return salaryExpenseCategoryId;
        }
        // Создаём категорию.
        const ins = await supabaseClient
            .from('expense_categories').insert([{ name: 'Зарплата' }]).select('id').limit(1);
        if (!ins.error && ins.data && ins.data.length) {
            salaryExpenseCategoryId = ins.data[0].id;
            return salaryExpenseCategoryId;
        }
    } catch (e) {
        console.warn('Не удалось получить/создать категорию «Зарплата»:', e);
    }
    return null;
}

// Выплата зарплаты конкретному сотруднику за текущий выбранный период.
async function payoutSalesSalary(sellerRef) {
    if (!salesSalaryRange) return;
    const { from, to } = salesSalaryRange;

    const rows = aggregateEmployeeSales(from, to);
    const row = rows.find(r => (r.sellerRef || '') === sellerRef);
    if (!row) { alert('Сотрудник не найден за выбранный период.'); return; }

    // Повторная защита от двойной выплаты (на случай гонки).
    if (findExistingPayout(sellerRef, from, to)) {
        alert('Этому сотруднику уже выплачена зарплата за выбранный период.');
        renderSalesSalary();
        return;
    }

    const periodLabel = (from === to) ? formatDateRu(from) : `${formatDateRu(from)} — ${formatDateRu(to)}`;
    const ok = confirm(
        `Выплатить зарплату?\n\n` +
        `Сотрудник: ${row.sellerName}\n` +
        `Выручка за период: ${formatCurrency(row.gross)}\n` +
        `Процент: ${row.rate}%\n` +
        `К выплате: ${formatCurrency(row.amount)}\n` +
        `Период: ${periodLabel}`
    );
    if (!ok) return;

    const paidBy = currentUser || 'dashboard';
    const employeeId = row.matchedEmp ? row.matchedEmp.id : null;
    const categoryId = await ensureSalaryExpenseCategory();

    // 1) Затрата в expenses (категория «Зарплата»), expense_date = последний день периода.
    const expenseId = generateId('exp');
    const expenseName = `Зарплата: ${row.sellerName} (${row.rate}% за ${periodLabel})`;
    const expenseRow = {
        id: expenseId,
        category_id: categoryId,
        name: expenseName,
        amount: row.amount,
        expense_date: to,
        added_by: paidBy
    };
    try {
        const expRes = await supabaseClient.from('expenses').insert([expenseRow]);
        if (expRes.error) throw expRes.error;
    } catch (e) {
        console.error('Ошибка записи в expenses:', e);
        alert('Не удалось записать затрату. Выплата отменена.\n' + (e.message || e));
        return;
    }

    // 2) Журнал выплаты в salary_payouts (со ссылкой на expense_id).
    const payoutId = generateId('payout');
    const payoutRow = {
        id: payoutId,
        seller_ref: sellerRef || null,
        employee_id: employeeId,
        employee_name: row.sellerName,
        period_from: from,
        period_to: to,
        gross_sales: row.gross,
        commission_rate: row.rate,
        amount: row.amount,
        expense_id: expenseId,
        paid_by: paidBy
    };
    try {
        const payRes = await supabaseClient.from('salary_payouts').insert([payoutRow]);
        if (payRes.error) throw payRes.error;
    } catch (e) {
        console.error('Ошибка записи в salary_payouts:', e);
        // Откатываем затрату, чтобы не было «осиротевшей» записи.
        try { await supabaseClient.from('expenses').delete().eq('id', expenseId); } catch (_) {}
        alert('Не удалось записать выплату в журнал. Затрата отменена.\n' + (e.message || e));
        return;
    }

    // 3) Отражаем затрату в чистой прибыли на главной (appData.fixedExpenses).
    //    Главная страница считает прибыль = выручка − appData.fixedExpenses.
    try {
        appData.fixedExpenses = appData.fixedExpenses || [];
        appData.fixedExpenses.push({
            id: 'fx_' + payoutId,
            salon: 'Общие',
            categoryKey: 'salary',
            categoryName: 'Зарплаты',
            name: expenseName,
            amount: row.amount,
            date: to,
            employeeId: employeeId,
            payoutId: payoutId,
            createdBy: paidBy,
            createdAt: new Date().toISOString()
        });
        addToAuditLog('Выплачено', 'Зарплата от продаж', `${row.sellerName} — ${row.rate}% за ${periodLabel} — ${formatCurrency(row.amount)}`);
        await saveData();
    } catch (e) {
        console.error('Не удалось сохранить затрату в appData:', e);
        // Запись в Supabase уже сделана — не критично для журнала, но сообщим.
    }

    // Обновляем локальный кэш журнала и перерисовываем.
    salaryPayoutsCache.push({
        id: payoutId, seller_ref: sellerRef || null, employee_name: row.sellerName,
        period_from: from, period_to: to, gross_sales: row.gross,
        commission_rate: row.rate, amount: row.amount, created_at: new Date().toISOString()
    });

    if (typeof showSuccess === 'function') showSuccess('Зарплата выплачена и учтена в затратах');
    renderSalesSalary();
    if (typeof renderDashboardFixedExpenses === 'function') renderDashboardFixedExpenses();
    if (typeof updateDashboard === 'function') updateDashboard();
}

window.onSalesSalaryMonthPreset = onSalesSalaryMonthPreset;
window.onSalesSalaryDateRangeChange = onSalesSalaryDateRangeChange;
window.payoutSalesSalary = payoutSalesSalary;
window.loadSalesSalarySection = loadSalesSalarySection;

// ═══════════════════════════════════════════════════════════════
// ТОВАРЫ — остатки, перемещения, оборачиваемость (база ОРТОБОТ)
// ═══════════════════════════════════════════════════════════════

const LOW_STOCK_THRESHOLD = 1;       // <=1 — заканчивается
const TRANSFER_SURPLUS_MIN = 3;      // >=3 — есть излишек, можно переместить (обычные склады)
const TRANSFER_SURPLUS_MIN_MAIN = 1; // Основной склад может отдавать даже при 1 шт
const STOCK_PAGE_SIZE = 50;          // товаров на странице в таблице остатков

let productsState = {
    loaded: false,
    loading: false,
    warehouses: [],          // [{id, c1_ref, c1_code, name}]
    whById: {},              // id -> warehouse
    products: [],            // [{id, c1_ref, name_ru, category, price, currency}]
    prodById: {},            // id -> product
    prodByC1: {},            // c1_ref -> product
    variants: [],            // [{product_id, warehouse_id, c1_char_ref, size_label, stock, ...}]
    velocity: [],            // product_sales_velocity rows
    stockPage: 0
};

async function fetchAllRows(table, columns) {
    // Постраничная выгрузка (Supabase лимит 1000 на запрос).
    const pageSize = 1000;
    let from = 0;
    const out = [];
    while (true) {
        const { data, error } = await ortobotClient
            .from(table)
            .select(columns)
            .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        out.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
    }
    return out;
}

async function loadProducts(forceReload) {
    const loadingEl = document.getElementById('productsLoading');
    const bodyEl = document.getElementById('productsBody');
    const errorEl = document.getElementById('productsError');
    if (!loadingEl || !bodyEl) return;

    if (productsState.loaded && !forceReload) {
        bodyEl.style.display = 'block';
        loadingEl.style.display = 'none';
        return;
    }
    if (productsState.loading) return;
    productsState.loading = true;

    errorEl.style.display = 'none';
    bodyEl.style.display = 'none';
    loadingEl.style.display = 'flex';

    try {
        const [warehouses, products, variants, velocity] = await Promise.all([
            fetchAllRows('warehouses', 'id,c1_ref,c1_code,name,is_active'),
            fetchAllRows('products', 'id,c1_ref,sku,name_ru,category,price,currency,is_active'),
            fetchAllRows('product_variants', 'id,product_id,warehouse_id,c1_char_ref,size_label,stock,price,currency'),
            fetchAllRows('product_sales_velocity', 'period_from,period_to,warehouse_c1_ref,product_c1_ref,char_c1_ref,qty_sold,amount')
        ]);

        productsState.warehouses = (warehouses || [])
            .filter(w => w.is_active !== false)
            .sort((a, b) => String(a.c1_code || '').localeCompare(String(b.c1_code || '')));
        productsState.whById = {};
        productsState.warehouses.forEach(w => { productsState.whById[w.id] = w; });

        productsState.products = products || [];
        productsState.prodById = {};
        productsState.prodByC1 = {};
        productsState.products.forEach(p => {
            productsState.prodById[p.id] = p;
            if (p.c1_ref) productsState.prodByC1[p.c1_ref] = p;
        });

        productsState.variants = (variants || []).map(v => ({
            ...v,
            stock: Number(v.stock) || 0
        }));
        productsState.velocity = velocity || [];

        productsState.loaded = true;
        productsState.stockPage = 0;

        initProductFilters();
        renderProductStock();
        renderProductTransfers();
        renderProductTurnover();
        renderProductStale();
        renderProductFast();

        loadingEl.style.display = 'none';
        bodyEl.style.display = 'block';
    } catch (e) {
        console.error('Ошибка загрузки товаров (ОРТОБОТ):', e);
        loadingEl.style.display = 'none';
        errorEl.textContent = 'Не удалось загрузить данные о товарах. ' + (e && e.message ? e.message : '');
        errorEl.style.display = 'block';
    } finally {
        productsState.loading = false;
    }
}

function whName(id) {
    const w = productsState.whById[id];
    return w ? (w.name || w.c1_code || '—') : '—';
}

function fmtNum(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function fmtPrice(p, currency) {
    if (p == null || p === '') return '—';
    return Number(p).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ' + (currency || 'TJS');
}

function stockClass(stock) {
    if (stock <= 0) return 'prod-stock-zero';
    if (stock <= LOW_STOCK_THRESHOLD) return 'prod-stock-low';
    return '';
}

// ── Фильтры ────────────────────────────────────────────────────
function initProductFilters() {
    const whSel = document.getElementById('prodFilterWarehouse');
    const catSel = document.getElementById('prodFilterCategory');
    if (whSel && !whSel.dataset.init) {
        whSel.innerHTML = '<option value="">Все магазины</option>' +
            productsState.warehouses.map(w => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name || w.c1_code)}</option>`).join('');
        whSel.dataset.init = '1';
        whSel.addEventListener('change', () => { productsState.stockPage = 0; renderProductStock(); });
    }
    if (catSel && !catSel.dataset.init) {
        const cats = Array.from(new Set(productsState.products.map(p => (p.category || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru'));
        catSel.innerHTML = '<option value="">Все категории</option>' +
            cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
        catSel.dataset.init = '1';
        catSel.addEventListener('change', () => { productsState.stockPage = 0; renderProductStock(); });
    }
    const search = document.getElementById('prodFilterSearch');
    if (search && !search.dataset.init) {
        let t = null;
        search.addEventListener('input', () => {
            clearTimeout(t);
            t = setTimeout(() => { productsState.stockPage = 0; renderProductStock(); }, 250);
        });
        search.dataset.init = '1';
    }

    // Фильтры подраздела «Перемещения»: «Откуда» (без Интернет магазина),
    // «Куда» (без Интернет магазина и Основного склада). Склады — из реальных warehouses по c1_code.
    const fromSel = document.getElementById('prodTransferFrom');
    if (fromSel && !fromSel.dataset.init) {
        const opts = productsState.warehouses.filter(w => w.c1_code !== WH_INTERNET_CODE);
        fromSel.innerHTML = '<option value="">Все</option>' +
            opts.map(w => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name || w.c1_code)}</option>`).join('');
        fromSel.dataset.init = '1';
        fromSel.addEventListener('change', renderProductTransfers);
    }
    const toSel = document.getElementById('prodTransferTo');
    if (toSel && !toSel.dataset.init) {
        const opts = productsState.warehouses.filter(w => w.c1_code !== WH_INTERNET_CODE && w.c1_code !== WH_MAIN_CODE);
        toSel.innerHTML = '<option value="">Все</option>' +
            opts.map(w => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name || w.c1_code)}</option>`).join('');
        toSel.dataset.init = '1';
        toSel.addEventListener('change', renderProductTransfers);
    }
}

// ── Остатки: строка = товар, разворот в матрицу размер × магазин ──
function getStockFilters() {
    return {
        warehouseId: (document.getElementById('prodFilterWarehouse') || {}).value || '',
        category: (document.getElementById('prodFilterCategory') || {}).value || '',
        search: ((document.getElementById('prodFilterSearch') || {}).value || '').trim().toLowerCase()
    };
}

function buildStockGroups(filters) {
    // Группируем варианты по товару; учитываем фильтр магазина для отображаемых ячеек.
    const byProduct = new Map(); // product_id -> { product, variants: [] }
    for (const v of productsState.variants) {
        if (filters.warehouseId && v.warehouse_id !== filters.warehouseId) continue;
        const p = productsState.prodById[v.product_id];
        if (!p) continue;
        if (filters.category && (p.category || '').trim() !== filters.category) continue;
        if (filters.search && !(p.name_ru || '').toLowerCase().includes(filters.search)) continue;
        if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, { product: p, variants: [] });
        byProduct.get(v.product_id).variants.push(v);
    }
    const groups = Array.from(byProduct.values());
    groups.sort((a, b) => (a.product.name_ru || '').localeCompare(b.product.name_ru || '', 'ru'));
    return groups;
}

function renderProductStock() {
    const listEl = document.getElementById('prodStockList');
    const summaryEl = document.getElementById('prodStockSummary');
    const pagerEl = document.getElementById('prodStockPager');
    if (!listEl) return;

    const filters = getStockFilters();
    const groups = buildStockGroups(filters);

    // Сводка
    let totalStock = 0, zeroCnt = 0, lowCnt = 0, variantCnt = 0;
    groups.forEach(g => g.variants.forEach(v => {
        totalStock += v.stock; variantCnt++;
        if (v.stock <= 0) zeroCnt++; else if (v.stock <= LOW_STOCK_THRESHOLD) lowCnt++;
    }));
    if (summaryEl) {
        summaryEl.innerHTML =
            `<span>Товаров: <b>${fmtNum(groups.length)}</b></span>` +
            `<span>Вариантов: <b>${fmtNum(variantCnt)}</b></span>` +
            `<span>Общий остаток: <b>${fmtNum(totalStock)}</b> шт</span>` +
            `<span class="prod-stock-zero">Закончилось: <b>${fmtNum(zeroCnt)}</b></span>` +
            `<span class="prod-stock-low">Заканчивается: <b>${fmtNum(lowCnt)}</b></span>`;
    }

    // Пагинация
    const totalPages = Math.max(1, Math.ceil(groups.length / STOCK_PAGE_SIZE));
    if (productsState.stockPage >= totalPages) productsState.stockPage = 0;
    const start = productsState.stockPage * STOCK_PAGE_SIZE;
    const pageGroups = groups.slice(start, start + STOCK_PAGE_SIZE);

    if (pageGroups.length === 0) {
        listEl.innerHTML = '<p style="padding:16px;color:var(--color-text-secondary);">Ничего не найдено по заданным фильтрам.</p>';
        if (pagerEl) pagerEl.innerHTML = '';
        return;
    }

    listEl.innerHTML = pageGroups.map(g => renderStockGroupRow(g, filters)).join('');

    // Развороты
    listEl.querySelectorAll('.prod-row-head').forEach(head => {
        head.addEventListener('click', () => {
            const card = head.closest('.prod-row');
            card.classList.toggle('open');
        });
    });

    if (pagerEl) {
        pagerEl.innerHTML = totalPages > 1
            ? `<button class="btn btn-secondary" ${productsState.stockPage === 0 ? 'disabled' : ''} onclick="prodStockPrev()">← Назад</button>` +
              `<span>Стр. ${productsState.stockPage + 1} из ${totalPages}</span>` +
              `<button class="btn btn-secondary" ${productsState.stockPage >= totalPages - 1 ? 'disabled' : ''} onclick="prodStockNext()">Вперёд →</button>`
            : '';
    }
}

function prodStockPrev() { if (productsState.stockPage > 0) { productsState.stockPage--; renderProductStock(); } }
function prodStockNext() { productsState.stockPage++; renderProductStock(); }

function renderStockGroupRow(g, filters) {
    const p = g.product;
    const totalStock = g.variants.reduce((s, v) => s + v.stock, 0);

    // Размеры (столбцы) и магазины (строки) для матрицы
    const sizes = Array.from(new Set(g.variants.map(v => v.size_label || '—')))
        .sort((a, b) => String(a).localeCompare(String(b), 'ru', { numeric: true }));
    // Магазины: либо отфильтрованный один, либо все, где есть варианты этого товара
    let whIds;
    if (filters.warehouseId) {
        whIds = [filters.warehouseId];
    } else {
        whIds = Array.from(new Set(g.variants.map(v => v.warehouse_id)));
        whIds.sort((a, b) => String((productsState.whById[a] || {}).c1_code || '').localeCompare(String((productsState.whById[b] || {}).c1_code || '')));
    }

    // map (whId|size) -> stock
    const cell = {};
    g.variants.forEach(v => { cell[v.warehouse_id + '|' + (v.size_label || '—')] = v.stock; });

    const headRow = '<tr><th>Магазин \\ размер</th>' + sizes.map(s => `<th>${escapeHtml(s)}</th>`).join('') + '</tr>';
    const bodyRows = whIds.map(wid => {
        const tds = sizes.map(s => {
            const has = Object.prototype.hasOwnProperty.call(cell, wid + '|' + s);
            if (!has) return '<td class="prod-cell-empty">·</td>';
            const st = cell[wid + '|' + s];
            return `<td class="prod-cell ${stockClass(st)}">${fmtNum(st)}</td>`;
        }).join('');
        return `<tr><td class="prod-cell-wh">${escapeHtml(whName(wid))}</td>${tds}</tr>`;
    }).join('');

    return `
        <div class="prod-row">
            <div class="prod-row-head">
                <span class="prod-row-toggle">▶</span>
                <span class="prod-row-name">${escapeHtml(p.name_ru || '(без названия)')}</span>
                <span class="prod-row-cat">${escapeHtml(p.category || '')}</span>
                <span class="prod-row-price">${fmtPrice(p.price, p.currency)}</span>
                <span class="prod-row-total">остаток: <b>${fmtNum(totalStock)}</b></span>
            </div>
            <div class="prod-row-detail">
                <div class="table-container">
                    <table class="prod-matrix">
                        <thead>${headRow}</thead>
                        <tbody>${bodyRows}</tbody>
                    </table>
                </div>
            </div>
        </div>`;
}

// ── Рекомендации перемещений ─────────────────────────────────────
// Коды складов с особой ролью в «Перемещениях»
const WH_INTERNET_CODE = 'OM-000001';   // Интернет магазин — полностью исключён из перемещений
const WH_MAIN_CODE = 'OM-000005';       // Основной склад — приоритетный донор, но не получатель

function whCode(id) {
    const w = productsState.whById[id];
    return w ? (w.c1_code || '') : '';
}
function isInternetWarehouse(id) { return whCode(id) === WH_INTERNET_CODE; }
function isMainWarehouse(id) { return whCode(id) === WH_MAIN_CODE; }
// Порог излишка донора: Основной склад отдаёт при >=1, остальные — при >=3
function transferSurplusMin(id) { return isMainWarehouse(id) ? TRANSFER_SURPLUS_MIN_MAIN : TRANSFER_SURPLUS_MIN; }

function renderProductTransfers() {
    const tbody = document.querySelector('#prodTransfersTable tbody');
    if (!tbody) return;

    const fromFilter = (document.getElementById('prodTransferFrom') || {}).value || '';
    const toFilter = (document.getElementById('prodTransferTo') || {}).value || '';

    // Группируем по (product_id | size_label) → варианты по складам.
    // Интернет магазин (OM-000001) исключаем полностью: ни как донора, ни как получателя.
    const byKey = new Map();
    for (const v of productsState.variants) {
        if (isInternetWarehouse(v.warehouse_id)) continue;
        const key = v.product_id + '||' + (v.size_label || '—');
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(v);
    }

    // Список активных магазинов-получателей: все склады, кроме Основного и Интернет магазина.
    // Основной склад — только донор; Интернет магазин полностью исключён.
    const receiverWarehouses = productsState.warehouses.filter(
        w => !isMainWarehouse(w.id) && !isInternetWarehouse(w.id)
    );

    const recs = [];
    for (const [, vars] of byKey) {
        // Доноры: склады с излишком (Основной отдаёт при >=1, остальные при >=3)
        const surplus = vars.filter(v => v.stock >= transferSurplusMin(v.warehouse_id))
            .sort((a, b) => b.stock - a.stock);
        if (surplus.length === 0) continue;

        const product_id = vars[0].product_id;
        const size_label = vars[0].size_label;
        // Остаток по каждому складу для этой (товар|размер): реальная строка или 0, если строки нет
        const stockByWh = {};
        for (const v of vars) stockByWh[v.warehouse_id] = v.stock;

        // Излишек на Основном складе (приоритетный донор)
        const mainSurplus = surplus.find(s => isMainWarehouse(s.warehouse_id));

        // Получатели: ВСЕ активные магазины, где товара нет совсем (нет строки) или мало (<= порога).
        for (const shop of receiverWarehouses) {
            const shopStock = stockByWh[shop.id] != null ? stockByWh[shop.id] : 0; // нет строки = 0
            if (shopStock > LOW_STOCK_THRESHOLD) continue; // товара достаточно — пропускаем

            // Донор: приоритет Основному складу; иначе магазин с максимальным остатком (не сам получатель)
            let src = (mainSurplus && mainSurplus.warehouse_id !== shop.id)
                ? mainSurplus
                : surplus.find(s => s.warehouse_id !== shop.id && !isMainWarehouse(s.warehouse_id));
            if (!src) continue;
            // Фильтры «Откуда»/«Куда» по конкретному складу (по умолчанию — все)
            if (fromFilter && src.warehouse_id !== fromFilter) continue;
            if (toFilter && shop.id !== toFilter) continue;
            const p = productsState.prodById[product_id];
            // переместить столько, чтобы донор сохранил минимум 2, а у получателя стало хотя бы 2
            const moveQty = Math.max(1, Math.min(src.stock - 2, 2 - shopStock + 1));
            recs.push({
                name: p ? p.name_ru : '(?)',
                size: size_label || '—',
                from: whName(src.warehouse_id),
                fromStock: src.stock,
                to: whName(shop.id),
                toStock: shopStock,
                qty: moveQty > 0 ? moveQty : 1
            });
        }
    }
    recs.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    if (recs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--color-text-secondary);">Рекомендаций по перемещению нет.</td></tr>';
        return;
    }
    tbody.innerHTML = recs.map(r => `
        <tr>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.size)}</td>
            <td>${escapeHtml(r.from)}</td>
            <td>${fmtNum(r.fromStock)}</td>
            <td>${escapeHtml(r.to)}</td>
            <td class="${stockClass(r.toStock)}">${fmtNum(r.toStock)}</td>
            <td><b>${fmtNum(r.qty)}</b> шт</td>
        </tr>`).join('');
}

// ── Оборачиваемость: связка velocity ↔ variant ───────────────────
function buildVelocityRows() {
    // Индекс вариантов по (product_id|warehouse_id|c1_char_ref) для стыковки остатка
    const variantIdx = new Map();
    for (const v of productsState.variants) {
        variantIdx.set(v.product_id + '|' + v.warehouse_id + '|' + (v.c1_char_ref || ''), v);
    }
    const whByC1 = {};
    productsState.warehouses.forEach(w => { if (w.c1_ref) whByC1[w.c1_ref] = w; });

    const rows = [];
    for (const r of productsState.velocity) {
        const p = productsState.prodByC1[r.product_c1_ref];
        const wh = whByC1[r.warehouse_c1_ref];
        if (!p || !wh) continue;
        const variant = variantIdx.get(p.id + '|' + wh.id + '|' + (r.char_c1_ref || ''));
        const days = Math.max(1, daysBetween(r.period_from, r.period_to));
        const qty = Number(r.qty_sold) || 0;
        const velocity = qty / days;             // шт/день
        const stock = variant ? variant.stock : 0;
        const daysToZero = velocity > 0 ? stock / velocity : null;
        rows.push({
            name: p.name_ru || '(?)',
            size: variant ? (variant.size_label || '—') : '—',
            warehouse: wh.name || wh.c1_code,
            qtySold: qty,
            velocity,
            stock,
            daysToZero
        });
    }
    return rows;
}

function daysBetween(from, to) {
    const a = new Date(from), b = new Date(to);
    if (isNaN(a) || isNaN(b)) return 30;
    return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

function renderProductTurnover() {
    const tbody = document.querySelector('#prodTurnoverTable tbody');
    if (!tbody) return;
    const rows = buildVelocityRows()
        .filter(r => r.qtySold > 0)
        .sort((a, b) => b.velocity - a.velocity)
        .slice(0, 500);

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--color-text-secondary);">Нет данных об оборачиваемости.</td></tr>';
        return;
    }
    tbody.innerHTML = rows.map(r => `
        <tr>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.size)}</td>
            <td>${escapeHtml(r.warehouse)}</td>
            <td>${fmtNum(r.qtySold)}</td>
            <td>${r.velocity.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</td>
            <td class="${stockClass(r.stock)}">${fmtNum(r.stock)}</td>
            <td>${r.daysToZero == null ? '<span style="color:var(--color-text-secondary);">не продаётся</span>' : Math.round(r.daysToZero) + ' дн.'}</td>
        </tr>`).join('');
}

// ── Залежавшийся товар (есть остаток, продаж нет) ────────────────
function renderProductStale() {
    const tbody = document.querySelector('#prodStaleTable tbody');
    if (!tbody) return;

    // Карта проданного количества по (product_c1_ref|warehouse_c1_ref|char_c1_ref)
    const soldMap = new Map();
    for (const r of productsState.velocity) {
        const key = r.product_c1_ref + '|' + r.warehouse_c1_ref + '|' + (r.char_c1_ref || '');
        soldMap.set(key, (soldMap.get(key) || 0) + (Number(r.qty_sold) || 0));
    }
    const whByC1Id = {};
    productsState.warehouses.forEach(w => { whByC1Id[w.id] = w.c1_ref; });

    const rows = [];
    for (const v of productsState.variants) {
        if (v.stock <= 0) continue;
        const p = productsState.prodById[v.product_id];
        if (!p || !p.c1_ref) continue;
        const whC1 = whByC1Id[v.warehouse_id];
        const sold = soldMap.get(p.c1_ref + '|' + whC1 + '|' + (v.c1_char_ref || '')) || 0;
        if (sold <= 0) {
            rows.push({ name: p.name_ru || '(?)', size: v.size_label || '—', warehouse: whName(v.warehouse_id), stock: v.stock, sold });
        }
    }
    rows.sort((a, b) => b.stock - a.stock);
    const limited = rows.slice(0, 500);

    if (limited.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--color-text-secondary);">Залежавшихся позиций не найдено.</td></tr>';
        return;
    }
    tbody.innerHTML = limited.map(r => `
        <tr>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.size)}</td>
            <td>${escapeHtml(r.warehouse)}</td>
            <td>${fmtNum(r.stock)}</td>
            <td>${fmtNum(r.sold)}</td>
            <td><span class="prod-badge prod-badge-discount">сделать скидку</span></td>
        </tr>`).join('');
}

// ── Быстро продающийся / дозакуп ─────────────────────────────────
function renderProductFast() {
    const tbody = document.querySelector('#prodFastTable tbody');
    if (!tbody) return;
    const FAST_DAYS_TO_ZERO = 14;   // мало дней до нуля
    const FAST_VELOCITY_MIN = 0.2;  // продаётся ощутимо

    const rows = buildVelocityRows()
        .filter(r => r.velocity >= FAST_VELOCITY_MIN && r.daysToZero != null && r.daysToZero <= FAST_DAYS_TO_ZERO && r.stock > 0)
        .sort((a, b) => a.daysToZero - b.daysToZero)
        .slice(0, 500);

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--color-text-secondary);">Позиций для дозакупа не найдено.</td></tr>';
        return;
    }
    tbody.innerHTML = rows.map(r => `
        <tr>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.size)}</td>
            <td>${escapeHtml(r.warehouse)}</td>
            <td>${r.velocity.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</td>
            <td class="${stockClass(r.stock)}">${fmtNum(r.stock)}</td>
            <td>${Math.round(r.daysToZero)} дн.</td>
            <td><span class="prod-badge prod-badge-restock">дозакупить</span></td>
        </tr>`).join('');
}

// ── Переключение подразделов «Товары» ────────────────────────────
function switchProductTab(name) {
    document.querySelectorAll('#productsSubTabs .section-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.prodtab === name);
    });
    document.querySelectorAll('#productsBody .prod-tab-content').forEach(c => c.classList.remove('active'));
    const map = { stock: 'prodStockTab', transfers: 'prodTransfersTab', turnover: 'prodTurnoverTab', stale: 'prodStaleTab', fast: 'prodFastTab' };
    const el = document.getElementById(map[name]);
    if (el) el.classList.add('active');
}

// ═══════════════════════════════════════════════════════════════
// 🏷️ ШТРИХКОДЫ — печать этикеток пар обуви на термопринтер АТОЛ
// ═══════════════════════════════════════════════════════════════
// Данные (warehouses/products/product_variants) берём из базы ОРТОБОТ
// через ortobotClient. Таблица stock_units и RPC generate_stock_units
// применяются отдельной миграцией — вызовы к ним обёрнуты в try/catch,
// чтобы раздел работал даже до применения миграции.

const barcodesState = {
    inited: false,
    warehouses: [],          // [{id, name, c1_code}]
    whById: {},              // id -> warehouse
    products: [],            // [{id, name_ru, category}]
    variants: [],            // [{id, product_id, warehouse_id, size_label, stock}]
    variantInfo: {},         // variant_id -> { name, size }
    selectedProductId: null, // выбранный товар в поиске
    printCart: [],           // список номенклатур к печати: [{productId,name,c1Ref,variants:[{variantId,charRef,size,stock}]}]
    scanned: new Set(),      // отсканированные коды (ревизия)
    prodCategoryByC1Ref: {}, // c1_ref товара -> категория
    unitHistoryCache: {},    // unique_barcode -> { movements:[], sales:[] } (ленивая история)
    unitRowData: {},         // unique_barcode -> поля stock_units для истории (приход/продажа)
    oldPriceByChar: {}       // c1_char_ref -> price_old (старая/зачёркнутая цена из Supabase, задаётся вручную)
};

// Понятное имя склада по id
function bcWhName(id) {
    const w = barcodesState.whById[id];
    return w ? (w.name || w.c1_code || '—') : (id != null ? String(id) : '—');
}

// Инициализация раздела: подгрузка справочников, восстановление настроек,
// навешивание обработчиков. Вызывается при каждом входе, но тяжёлая часть — один раз.
async function loadBarcodes() {
    // Восстановить размер этикетки из localStorage (не зависит от базы)
    bcRestoreLabelSize();

    if (barcodesState.inited) return;

    // Дропдаун размера этикетки — переключение custom + сохранение
    const presetEl = document.getElementById('bcLabelPreset');
    if (presetEl && !presetEl.dataset.bcBound) {
        presetEl.addEventListener('change', function () { bcToggleCustomSize(); bcSaveLabelSize(); });
        presetEl.dataset.bcBound = '1';
    }
    // Поля Свой размер — сохраняем в localStorage при изменении
    ['bcLabelW', 'bcLabelH'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.dataset.bcBound) {
            el.addEventListener('change', bcSaveLabelSize);
            el.dataset.bcBound = '1';
        }
    });

    // Поиск товара по названию (клиентская фильтрация загруженного списка)
    const searchEl = document.getElementById('bcProductSearch');
    if (searchEl && !searchEl.dataset.bcBound) {
        let t = null;
        searchEl.addEventListener('input', function () {
            clearTimeout(t);
            const q = this.value;
            t = setTimeout(() => bcSearchProducts(q), 250);
        });
        searchEl.dataset.bcBound = '1';
    }

    // Режим количества: «по остатку» (авто) или «вручную» (показать поле)
    const qtyModeEl = document.getElementById('bcQtyMode');
    if (qtyModeEl && !qtyModeEl.dataset.bcBound) {
        qtyModeEl.addEventListener('change', function () {
            const q = document.getElementById('bcQty');
            if (q) q.style.display = this.value === 'manual' ? '' : 'none';
        });
        qtyModeEl.dataset.bcBound = '1';
    }

    // Перевыбор склада -> перестроить список размеров текущего товара
    const whSel = document.getElementById('bcWarehouse');
    if (whSel && !whSel.dataset.bcBoundVar) {
        whSel.addEventListener('change', function () {
            if (barcodesState.selectedProductId) bcSelectProduct(barcodesState.selectedProductId);
        });
        whSel.dataset.bcBoundVar = '1';
    }

    // Скрыть выпадающий список результатов при клике вне поля
    document.addEventListener('click', function (e) {
        const box = document.getElementById('bcSearchResults');
        const inp = document.getElementById('bcProductSearch');
        if (box && inp && !box.contains(e.target) && e.target !== inp) {
            box.style.display = 'none';
        }
    });

    setupRevision();

    // Загрузка справочников из ОРТОБОТ. Эти таблицы существуют — но если
    // что-то пойдёт не так, раздел всё равно останется рабочим для тестовой печати.
    try {
        const [warehouses, products, variants] = await Promise.all([
            fetchAllRows('warehouses', 'id,c1_code,c1_ref,name,is_active'),
            fetchAllRows('products', 'id,name_ru,category,is_active,c1_ref'),
            fetchAllRows('product_variants', 'id,product_id,warehouse_id,size_label,stock,c1_char_ref,price,price_old')
        ]);

        barcodesState.warehouses = (warehouses || [])
            .filter(w => w.is_active !== false)
            .sort((a, b) => String(a.c1_code || '').localeCompare(String(b.c1_code || '')));
        barcodesState.whById = {};
        barcodesState.warehouses.forEach(w => { barcodesState.whById[w.id] = w; });

        barcodesState.products = (products || []).filter(p => p.is_active !== false);
        barcodesState.variants = (variants || []).map(v => ({ ...v, stock: Number(v.stock) || 0 }));

        // Карта variant_id -> название товара + размер + характеристика (для этикеток и цен)
        const prodName = {};
        const prodC1 = {};
        barcodesState.products.forEach(p => { prodName[p.id] = p.name_ru || ''; prodC1[p.id] = p.c1_ref || null; });
        barcodesState.prodC1ById = prodC1;
        // Карта c1_ref товара -> категория (для фильтра экземпляров по категории)
        barcodesState.prodCategoryByC1Ref = {};
        barcodesState.products.forEach(p => {
            if (p.c1_ref) barcodesState.prodCategoryByC1Ref[p.c1_ref] = (p.category || '').trim();
        });
        barcodesState.variantInfo = {};
        barcodesState.variants.forEach(v => {
            barcodesState.variantInfo[v.id] = {
                name: prodName[v.product_id] || '',
                size: v.size_label || '',
                charRef: v.c1_char_ref || null,
                productId: v.product_id,
                productC1Ref: prodC1[v.product_id] || null,
                warehouseId: v.warehouse_id || null
            };
        });
        barcodesState.priceCache = {}; // productC1Ref -> { productPrice, prices }

        bcFillWarehouseSelects();
    } catch (e) {
        console.error('Штрихкоды: не удалось загрузить справочники ОРТОБОТ:', e);
        const err = document.getElementById('bcPrintError');
        if (err) {
            err.textContent = 'Не удалось загрузить справочники товаров/складов. ' +
                (e && e.message ? e.message : '') + ' Тестовая печать всё равно доступна.';
            err.style.display = 'block';
        }
    }

    barcodesState.inited = true;
}

// Заполнить все селекты складов
function bcFillWarehouseSelects() {
    const opts = barcodesState.warehouses
        .map(w => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name || w.c1_code)}</option>`)
        .join('');
    const wh = document.getElementById('bcWarehouse');
    if (wh) wh.innerHTML = '<option value="">— выберите склад —</option>' + opts;
    const uw = document.getElementById('bcUnitsWarehouse');
    if (uw) uw.innerHTML = '<option value="">Все склады</option>' + opts;
    const rw = document.getElementById('bcRevWarehouse');
    if (rw) rw.innerHTML = '<option value="">— выберите склад —</option>' + opts;
    const bw = document.getElementById('bcBatchWarehouse');
    if (bw) {
        const prev = bw.value;
        bw.innerHTML = '<option value="">— выберите склад —</option>' + opts;
        if (prev) bw.value = prev;
    }
}

// Переключение под-вкладок раздела «Штрихкоды»
function switchBarcodesSubtab(name) {
    document.querySelectorAll('#barcodesSubTabs .section-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.btab === name);
    });
    const map = { receipt: 'bcReceiptTab', print: 'bcPrintTab', receipts: 'bcReceiptsTab', transfers: 'bcTransfersTab', units: 'bcUnitsTab', revision: 'bcRevisionTab' };
    document.querySelectorAll('#barcodesSection .prod-tab-content').forEach(c => c.classList.remove('active'));
    const el = document.getElementById(map[name]);
    if (el) el.classList.add('active');

    if (name === 'receipt') initReceiptTab();
    if (name === 'units') loadUnitsTable();
    if (name === 'receipts') loadReceipts();
    if (name === 'transfers') loadTransfers();
    if (name === 'revision') {
        const inp = document.getElementById('bcScanInput');
        if (inp) inp.focus();
    }
}

// ── Обновить остатки из 1С ──────────────────────────────
// Читает актуальные остатки из 1С и обновляет product_variants.stock в Supabase.
// Вызывается кнопкой на вкладке «Печать». После обновления перезагружает
// список размеров выбранного товара, чтобы «по остатку» был актуальным.
async function refreshStockFrom1C() {
    const btns = document.querySelectorAll('button[onclick="refreshStockFrom1C()"]');
    btns.forEach(b => { b.disabled = true; b.dataset._t = b.textContent; b.textContent = '⏳ Обновляю…'; });
    const info = document.getElementById('bcPrintInfo');
    try {
        // Если выбран конкретный товар — обновляем только его (быстрее), иначе — всё.
        let body = { all: true };
        const curProd = barcodesState.products.find(p => String(p.id) === String(barcodesState.selectedProductId));
        if (curProd && curProd.c1_ref) {
            body = { productC1Ref: curProd.c1_ref };
        }
        const res = await fetch(`${BARCODE_SVC_URL}/api/inventory?action=balance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Provision-Secret': BARCODE_SVC_SECRET },
            body: JSON.stringify(body),
            cache: 'no-store'
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (info) {
            info.innerHTML = `✅ Остатки обновлены из 1С: сопоставлено ${data.matched}, изменено ${data.updated}`
                + (data.unmatched ? `, без совпадения ${data.unmatched}` : '') + '.';
        }
        // Обновляем stock в локальном состоянии из Supabase и перерисовываем размеры.
        try {
            const fresh = await fetchAllRows('product_variants', 'id,product_id,warehouse_id,size_label,stock,c1_char_ref');
            if (fresh && fresh.length) {
                barcodesState.variants = fresh.map(v => ({ ...v, stock: Number(v.stock) || 0 }));
            }
        } catch (_) { /* не критично */ }
        if (barcodesState.selectedProductId && typeof bcSelectProduct === 'function') {
            bcSelectProduct(barcodesState.selectedProductId);
        }
    } catch (e) {
        if (info) info.innerHTML = `<span style="color:var(--color-error,#c0392b);">❌ Не удалось обновить остатки: ${escapeHtml(e.message)}</span>`;
    } finally {
        btns.forEach(b => { b.disabled = false; if (b.dataset._t) b.textContent = b.dataset._t; });
    }
}

// ── Недавние поступления ──────────────────────────
async function loadReceipts(skipBalance) {
    const listEl = document.getElementById('bcReceiptsList');
    const errEl = document.getElementById('bcReceiptsError');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    const limitSel = document.getElementById('bcReceiptsLimit');
    const limit = limitSel ? limitSel.value : 5;
    try {
        // 0) Автообновление остатков из 1С перед показом списка (не блокирует при ошибке).
        //    action=balance подтягивает product_variants.stock и СОЗДАЁТ недостающие
        //    варианты. Без этого новый приход мог показываться с остатком 0 и кнопка
        //    «Сгенерировать штрихкоды» не появлялась.
        if (!skipBalance) {
            if (listEl) listEl.innerHTML = '<div style="color:var(--color-text-secondary);font-size:13px;">⏳ Обновляю остатки из 1С…</div>';
            try {
                await fetch(`${BARCODE_SVC_URL}/api/inventory?action=balance`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Provision-Secret': BARCODE_SVC_SECRET },
                    body: JSON.stringify({ all: true }),
                    cache: 'no-store'
                });
            } catch (_) { /* не критично — покажем список как есть */ }
        }
        if (listEl) listEl.innerHTML = '<div style="color:var(--color-text-secondary);font-size:13px;">⏳ Загружаю поступления…</div>';
        const res = await fetch(`${BARCODE_SVC_URL}/api/inventory?action=receipts&limit=${encodeURIComponent(limit)}`, {
            method: 'GET',
            headers: { 'X-Provision-Secret': BARCODE_SVC_SECRET },
            cache: 'no-store'
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        renderReceipts(data.receipts || []);
    } catch (e) {
        if (listEl) listEl.innerHTML = '';
        if (errEl) { errEl.style.display = 'block'; errEl.textContent = '❌ Не удалось загрузить поступления: ' + e.message; }
    }
}

function renderReceipts(receipts) {
    const listEl = document.getElementById('bcReceiptsList');
    if (!listEl) return;
    if (!receipts.length) {
        listEl.innerHTML = '<div style="color:var(--color-text-secondary);font-size:13px;">Нет документов поступления.</div>';
        return;
    }
    let html = '';
    for (const r of receipts) {
        const dt = r.date ? new Date(r.date).toLocaleDateString('ru-RU') : '';
        const warn = r.needAny
            ? '<span style="background:#fdecea;color:#c0392b;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">⚠️ нужны штрихкоды</span>'
            : '<span style="background:#eafaf1;color:#1e8449;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">✅ штрихкоды есть</span>';
        let rows = '';
        for (const l of (r.lines || [])) {
            const need = l.needsBarcodes;
            const rowStyle = need ? 'background:#fdf3f2;' : '';
            const needN = (l.need != null) ? l.need : Math.max(0, (l.balance != null ? l.balance : (l.qty||0)) - (l.uniqueUnits||0));
            const badge = need
                ? `<span style="color:#c0392b;font-weight:600;">⊕ нужно +${needN}</span>`
                : '<span style="color:#1e8449;">ок</span>';
            rows += `<tr style="${rowStyle}">`
                + `<td style="padding:6px 10px;">${escapeHtml(l.productName || l.productC1Ref || '')}</td>`
                + `<td style="padding:6px 10px;">${escapeHtml(l.sizeLabel || '')}</td>`
                + `<td style="padding:6px 10px;text-align:center;">${l.qty || 0}</td>`
                + `<td style="padding:6px 10px;text-align:center;">${l.balance != null ? l.balance : '—'}</td>`
                + `<td style="padding:6px 10px;text-align:center;">${l.uniqueUnits || 0}</td>`
                + `<td style="padding:6px 10px;text-align:center;">${badge}</td>`
                + `</tr>`;
        }
        // номенклатуры документа, у которых есть нехватка кодов (для генерации)
        const needRefs = [...new Set((r.lines || [])
            .filter(l => l.needsBarcodes && l.productC1Ref)
            .map(l => l.productC1Ref))];
        // ПОЗИЦИИ документа для печати: печатаем ровно qty по каждой характеристике (размеру),
        // а НЕ весь остаток по номенклатуре.
        const printLines = (r.lines || [])
            .filter(l => l.charC1Ref && (l.qty || 0) > 0)
            .map(l => ({ productC1Ref: l.productC1Ref, charC1Ref: l.charC1Ref, qty: Number(l.qty) || 0 }));
        const needJson = encodeURIComponent(JSON.stringify(needRefs));
        const allJson = encodeURIComponent(JSON.stringify(printLines));
        const genBtn = (r.needAny && needRefs.length)
            ? `<button class="btn btn--primary" style="padding:6px 14px;font-size:13px;" `
              + `onclick='bcGenReceiptCodes(this, "${needJson}")'>`
              + `➕ Сгенерировать штрихкоды</button>`
            : '';
        const printTotal = printLines.reduce((s, l) => s + l.qty, 0);
        const printBtn = printLines.length
            ? `<button class="btn btn--outline" style="padding:6px 14px;font-size:13px;" `
              + `onclick='bcPrintReceiptLabels(this, "${allJson}")'>`
              + `🖨 Распечатать ценники (${printTotal})</button>`
            : '';
        html += `<div class="card" style="margin-bottom:14px;">`
            + `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;">`
            + `<div><b>№ ${escapeHtml(r.number || '')}</b> · <span style="color:var(--color-text-secondary);">${dt}</span>`
            + (r.posted === false ? ' · <span style="color:#c0392b;">не проведён</span>' : '')
            + ` · <span style="color:var(--color-text-secondary);font-size:12px;">позиций: ${r.totalLines || 0}</span></div>`
            + `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">` + warn + genBtn + printBtn + `</div></div>`
            + `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">`
            + `<thead><tr style="text-align:left;color:var(--color-text-secondary);font-size:12px;">`
            + `<th style="padding:6px 10px;">Товар</th><th style="padding:6px 10px;">Размер</th>`
            + `<th style="padding:6px 10px;text-align:center;">Пришло</th>`
            + `<th style="padding:6px 10px;text-align:center;">Остаток 1С</th>`
            + `<th style="padding:6px 10px;text-align:center;">Штрихкодов</th>`
            + `<th style="padding:6px 10px;text-align:center;">Статус</th></tr></thead>`
            + `<tbody>${rows}</tbody></table></div></div>`;
    }
    listEl.innerHTML = html;
}

// ── Недавние перемещения ─────────────────────────
async function loadTransfers() {
    const listEl = document.getElementById('bcTransfersList');
    const errEl = document.getElementById('bcTransfersError');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    if (listEl) listEl.innerHTML = '<div style="color:var(--color-text-secondary);font-size:13px;">⏳ Загружаю перемещения…</div>';
    const limitSel = document.getElementById('bcTransfersLimit');
    const limit = limitSel ? limitSel.value : 5;
    try {
        const res = await fetch(`${BARCODE_SVC_URL}/api/inventory?action=transfers&limit=${encodeURIComponent(limit)}`, {
            method: 'GET',
            headers: { 'X-Provision-Secret': BARCODE_SVC_SECRET },
            cache: 'no-store'
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        renderTransfers(data.transfers || []);
    } catch (e) {
        if (listEl) listEl.innerHTML = '';
        if (errEl) { errEl.style.display = 'block'; errEl.textContent = '❌ Не удалось загрузить перемещения: ' + e.message; }
    }
}

function renderTransfers(transfers) {
    const listEl = document.getElementById('bcTransfersList');
    if (!listEl) return;
    if (!transfers.length) {
        listEl.innerHTML = '<div style="color:var(--color-text-secondary);font-size:13px;">Нет документов перемещения.</div>';
        return;
    }
    let html = '';
    for (const t of transfers) {
        const dt = t.date ? new Date(t.date).toLocaleDateString('ru-RU') : '';
        let rows = '';
        for (const l of (t.lines || [])) {
            // Коды, которые реально переехали (из истории системы) или указанные в документе 1С.
            const moved = Array.isArray(l.movedBarcodes) ? l.movedBarcodes : [];
            const docBc = Array.isArray(l.docBarcodes) ? l.docBarcodes : [];
            let codesHtml = '';
            if (moved.length) {
                codesHtml = moved.map(b =>
                    `<span style="display:inline-block;background:#eafaf1;color:#1e8449;border:1px solid #cdeeda;`
                    + `padding:2px 8px;border-radius:8px;font-size:12px;font-family:monospace;margin:2px 4px 2px 0;">${escapeHtml(b)}</span>`
                ).join('');
            } else if (docBc.length) {
                // коды из самого документа 1С (ещё не обработано автосинхронизацией)
                codesHtml = docBc.map(b =>
                    `<span style="display:inline-block;background:#eef4fd;color:#1c5fbf;border:1px solid #cfe0f7;`
                    + `padding:2px 8px;border-radius:8px;font-size:12px;font-family:monospace;margin:2px 4px 2px 0;" `
                    + `title="Указан в документе 1С">${escapeHtml(b)}</span>`
                ).join('');
            } else {
                codesHtml = '<span style="color:var(--color-text-secondary);font-size:12px;">— коды не указаны (перемещено по размеру/количеству)</span>';
            }
            // статус соответствия количества
            const cnt = moved.length || docBc.length;
            let badge;
            if (moved.length && moved.length >= (l.qty || 0)) {
                badge = '<span style="color:#1e8449;">✓ перемещён</span>';
            } else if (moved.length) {
                badge = '<span style="color:#1e8449;">✓ перемещён частично</span>';
            } else if (docBc.length) {
                badge = '<span style="color:#1c5fbf;" title="Коды указаны в 1С, автосинхронизация переместит их при следующем запуске">⏳ ожидает обработки</span>';
            } else {
                badge = '<span style="color:#b8860b;">— без кода</span>';
            }
            rows += `<tr style="border-top:1px solid var(--color-border,#eee);">`
                + `<td style="padding:8px 10px;vertical-align:top;">${escapeHtml(l.productName || l.productC1Ref || '')}</td>`
                + `<td style="padding:8px 10px;text-align:center;vertical-align:top;white-space:nowrap;">${escapeHtml(l.sizeLabel || '—')}</td>`
                + `<td style="padding:8px 10px;text-align:center;vertical-align:top;">${l.qty || 0}</td>`
                + `<td style="padding:8px 10px;text-align:center;vertical-align:top;">${cnt}</td>`
                + `<td style="padding:8px 10px;vertical-align:top;">${codesHtml}</td>`
                + `<td style="padding:8px 10px;text-align:center;vertical-align:top;white-space:nowrap;">${badge}</td>`
                + `</tr>`;
        }
        // есть ли в документе указанные коды (серии/штрихкод), которые ещё не переехали
        const hasDocCodes = (t.lines || []).some(l => Array.isArray(l.docBarcodes) && l.docBarcodes.length);
        const movedBadge = t.hasMovements
            ? `<span style="background:#eafaf1;color:#1e8449;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">✓ кодов переехало: ${t.movedTotal}</span>`
            : (hasDocCodes
                ? `<span style="background:#eef4fd;color:#1c5fbf;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;" title="Коды указаны в 1С, автосинхронизация переместит их при следующем запуске">⏳ коды указаны, ожидают перемещения</span>`
                : `<span style="background:#fef7e6;color:#b8860b;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">коды не указаны</span>`);
        html += `<div class="card" style="margin-bottom:14px;">`
            + `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">`
            + `<div><b>№ ${escapeHtml(t.number || '')}</b> · <span style="color:var(--color-text-secondary);">${dt}</span>`
            + (t.posted === false ? ' · <span style="color:#c0392b;">не проведён</span>' : '')
            + `<div style="margin-top:4px;font-size:13px;">`
            + `<span style="color:var(--color-text-secondary);">Склад:</span> `
            + `<b>${escapeHtml(t.from || '—')}</b> `
            + `<span style="color:#1c5fbf;">→</span> `
            + `<b>${escapeHtml(t.to || '—')}</b></div></div>`
            + `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">` + movedBadge + `</div></div>`
            + `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">`
            + `<thead><tr style="text-align:left;color:var(--color-text-secondary);font-size:12px;">`
            + `<th style="padding:6px 10px;">Товар</th>`
            + `<th style="padding:6px 10px;text-align:center;">Размер</th>`
            + `<th style="padding:6px 10px;text-align:center;">Кол-во</th>`
            + `<th style="padding:6px 10px;text-align:center;">Кодов</th>`
            + `<th style="padding:6px 10px;">Штрихкоды (что переехало)</th>`
            + `<th style="padding:6px 10px;text-align:center;">Статус</th></tr></thead>`
            + `<tbody>${rows}</tbody></table></div></div>`;
    }
    listEl.innerHTML = html;
}

// ── Генерация штрихкодов по документу прихода ───────────────────
// Собирает уникальные номенклатуры документа (у которых не хватает кодов)
// и для каждой запускает пораскладочную генерацию на сервисе 1c-sync-barcodes.
// Сервис создаёт коды по остатку КАЖДОГО склада и СРАЗУ отправляет их в 1С.
async function bcGenReceiptCodes(btn, refsJson) {
    let refs = [];
    try { refs = JSON.parse(decodeURIComponent(refsJson)); } catch (_) {}
    refs = [...new Set((refs || []).filter(Boolean))];
    if (!refs.length) { alert('Нет номенклатур для генерации.'); return; }

    const orig = btn.textContent;
    btn.disabled = true;
    let totalGen = 0, totalReg = 0, errors = [];
    try {
        let i = 0;
        for (const nom of refs) {
            i++;
            btn.textContent = `⏳ Генерирую ${i}/${refs.length}…`;
            try {
                const res = await fetch(`${BARCODE_SVC_URL}/api/auto-sync`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Provision-Secret': BARCODE_SVC_SECRET },
                    body: JSON.stringify({ provisionNom: nom, dryRun: false })
                });
                const d = await res.json();
                if (!res.ok || !d.ok) { errors.push(d.error || `HTTP ${res.status}`); continue; }
                totalGen += d.generated || 0;
                totalReg += d.registeredIn1C || 0;
            } catch (e) { errors.push(e.message); }
        }
        if (errors.length) {
            alert(`Готово с замечаниями.\nСоздано кодов: ${totalGen}\nОтправлено в 1С: ${totalReg}\nОшибки: ${errors.join('; ')}`);
        } else {
            alert(`✅ Готово.\nСоздано новых кодов: ${totalGen}\nОтправлено в 1С: ${totalReg}`);
        }
        await loadReceipts(true); // остаток уже актуален после генерации — не гоняем balance повторно
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

// ── Печать ценников по документу прихода ──────────────────────
// Печатает РОВНО столько этикеток, сколько ПРИШЛО в документе,
// по каждой характеристике (размеру) — а НЕ весь остаток по номенклатуре.
// Не генерирует ничего нового — только печать.
// Аргумент: JSON-массив позиций [{productC1Ref, charC1Ref, qty}].
async function bcPrintReceiptLabels(btn, linesJson) {
    let plines = [];
    try { plines = JSON.parse(decodeURIComponent(linesJson)); } catch (_) {}
    plines = (plines || []).filter(l => l && l.charC1Ref && (l.qty || 0) > 0);
    if (!plines.length) { alert('Нет позиций для печати.'); return; }

    // сворачиваем дубли характеристик: если один размер встречается дважды — суммируем qty
    const qtyByChar = new Map();     // charRef -> сколько печатать
    const prodByChar = new Map();    // charRef -> productC1Ref
    for (const l of plines) {
        qtyByChar.set(l.charC1Ref, (qtyByChar.get(l.charC1Ref) || 0) + (Number(l.qty) || 0));
        if (l.productC1Ref) prodByChar.set(l.charC1Ref, l.productC1Ref);
    }
    const charRefs = [...qtyByChar.keys()];
    const prodRefs = [...new Set([...prodByChar.values()].filter(Boolean))];

    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Готовлю печать…';
    try {
        const { w, h } = bcGetLabelSize();

        // 1) коды на складе ТОЛЬКО по нужным характеристикам (размерам)
        // сортируем: сначала ненапечатанные (printed_at NULL), затем по seq
        const { data: rows, error } = await ortobotClient
            .from('stock_units')
            .select('unique_barcode,size_label,c1_char_ref,c1_prod_ref,warehouse_id,status,created_at,received_at,seq,printed_at')
            .in('c1_char_ref', charRefs)
            .eq('status', 'in_stock')
            .order('printed_at', { ascending: true, nullsFirst: true })
            .order('seq', { ascending: true });
        if (error) throw error;
        if (!rows || !rows.length) { alert('Нет кодов для печати по этому документу.'); return; }

        // 2) отбираем РОВНО qty по каждой характеристике
        const takenByChar = new Map();
        const picked = [];
        for (const u of rows) {
            const ch = u.c1_char_ref;
            const limit = qtyByChar.get(ch) || 0;
            const taken = takenByChar.get(ch) || 0;
            if (taken >= limit) continue;
            picked.push(u);
            takenByChar.set(ch, taken + 1);
        }
        if (!picked.length) { alert('Не нашлось кодов для печати.'); return; }

        // предупреждение, если кодов меньше, чем нужно напечатать
        const shorted = [];
        for (const [ch, limit] of qtyByChar.entries()) {
            const got = takenByChar.get(ch) || 0;
            if (got < limit) shorted.push(`${got}/${limit}`);
        }

        // 3) имена товаров (в stock_units имени нет)
        const nameByRef = {};
        if (prodRefs.length) {
            try {
                const { data: prods } = await ortobotClient
                    .from('products').select('c1_ref,name_ru').in('c1_ref', prodRefs);
                (prods || []).forEach(p => { nameByRef[p.c1_ref] = p.name_ru; });
            } catch (_) {}
        }

        // 4) unit-объекты
        const units = picked.map(u => ({
            unique_barcode: u.unique_barcode || '',
            size_label: u.size_label || '',
            name: nameByRef[u.c1_prod_ref] || '',
            warehouse_id: u.warehouse_id,
            status: u.status,
            created_at: u.created_at || u.received_at,
            charRef: u.c1_char_ref || null,
            productC1Ref: u.c1_prod_ref || null,
            priceOld: null, priceNew: null, currency: 'TJS'
        }));

        // 5) цены из 1С + рендер + печать
        await bcEnsurePricesForUnits(units);
        if (shorted.length) {
            alert('⚠️ Кодов на складе меньше, чем пришло по документу (напечатаю ' + picked.length + ' шт.). '
                + 'Сначала сгенерируйте недостающие штрихкоды.');
        }
        renderLabels(units, w, h);
        bcDoPrint(w, h);

        // 6) отмечаем напечатанные (чтобы повторная печать брала другие коды)
        try {
            const bcs = picked.map(u => u.unique_barcode).filter(Boolean);
            if (bcs.length) {
                await ortobotClient.from('stock_units')
                    .update({ printed_at: new Date().toISOString() })
                    .in('unique_barcode', bcs);
            }
        } catch (_) { /* не критично для печати */ }
    } catch (e) {
        console.error('bcPrintReceiptLabels:', e);
        alert('Ошибка печати: ' + (e && e.message ? e.message : e));
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

// ── Размер этикетки (localStorage) ──────────────────────────────
function bcGetLabelSize() {
    const preset = document.getElementById('bcLabelPreset')?.value || '40x50';
    if (preset !== 'custom') {
        const m = preset.split('x');
        const w = parseFloat(m[0]) || 40;
        const h = parseFloat(m[1]) || 50;
        return { w, h };
    }
    const w = parseFloat(document.getElementById('bcLabelW')?.value) || 40;
    const h = parseFloat(document.getElementById('bcLabelH')?.value) || 50;
    return { w, h };
}
function bcSaveLabelSize() {
    const preset = document.getElementById('bcLabelPreset')?.value || '40x50';
    const { w, h } = bcGetLabelSize();
    try { localStorage.setItem('labelSize', JSON.stringify({ preset, w, h })); } catch (_) {}
}
function bcRestoreLabelSize() {
    try {
        const raw = localStorage.getItem('labelSize');
        if (!raw) return;
        const saved = JSON.parse(raw);
        const presetEl = document.getElementById('bcLabelPreset');
        const wEl = document.getElementById('bcLabelW');
        const hEl = document.getElementById('bcLabelH');
        // подбираем пресет: явный или по w×h, иначе custom
        let preset = saved.preset;
        if (!preset && saved.w && saved.h) {
            const key = `${saved.w}x${saved.h}`;
            const has = presetEl && Array.from(presetEl.options).some(o => o.value === key);
            preset = has ? key : 'custom';
        }
        if (presetEl && preset) presetEl.value = preset;
        if (wEl && saved.w) wEl.value = saved.w;
        if (hEl && saved.h) hEl.value = saved.h;
        bcToggleCustomSize();
    } catch (_) {}
}
// Показать/скрыть поля Свой размер в зависимости от дропдауна
function bcToggleCustomSize() {
    const preset = document.getElementById('bcLabelPreset')?.value || '40x50';
    const show = preset === 'custom';
    ['bcCustomSizeW', 'bcCustomSizeH'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = show ? '' : 'none';
    });
}

// ── Поиск товара по названию ────────────────────────────────────
function bcSearchProducts(query) {
    const box = bcEnsureSearchBox();
    const q = String(query || '').trim().toLowerCase();
    if (q.length < 2) { box.style.display = 'none'; return; }

    const matches = barcodesState.products
        .filter(p => (p.name_ru || '').toLowerCase().includes(q))
        .slice(0, 30);

    if (!matches.length) {
        box.innerHTML = '<div style="padding:8px 10px;color:#888;">Ничего не найдено</div>';
        box.style.display = 'block';
        return;
    }

    box.innerHTML = matches.map(p =>
        `<div class="bc-search-item" data-pid="${escapeHtml(p.id)}" style="padding:8px 10px;cursor:pointer;border-bottom:1px solid #eee;">
            ${escapeHtml(p.name_ru)}${p.category ? ` <span style="color:#999;">· ${escapeHtml(p.category)}</span>` : ''}
        </div>`
    ).join('');
    box.style.display = 'block';

    box.querySelectorAll('.bc-search-item').forEach(item => {
        item.addEventListener('mouseenter', function () { this.style.background = '#f0f0f0'; });
        item.addEventListener('mouseleave', function () { this.style.background = ''; });
        item.addEventListener('click', function () {
            bcSelectProduct(this.dataset.pid);
            box.style.display = 'none';
        });
    });
}

// Создать/получить контейнер выпадающего списка результатов поиска
function bcEnsureSearchBox() {
    let box = document.getElementById('bcSearchResults');
    if (!box) {
        const inp = document.getElementById('bcProductSearch');
        box = document.createElement('div');
        box.id = 'bcSearchResults';
        box.style.cssText = 'position:absolute;top:100%;left:0;right:0;z-index:60;background:#fff;' +
            'border:1px solid #ccc;border-radius:6px;max-height:260px;overflow-y:auto;' +
            'box-shadow:0 6px 18px rgba(0,0,0,.14);display:none;';
        inp.parentElement.style.position = 'relative';
        inp.parentElement.appendChild(box);
    }
    return box;
}

// Натуральная сортировка размеров (числа перед текстом, «33-35» по первому числу)
function bcSizeSortKey(s) {
    const m = String(s || '').match(/\d+/);
    return m ? parseInt(m[0], 10) : 99999;
}

// Выбор товара -> список размеров чекбоксами (мультивыбор + «выбрать все»)
function bcSelectProduct(pid) {
    barcodesState.selectedProductId = pid;
    const prod = barcodesState.products.find(p => String(p.id) === String(pid));
    const inp = document.getElementById('bcProductSearch');
    if (inp && prod) inp.value = prod.name_ru || '';

    const box = document.getElementById('bcVariants');
    if (!box) return;

    const whId = document.getElementById('bcWarehouse')?.value || '';
    const multiWh = !whId; // если склад не выбран — показываем склад у каждого размера

    let vs = barcodesState.variants.filter(v => String(v.product_id) === String(pid));
    if (whId) vs = vs.filter(v => String(v.warehouse_id) === String(whId));
    // только с остатком > 0 (печатать этикетки без остатка бессмысленно)
    vs = vs.filter(v => (v.stock || 0) > 0);

    // Сортировка: по размеру, затем по складу
    vs.sort((a, b) => {
        const ka = bcSizeSortKey(a.size_label), kb = bcSizeSortKey(b.size_label);
        if (ka !== kb) return ka - kb;
        return String(a.size_label || '').localeCompare(String(b.size_label || ''));
    });

    if (!vs.length) {
        box.innerHTML = '<div class="bc-variants-empty">Нет размеров с остатком' +
            (whId ? ' на этом складе' : '') + '.</div>';
        return;
    }

    const rows = vs.map(v => {
        const size = escapeHtml(v.size_label || '(без размера)');
        const whName = multiWh ? `<span class="bc-variant-wh">${escapeHtml(bcWhName(v.warehouse_id))}</span>` : '';
        return `<label class="bc-variant-row">
            <input type="checkbox" class="bc-variant-cb" value="${escapeHtml(v.id)}" data-stock="${v.stock}">
            <span class="bc-variant-size">${size}</span>
            ${whName}
            <span class="bc-variant-stock">остаток: ${v.stock}</span>
        </label>`;
    }).join('');

    box.innerHTML =
        `<label class="bc-variants-head">
            <input type="checkbox" id="bcSelectAll"> Выбрать все размеры (${vs.length})
        </label>${rows}`;

    // «Выбрать все»
    const selAll = box.querySelector('#bcSelectAll');
    const cbs = () => Array.from(box.querySelectorAll('.bc-variant-cb'));
    if (selAll) {
        selAll.addEventListener('change', function () {
            cbs().forEach(cb => { cb.checked = this.checked; });
        });
    }
    // при ручном изменении обновляем состояние «выбрать все»
    box.addEventListener('change', function (e) {
        if (e.target.classList.contains('bc-variant-cb') && selAll) {
            const all = cbs();
            selAll.checked = all.length > 0 && all.every(cb => cb.checked);
            selAll.indeterminate = !selAll.checked && all.some(cb => cb.checked);
        }
    });
}

// Собрать выбранные варианты: [{variantId, stock}]
function bcSelectedVariants() {
    const box = document.getElementById('bcVariants');
    if (!box) return [];
    return Array.from(box.querySelectorAll('.bc-variant-cb:checked')).map(cb => ({
        variantId: cb.value,
        stock: parseInt(cb.dataset.stock || '0', 10)
    }));
}

// ================================================================
// ПРИХОД ТОВАРА (подвкладка «➕ Приход»)
// Создаёт документ Поступления в 1С через create-receipt.
// Размеры — рекомендация из существующих вариантов товара (не создаём заново).
// ================================================================
const receiptState = { selectedProductId: null, refs: null, refsLoading: false };

function initReceiptTab() {
    const whSel = document.getElementById('rcpWarehouse');
    if (whSel && !whSel.dataset.filled) {
        const opts = (barcodesState.warehouses || [])
            .map(w => `<option value="${escapeHtml(w.c1_ref || '')}" data-id="${escapeHtml(w.id)}">${escapeHtml(w.name || w.c1_code || w.id)}</option>`)
            .join('');
        whSel.innerHTML = opts || '<option value="">Нет складов</option>';
        whSel.dataset.filled = '1';
        whSel.addEventListener('change', function () {
            if (receiptState.selectedProductId) rcpSelectProduct(receiptState.selectedProductId);
        });
    }
    const searchEl = document.getElementById('rcpProductSearch');
    if (searchEl && !searchEl.dataset.bound) {
        let t = null;
        searchEl.addEventListener('input', function () {
            clearTimeout(t);
            const q = this.value;
            t = setTimeout(() => rcpSearchProducts(q), 250);
        });
        searchEl.dataset.bound = '1';
    }
    // Справочники 1С (поставщики / виды / этикетки) — грузим один раз
    rcpLoadRefs();
    // Фильтр размеров в модалке
    const sf = document.getElementById('nmSizeFilter');
    if (sf && !sf.dataset.bound) {
        sf.addEventListener('input', function () { rcpRenderSizePool(this.value); });
        sf.dataset.bound = '1';
    }
}

// Загрузка справочников из 1С (поставщики/виды/этикетки) + заполнение селектов
async function rcpLoadRefs(force) {
    if (receiptState.refsLoading) return;
    if (receiptState.refs && !force) { rcpFillRefSelects(); return; }
    receiptState.refsLoading = true;
    try {
        const res = await fetch(`${BARCODE_SVC_URL}/api/refs?kind=all`, {
            method: 'GET',
            headers: { 'X-Provision-Secret': BARCODE_SVC_SECRET },
            cache: 'no-store'
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        receiptState.refs = {
            suppliers: data.suppliers || [],
            kinds: data.kinds || [],
            labels: data.labels || [],
            unitSht: data.unitSht || null
        };
        rcpFillRefSelects();
    } catch (e) {
        console.error('rcpLoadRefs:', e);
        const sup = document.getElementById('rcpSupplier');
        if (sup && sup.options.length <= 1) {
            sup.innerHTML = '<option value="">— не удалось загрузить поставщиков —</option>';
        }
    } finally {
        receiptState.refsLoading = false;
    }
}

function rcpFillRefSelects() {
    const r = receiptState.refs;
    if (!r) return;
    // Поставщик (один на документ)
    const sup = document.getElementById('rcpSupplier');
    if (sup && !sup.dataset.filled) {
        sup.innerHTML = '<option value="">— без поставщика —</option>'
            + r.suppliers.map(s => `<option value="${escapeHtml(s.ref)}">${escapeHtml(s.name)}</option>`).join('');
        sup.dataset.filled = '1';
    }
    // Вид номенклатуры (категория) — в модалке
    const kind = document.getElementById('nmKind');
    if (kind && !kind.dataset.filled) {
        kind.innerHTML = r.kinds.map(k =>
            `<option value="${escapeHtml(k.ref)}"${/мужская обувь/i.test(k.name) ? ' selected' : ''}>${escapeHtml(k.name)}</option>`).join('');
        kind.dataset.filled = '1';
    }
    // Этикетка — в модалке (дефолт — Акционная)
    const lbl = document.getElementById('nmLabel');
    if (lbl && !lbl.dataset.filled) {
        lbl.innerHTML = r.labels.map(l =>
            `<option value="${escapeHtml(l.ref)}"${/акционная/i.test(l.name) ? ' selected' : ''}>${escapeHtml(l.name)}</option>`).join('');
        lbl.dataset.filled = '1';
    }
}

// Пул размеров из существующих вариантов (чистый, уникальный)
function rcpSizePool() {
    const set = new Set();
    (barcodesState.variants || []).forEach(v => {
        const s = (v.size_label || '').trim();
        if (s) set.add(s);
    });
    // добавленные вручную размеры
    (receiptState.customSizes || []).forEach(s => set.add(s));
    return [...set].sort((a, b) => {
        const ka = bcSizeSortKey(a), kb = bcSizeSortKey(b);
        if (ka !== kb) return ka - kb;
        return String(a).localeCompare(String(b));
    });
}

function rcpRenderSizePool(filter) {
    const box = document.getElementById('nmSizesBox');
    if (!box) return;
    const q = String(filter || '').trim().toLowerCase();
    const pool = rcpSizePool().filter(s => !q || s.toLowerCase().includes(q));
    const checked = receiptState.checkedSizes || new Set();
    if (!pool.length) {
        box.innerHTML = '<span style="color:#888;font-size:12px;">Нет размеров по фильтру. Добавьте свой ниже.</span>';
        return;
    }
    box.innerHTML = pool.map(s => {
        const on = checked.has(s);
        return `<label style="display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border:1px solid ${on ? '#2563eb' : '#ddd'};border-radius:16px;cursor:pointer;font-size:13px;background:${on ? '#eff6ff' : '#fff'};">`
            + `<input type="checkbox" class="nm-size-cb" value="${escapeHtml(s)}"${on ? ' checked' : ''} style="margin:0;"> ${escapeHtml(s)}</label>`;
    }).join('');
    box.querySelectorAll('.nm-size-cb').forEach(cb => {
        cb.addEventListener('change', function () {
            if (!receiptState.checkedSizes) receiptState.checkedSizes = new Set();
            if (this.checked) receiptState.checkedSizes.add(this.value);
            else receiptState.checkedSizes.delete(this.value);
            rcpRenderSizePool(document.getElementById('nmSizeFilter')?.value || '');
        });
    });
}

function rcpAddCustomSize() {
    const inp = document.getElementById('nmSizeCustom');
    const raw = (inp?.value || '').trim();
    if (!raw) return;
    // нормализуем в «размер:NN» как на бэкенде
    let sl = raw;
    if (!/^размер\s*:/i.test(sl)) sl = 'размер:' + sl;
    else sl = sl.replace(/^размер\s*:\s*/i, 'размер:');
    if (!receiptState.customSizes) receiptState.customSizes = [];
    if (!receiptState.customSizes.includes(sl)) receiptState.customSizes.push(sl);
    if (!receiptState.checkedSizes) receiptState.checkedSizes = new Set();
    receiptState.checkedSizes.add(sl);
    if (inp) inp.value = '';
    rcpRenderSizePool(document.getElementById('nmSizeFilter')?.value || '');
}

function rcpOpenCreateNomen() {
    // готовим состояние размеров
    receiptState.customSizes = receiptState.customSizes || [];
    receiptState.checkedSizes = new Set();
    const nm = document.getElementById('rcpNomenModal');
    const err = document.getElementById('nmError'); if (err) err.style.display = 'none';
    const info = document.getElementById('nmInfo'); if (info) info.innerHTML = '';
    const nameEl = document.getElementById('nmName'); if (nameEl) nameEl.value = '';
    const sf = document.getElementById('nmSizeFilter'); if (sf) sf.value = '';
    rcpLoadRefs();          // убедиться, что виды/этикетки загружены
    rcpRenderSizePool('');
    if (nm) nm.style.display = 'block';
}

function rcpCloseCreateNomen() {
    const nm = document.getElementById('rcpNomenModal');
    if (nm) nm.style.display = 'none';
}

async function rcpSubmitCreateNomen() {
    const err = document.getElementById('nmError');
    const info = document.getElementById('nmInfo');
    const btn = document.getElementById('nmSubmitBtn');
    if (err) err.style.display = 'none';
    if (info) info.innerHTML = '';

    const name = (document.getElementById('nmName')?.value || '').trim();
    const kindC1Ref = document.getElementById('nmKind')?.value || '';
    const labelC1Ref = document.getElementById('nmLabel')?.value || '';
    const categoryText = document.getElementById('nmKind')?.selectedOptions?.[0]?.textContent?.trim() || null;
    const sizes = [...(receiptState.checkedSizes || new Set())];

    if (!name) { if (err) { err.textContent = 'Укажите наименование товара.'; err.style.display = 'block'; } return; }
    if (!kindC1Ref) { if (err) { err.textContent = 'Выберите товарную категорию (вид).'; err.style.display = 'block'; } return; }
    if (!labelC1Ref) { if (err) { err.textContent = 'Выберите этикетку.'; err.style.display = 'block'; } return; }
    if (!sizes.length) { if (err) { err.textContent = 'Отметьте хотя бы один размер (или добавьте свой).'; err.style.display = 'block'; } return; }

    // склад для вариантов — текущий выбранный в форме прихода
    const whSel = document.getElementById('rcpWarehouse');
    const warehouseId = whSel?.selectedOptions?.[0]?.dataset?.id || null;

    if (btn) { btn.disabled = true; btn.dataset._t = btn.textContent; btn.textContent = '⏳ Создаю…'; }
    if (info) info.innerHTML = `Создаю товар в 1С (${sizes.length} размеров)…`;
    try {
        const res = await fetch(`${BARCODE_SVC_URL}/api/create-nomenclature`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Provision-Secret': BARCODE_SVC_SECRET },
            body: JSON.stringify({ name, kindC1Ref, labelC1Ref, category: categoryText, sizes, warehouseId }),
            cache: 'no-store'
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

        // добавляем свежий товар в локальный справочник (чтобы сразу выбрать в приход)
        const newProd = {
            id: data.supabaseProductId,
            name_ru: name,
            category: categoryText,
            c1_ref: data.productC1Ref,
            is_active: true
        };
        if (data.supabaseProductId) {
            barcodesState.products = barcodesState.products || [];
            barcodesState.products.push(newProd);
            if (!barcodesState.prodC1ById) barcodesState.prodC1ById = {};
            barcodesState.prodC1ById[newProd.id] = newProd.c1_ref;
            // варианты
            barcodesState.variants = barcodesState.variants || [];
            (data.chars || []).forEach(c => {
                if (c.variantId) barcodesState.variants.push({
                    id: c.variantId, product_id: newProd.id, warehouse_id: warehouseId,
                    size_label: c.size, c1_char_ref: c.charC1Ref, stock: 0, price: null, price_old: null
                });
            });
        }

        let html = `✅ Создано: <b>${escapeHtml(name)}</b> (код ${escapeHtml(data.productC1Code || '')}), размеров: ${(data.chars || []).length}.`;
        if (Array.isArray(data.warnings) && data.warnings.length) {
            html += `<br><span style="color:#b26a00;">⚠️ ${data.warnings.map(escapeHtml).join('; ')}</span>`;
        }
        if (info) info.innerHTML = html;

        // автовыбор товара в форме прихода
        if (data.supabaseProductId) {
            setTimeout(() => {
                rcpCloseCreateNomen();
                rcpSelectProduct(newProd.id);
            }, 900);
        }
    } catch (e) {
        if (err) { err.textContent = '❌ ' + e.message; err.style.display = 'block'; }
        if (info) info.innerHTML = '';
    } finally {
        if (btn) { btn.disabled = false; if (btn.dataset._t) btn.textContent = btn.dataset._t; }
    }
}

function rcpEnsureSearchBox() {
    let box = document.getElementById('rcpSearchResults');
    if (!box) {
        const inp = document.getElementById('rcpProductSearch');
        box = document.createElement('div');
        box.id = 'rcpSearchResults';
        box.style.cssText = 'position:absolute;top:100%;left:0;right:0;z-index:60;background:#fff;' +
            'border:1px solid #ccc;border-radius:6px;max-height:260px;overflow-y:auto;' +
            'box-shadow:0 6px 18px rgba(0,0,0,.14);display:none;';
        inp.parentElement.style.position = 'relative';
        inp.parentElement.appendChild(box);
    }
    return box;
}

function rcpSearchProducts(query) {
    const box = rcpEnsureSearchBox();
    const q = String(query || '').trim().toLowerCase();
    if (q.length < 2) { box.style.display = 'none'; return; }
    const matches = (barcodesState.products || [])
        .filter(p => (p.name_ru || '').toLowerCase().includes(q))
        .slice(0, 30);
    if (!matches.length) {
        box.innerHTML = '<div style="padding:8px 10px;color:#888;">Ничего не найдено</div>';
        box.style.display = 'block';
        return;
    }
    box.innerHTML = matches.map(p =>
        `<div class="rcp-search-item" data-pid="${escapeHtml(p.id)}" style="padding:8px 10px;cursor:pointer;border-bottom:1px solid #eee;">
            ${escapeHtml(p.name_ru)}${p.category ? ` <span style="color:#999;">· ${escapeHtml(p.category)}</span>` : ''}
        </div>`
    ).join('');
    box.style.display = 'block';
    box.querySelectorAll('.rcp-search-item').forEach(item => {
        item.addEventListener('mouseenter', function () { this.style.background = '#f0f0f0'; });
        item.addEventListener('mouseleave', function () { this.style.background = ''; });
        item.addEventListener('click', function () {
            rcpSelectProduct(this.dataset.pid);
            box.style.display = 'none';
        });
    });
}

function rcpSelectProduct(pid) {
    receiptState.selectedProductId = pid;
    const prod = (barcodesState.products || []).find(p => String(p.id) === String(pid));
    const inp = document.getElementById('rcpProductSearch');
    if (inp && prod) inp.value = prod.name_ru || '';

    const box = document.getElementById('rcpProductBox');
    const pricesBox = document.getElementById('rcpPricesBox');
    const submitBtn = document.getElementById('rcpSubmitBtn');
    if (!box || !prod) return;

    const whSel = document.getElementById('rcpWarehouse');
    const whId = whSel?.selectedOptions?.[0]?.dataset?.id || '';

    let vs = (barcodesState.variants || []).filter(v => String(v.product_id) === String(pid));
    const byChar = {};
    vs.forEach(v => {
        const key = v.c1_char_ref || v.size_label || v.id;
        if (!byChar[key]) {
            byChar[key] = {
                charRef: v.c1_char_ref || '', size: v.size_label || '(без размера)',
                variantIdOnWh: null, stockOnWh: 0,
                // текущие цены из базы (берём любой вариант этого размера; если есть на выбранном складе — предпочтём его)
                price: (v.price != null && v.price !== '') ? Number(v.price) : null,
                priceOld: (v.price_old != null && v.price_old !== '') ? Number(v.price_old) : null
            };
        }
        if (whId && String(v.warehouse_id) === String(whId)) {
            byChar[key].variantIdOnWh = v.id;
            byChar[key].stockOnWh = Number(v.stock) || 0;
            // на выбранном складе цены точнее — перекрываем
            if (v.price != null && v.price !== '') byChar[key].price = Number(v.price);
            if (v.price_old != null && v.price_old !== '') byChar[key].priceOld = Number(v.price_old);
        }
    });
    let sizes = Object.values(byChar);
    sizes.sort((a, b) => {
        const ka = bcSizeSortKey(a.size), kb = bcSizeSortKey(b.size);
        if (ka !== kb) return ka - kb;
        return String(a.size).localeCompare(String(b.size));
    });

    if (!sizes.length) {
        box.innerHTML = '<div style="padding:10px;color:#888;">У товара нет размеров в базе. (Создание новых размеров — позже.)</div>';
        box.style.display = 'block';
        if (pricesBox) pricesBox.style.display = 'none';
        if (submitBtn) submitBtn.disabled = true;
        return;
    }

    const pv = v => (v == null ? '' : v);
    const rows = sizes.map((s, i) => `
        <tr>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                    <input type="checkbox" class="rcp-size-cb" data-idx="${i}"
                        data-charref="${escapeHtml(s.charRef)}"
                        data-size="${escapeHtml(s.size)}"
                        data-variantid="${escapeHtml(s.variantIdOnWh || '')}">
                    <b>${escapeHtml(s.size)}</b>
                </label>
            </td>
            <td style="padding:6px 6px;border-bottom:1px solid #eee;color:#888;font-size:12px;white-space:nowrap;">ост.: ${s.stockOnWh}</td>
            <td style="padding:6px 6px;border-bottom:1px solid #eee;">
                <input type="number" class="rcp-size-qty form-control" data-idx="${i}" min="0" step="1" value="0" style="width:64px;" title="Количество пар">
            </td>
            <td style="padding:6px 6px;border-bottom:1px solid #eee;">
                <input type="number" class="rcp-size-purchase form-control" data-idx="${i}" min="0" step="0.01" value="" placeholder="0" style="width:84px;" title="Цена закупки">
            </td>
            <td style="padding:6px 6px;border-bottom:1px solid #eee;">
                <input type="number" class="rcp-size-old form-control" data-idx="${i}" min="0" step="0.01" value="${pv(s.priceOld)}" placeholder="—" style="width:84px;" title="Старая (зачёркнутая) цена">
            </td>
            <td style="padding:6px 6px;border-bottom:1px solid #eee;">
                <input type="number" class="rcp-size-new form-control" data-idx="${i}" min="0" step="0.01" value="${pv(s.price)}" placeholder="0" style="width:84px;" title="Новая розничная цена">
            </td>
        </tr>`).join('');

    box.innerHTML = `
        <div style="font-weight:600;margin:4px 0 8px;">${escapeHtml(prod.name_ru)} — размеры</div>
        <div style="font-size:12px;color:#888;margin-bottom:6px;">Цены подставлены из базы — меняйте только где нужно. Отметьте размеры и укажите количество пар.</div>
        <div style="overflow-x:auto;">
        <table style="border-collapse:collapse;width:100%;min-width:560px;">
            <thead><tr>
                <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #ddd;font-size:12px;">Размер</th>
                <th style="text-align:left;padding:6px 6px;border-bottom:2px solid #ddd;font-size:12px;">Склад</th>
                <th style="text-align:left;padding:6px 6px;border-bottom:2px solid #ddd;font-size:12px;">Кол-во</th>
                <th style="text-align:left;padding:6px 6px;border-bottom:2px solid #ddd;font-size:12px;">Закупка</th>
                <th style="text-align:left;padding:6px 6px;border-bottom:2px solid #ddd;font-size:12px;">Старая</th>
                <th style="text-align:left;padding:6px 6px;border-bottom:2px solid #ddd;font-size:12px;">Новая</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
        </div>`;
    box.style.display = 'block';
    box.querySelectorAll('.rcp-size-qty').forEach(q => {
        q.addEventListener('input', function () {
            const cb = box.querySelector(`.rcp-size-cb[data-idx="${this.dataset.idx}"]`);
            if (cb) cb.checked = (Number(this.value) || 0) > 0;
        });
    });
    if (pricesBox) pricesBox.style.display = 'none'; // цены теперь построчно
    if (submitBtn) submitBtn.disabled = false;
}

function rcpReset() {
    receiptState.selectedProductId = null;
    ['rcpProductSearch'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    const box = document.getElementById('rcpProductBox'); if (box) { box.style.display = 'none'; box.innerHTML = ''; }
    const pricesBox = document.getElementById('rcpPricesBox'); if (pricesBox) pricesBox.style.display = 'none';
    const err = document.getElementById('rcpError'); if (err) err.style.display = 'none';
    const info = document.getElementById('rcpInfo'); if (info) info.innerHTML = '';
    const submitBtn = document.getElementById('rcpSubmitBtn'); if (submitBtn) submitBtn.disabled = true;
}

async function rcpSubmit() {
    const err = document.getElementById('rcpError');
    const info = document.getElementById('rcpInfo');
    const submitBtn = document.getElementById('rcpSubmitBtn');
    if (err) err.style.display = 'none';
    if (info) info.innerHTML = '';

    const prod = (barcodesState.products || []).find(p => String(p.id) === String(receiptState.selectedProductId));
    if (!prod || !prod.c1_ref) {
        if (err) { err.textContent = 'Выберите товар (у него должен быть c1_ref).'; err.style.display = 'block'; }
        return;
    }
    const whSel = document.getElementById('rcpWarehouse');
    const warehouseC1Ref = whSel?.value || '';
    if (!warehouseC1Ref) {
        if (err) { err.textContent = 'Выберите склад прихода.'; err.style.display = 'block'; }
        return;
    }

    // Поставщик (один на весь документ), из справочника 1С
    const supplierC1Ref = document.getElementById('rcpSupplier')?.value || null;

    const box = document.getElementById('rcpProductBox');

    // Цены теперь построчные: берём из полей каждого размера (предзаполнены из базы).
    const items = [];
    box.querySelectorAll('.rcp-size-cb').forEach(cb => {
        const idx = cb.dataset.idx;
        const qtyEl = box.querySelector(`.rcp-size-qty[data-idx="${idx}"]`);
        const qty = Number(qtyEl?.value) || 0;
        if (cb.checked && qty > 0) {
            const pRaw = box.querySelector(`.rcp-size-purchase[data-idx="${idx}"]`)?.value;
            const oRaw = box.querySelector(`.rcp-size-old[data-idx="${idx}"]`)?.value;
            const nRaw = box.querySelector(`.rcp-size-new[data-idx="${idx}"]`)?.value;
            items.push({
                productC1Ref: prod.c1_ref,
                charC1Ref: cb.dataset.charref || null,
                qty,
                purchasePrice: (pRaw === '' || pRaw == null) ? 0 : Number(pRaw),
                priceNew: (nRaw === '' || nRaw == null) ? null : Number(nRaw),
                priceOld: (oRaw === '' || oRaw == null) ? null : Number(oRaw),
                variantId: cb.dataset.variantid || null
            });
        }
    });

    if (!items.length) {
        if (err) { err.textContent = 'Отметьте хотя бы один размер с количеством > 0.'; err.style.display = 'block'; }
        return;
    }

    const totalPairs = items.reduce((s, it) => s + it.qty, 0);
    if (submitBtn) { submitBtn.disabled = true; submitBtn.dataset._t = submitBtn.textContent; submitBtn.textContent = '⏳ Оприходую…'; }
    if (info) info.innerHTML = `Отправляю в 1С: ${items.length} размер(ов), всего ${totalPairs} пар…`;

    try {
        const res = await fetch(`${BARCODE_SVC_URL}/api/create-receipt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Provision-Secret': BARCODE_SVC_SECRET },
            body: JSON.stringify({ warehouseC1Ref, supplierC1Ref, items, post: true, writePrice: true, comment: `Приход из дашборда: ${prod.name_ru}` }),
            cache: 'no-store'
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

        let html = `✅ Документ поступления создан: <b>${escapeHtml(data.docNumber || data.docRef || '')}</b>`;
        if (data.posted) html += ' (проведён)';
        if (data.priceDoc && data.priceDoc.ok && !data.priceDoc.skipped) {
            html += `<br>💰 Новая розничная цена записана в 1С (док. ${escapeHtml(data.priceDoc.docNumber || '')})`;
        }
        if (data.priceResult && data.priceResult.updatedVariants) {
            html += `<br>🏷️ Обновлены цены для ${data.priceResult.updatedVariants} вариант(ов) в базе`;
        }
        if (Array.isArray(data.warnings) && data.warnings.length) {
            html += `<br><span style="color:#b26a00;">⚠️ ${data.warnings.map(escapeHtml).join('; ')}</span>`;
        }
        html += `<br><br>Штрихкоды для этих пар сгенерируйте и распечатайте во вкладке <a href="#" onclick="switchBarcodesSubtab('print');return false;"><b>Печать</b></a>.`;
        if (info) info.innerHTML = html;

        if (typeof loadReceipts === 'function') { try { loadReceipts(); } catch (_) {} }
    } catch (e) {
        if (err) { err.textContent = '❌ ' + e.message; err.style.display = 'block'; }
        if (info) info.innerHTML = '';
    } finally {
        if (submitBtn) { submitBtn.disabled = false; if (submitBtn.dataset._t) submitBtn.textContent = submitBtn.dataset._t; }
    }
}

// Добавить текущий выбранный товар с отмеченными размерами в список
function bcAddToCart() {
    const err = document.getElementById('bcPrintError');
    if (err) err.style.display = 'none';

    const pid = barcodesState.selectedProductId;
    if (!pid) { bcShowPrintError('Сначала найдите и выберите товар, отметьте размеры, затем нажмите «Добавить».'); return; }
    const sel = bcSelectedVariants();
    if (!sel.length) { bcShowPrintError('Отметьте хотя бы один размер галочкой перед добавлением.'); return; }

    const prod = barcodesState.products.find(p => String(p.id) === String(pid));
    const name = (prod && prod.name_ru) || '';
    const c1Ref = (barcodesState.prodC1ById && barcodesState.prodC1ById[pid]) || null;

    const variants = sel.map(s => {
        const vi = (barcodesState.variantInfo && barcodesState.variantInfo[s.variantId]) || {};
        return { variantId: s.variantId, charRef: vi.charRef || null, size: vi.size || '', stock: s.stock };
    });

    // Если товар уже в списке — объединяем размеры (без дублей по variantId)
    const existing = barcodesState.printCart.find(c => String(c.productId) === String(pid));
    if (existing) {
        const have = new Set(existing.variants.map(v => String(v.variantId)));
        variants.forEach(v => { if (!have.has(String(v.variantId))) existing.variants.push(v); });
    } else {
        barcodesState.printCart.push({ productId: pid, name, c1Ref, variants });
    }

    // Сбрасываем текущий выбор, чтобы можно было выбрать следующий товар
    barcodesState.selectedProductId = null;
    const searchInp = document.getElementById('bcProductSearch');
    if (searchInp) searchInp.value = '';
    const vbox = document.getElementById('bcVariants');
    if (vbox) vbox.innerHTML = '<div class="bc-variants-empty">Выберите следующий товар выше или нажмите «Умная генерация и печать».</div>';

    bcRenderCart();
}

// Отрисовать список номенклатур к печати
function bcRenderCart() {
    const card = document.getElementById('bcCartCard');
    const list = document.getElementById('bcCartList');
    const count = document.getElementById('bcCartCount');
    const summary = document.getElementById('bcCartSummary');
    if (!card || !list) return;

    const cart = barcodesState.printCart;
    if (!cart.length) {
        card.style.display = 'none';
        list.innerHTML = '';
        if (summary) summary.innerHTML = '';
        if (count) count.textContent = '';
        return;
    }
    card.style.display = '';

    const totalVariants = cart.reduce((s, c) => s + c.variants.length, 0);
    const totalStock = cart.reduce((s, c) => s + c.variants.reduce((a, v) => a + (v.stock || 0), 0), 0);
    if (count) count.textContent = `${cart.length} номенклатур, ${totalVariants} размеров`;

    list.innerHTML = cart.map((c, i) => {
        const sizes = c.variants
            .slice()
            .sort((a, b) => bcSizeSortKey(a.size) - bcSizeSortKey(b.size))
            .map(v => `${escapeHtml(v.size || '?')} <span style="color:#888;">(${v.stock})</span>`)
            .join(', ');
        const sub = c.variants.reduce((a, v) => a + (v.stock || 0), 0);
        return `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid #e5e5e5;">
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;">${i + 1}. ${escapeHtml(c.name || c.productId)}</div>
                <div style="font-size:12px;color:var(--color-text-secondary);margin-top:2px;">Размеры: ${sizes} · сумма остатков ${sub}</div>
            </div>
            <button class="btn btn-secondary" style="padding:2px 10px;" onclick="bcRemoveFromCart(${i})" title="Убрать из списка">✕</button>
        </div>`;
    }).join('');

    if (summary) {
        summary.innerHTML = `<div>Итого в списке: <b>${cart.length}</b> номенклатур, <b>${totalVariants}</b> размеров, сумма остатков <b>${totalStock}</b>.</div>` +
            `<div style="font-size:11px;color:var(--color-text-secondary);margin-top:2px;">Нажмите «Посчитать этикетки» для точного числа этикеток, либо сразу «Умная генерация и печать».</div>`;
    }
}

function bcRemoveFromCart(idx) {
    barcodesState.printCart.splice(idx, 1);
    bcRenderCart();
}
function bcClearCart() {
    barcodesState.printCart = [];
    bcRenderCart();
    const info = document.getElementById('bcPrintInfo');
    if (info) info.textContent = '';
}

// Собрать все варианты из корзины + текущий выбор (для печати).
// Возвращает { selected:[{variantId,stock}], productList:[{c1Ref, charRefs:Set}] }
function bcCollectAllSelections() {
    const map = {}; // variantId -> {variantId, stock}
    // из корзины
    for (const c of barcodesState.printCart) {
        for (const v of c.variants) map[v.variantId] = { variantId: v.variantId, stock: v.stock };
    }
    // текущий выбор (если пользователь не нажал «Добавить», но что-то отметил)
    for (const s of bcSelectedVariants()) map[s.variantId] = { variantId: s.variantId, stock: s.stock };
    return Object.values(map);
}

// Предпросчёт: сколько этикеток потребуется по всему списку (dryRun smart-plan)
async function bcPreviewCount() {
    const summary = document.getElementById('bcCartSummary');
    const selected = bcCollectAllSelections();
    if (!selected.length) { bcShowPrintError('Список пуст. Добавьте номенклатуры или отметьте размеры.'); return; }
    if (summary) summary.innerHTML = '<div>⏳ Считаю этикетки по остаткам и уже созданным кодам…</div>';

    // группируем по номенклатуре -> charRefs
    const groups = {};
    for (const s of selected) {
        const vi = (barcodesState.variantInfo && barcodesState.variantInfo[s.variantId]) || {};
        if (!vi.productC1Ref || !vi.charRef) continue;
        (groups[vi.productC1Ref] = groups[vi.productC1Ref] || new Set()).add(vi.charRef);
    }
    const prods = Object.keys(groups);
    if (!prods.length) { if (summary) summary.innerHTML = '<div style="color:#c0392b;">Не удалось определить характеристики. Обновите остатки из 1С.</div>'; return; }

    let toPrint = 0, toGenerate = 0, errCount = 0;
    const perProd = [];
    for (const prod of prods) {
        const charRefs = Array.from(groups[prod]);
        try {
            const r = await fetch(`${BARCODE_SVC_URL}/api/smart-plan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Provision-Secret': BARCODE_SVC_SECRET },
                body: JSON.stringify({ nomenclature: prod, charRefs, dryRun: true })
            });
            const jr = await r.json();
            if (!r.ok || jr.ok === false) { errCount++; continue; }
            // на печать по размеру = min(balance, own+ours+other+toGenerate) — но не больше balance
            let prodPrint = 0, prodGen = 0;
            (jr.plan || []).forEach(p => {
                const willHave = p.own + p.ours + p.other + (p.toGenerate || 0);
                prodPrint += Math.min(p.balance, willHave);
                prodGen += (p.toGenerate || 0);
            });
            toPrint += prodPrint; toGenerate += prodGen;
            const nm = (barcodesState.printCart.find(c => c.c1Ref === prod) || {}).name || prod;
            perProd.push({ name: nm, print: prodPrint, gen: prodGen });
        } catch (e) { errCount++; }
    }

    if (summary) {
        const rows = perProd.map(p => `${escapeHtml(p.name)}: ${p.print} шт.${p.gen ? ` (+${p.gen} новых)` : ''}`).join(' | ');
        summary.innerHTML =
            `<div style="font-size:14px;">🧮 Потребуется этикеток: <b>${toPrint}</b>` +
            (toGenerate ? `, из них новых кодов сгенерируется: <b>${toGenerate}</b>` : ', все коды уже есть') + '.</div>' +
            (errCount ? `<div style="color:#c0392b;font-size:12px;">Не удалось посчитать ${errCount} позиц. (проверьте связь с 1С).</div>` : '') +
            `<div style="font-size:11px;color:var(--color-text-secondary);margin-top:4px;">По номенклатурам — ${rows}</div>`;
    }
}

// ── Генерация штрихкодов и печать ───────────────────────────────
async function generateAndPrint() {
    const err = document.getElementById('bcPrintError');
    const info = document.getElementById('bcPrintInfo');
    if (err) err.style.display = 'none';
    if (info) info.textContent = '';

    const selected = bcCollectAllSelections();
    if (!selected.length) { bcShowPrintError('Выберите хотя бы один размер (галочкой) или добавьте номенклатуры в список.'); return; }

    const mode = document.getElementById('bcQtyMode')?.value || 'stock';
    const manualQty = parseInt(document.getElementById('bcQty')?.value, 10);
    if (mode === 'manual' && (!manualQty || manualQty < 1)) {
        bcShowPrintError('Укажите количество этикеток на размер (≥ 1).'); return;
    }

    const { w, h } = bcGetLabelSize();

    // Ручной режим оставляем как прежде (генерация по варианту до N), т.к. это
    // осознанное действие пользователя. Умный режим («по остатку») идёт через
    // серверный smart-plan: считает ПО РАЗМЕРУ ЦЕЛИКОМ и НИКОГДА не превышает остаток 1С.
    if (mode === 'manual') { return await generateAndPrintManual(selected, manualQty, w, h); }

    try {
        if (info) info.innerHTML = '<div>⏳ Считаю остатки и коды в 1С…</div>';

        // 1) группируем выбранные размеры по номенклатуре (productC1Ref) + charRefs
        const groups = {}; // productC1Ref -> Set(charRef)
        const selCharSet = new Set();
        for (const sel of selected) {
            const vInfo = (barcodesState.variantInfo && barcodesState.variantInfo[sel.variantId]) || {};
            const prod = vInfo.productC1Ref;
            const ch = vInfo.charRef;
            if (!prod || !ch) continue;
            if (!groups[prod]) groups[prod] = new Set();
            groups[prod].add(ch);
            selCharSet.add(ch);
        }
        const prods = Object.keys(groups);
        if (!prods.length) { bcShowPrintError('Не удалось определить номенклатуру/характеристику выбранных размеров. Обновите остатки из 1С.'); return; }

        // 2) генерация новых кодов (smart-plan) — ДЛЯ ВСЕХ КАТЕГОРИЙ.
        //    Если склад ВЫБРАН — передаём warehouseId: цель = остаток этого склада,
        //    коды генерируются на вариант именно этого склада (и не превышают остаток).
        //    Если склад НЕ выбран — прежнее поведение (по всем складам).
        const bcWhIdEarly = document.getElementById('bcWarehouse')?.value || '';
        let totGen = 0, totReg = 0, totSkip = 0, totBalance = 0, totExisting = 0;
        const planRows = [];
        const c1errAll = [];
        {
            for (const prod of prods) {
                const charRefs = Array.from(groups[prod]);
                const r = await fetch(`${BARCODE_SVC_URL}/api/smart-plan`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Provision-Secret': BARCODE_SVC_SECRET },
                    body: JSON.stringify({ nomenclature: prod, charRefs, dryRun: false, warehouseId: bcWhIdEarly || null })
                });
                const text = await r.text();
                let jr; try { jr = JSON.parse(text); } catch { jr = { ok: false, error: text.slice(0, 200) }; }
                if (!r.ok || jr.ok === false) {
                    c1errAll.push(`HTTP ${r.status}: ${jr.error || ''}`);
                    continue;
                }
                totGen += jr.totals?.generated || 0;
                totBalance += jr.totals?.balance || 0;
                totExisting += jr.totals?.existing || 0;
                totReg += jr.c1?.registered || 0;
                totSkip += jr.c1?.skipped || 0;
                if (Array.isArray(jr.c1?.errors)) c1errAll.push(...jr.c1.errors);
                (jr.plan || []).forEach(p => planRows.push(p));
            }
        }

        // 3) собираем экземпляры для ПЕЧАТИ.
        //    ЕСЛИ ВЫБРАН СКЛАД (#bcWarehouse) — печатаем ТОЛЬКО коды этого склада
        //    (варианты с warehouse_id = выбранный склад), без среза по общему остатку.
        //    ЕСЛИ СКЛАД НЕ ВЫБРАН — старое поведение: по всем складам характеристики,
        //    срез по остатку 1С.
        const bcWhId = document.getElementById('bcWarehouse')?.value || '';
        const printVariantIds = [];
        if (barcodesState.variantInfo) {
            for (const [vid, vi] of Object.entries(barcodesState.variantInfo)) {
                if (!vi || !vi.charRef || !selCharSet.has(vi.charRef)) continue;
                // если выбран склад — только варианты этого склада
                if (bcWhId && String(vi.warehouseId || '') !== String(bcWhId)) continue;
                printVariantIds.push(vid);
            }
        }
        // подстраховка: если индекс пуст, берём выбранные варианты
        //    (с учётом склада, если он выбран)
        let variantIdsForPrint = printVariantIds;
        if (!variantIdsForPrint.length) {
            variantIdsForPrint = selected
                .filter(s => {
                    if (!bcWhId) return true;
                    const vi = (barcodesState.variantInfo && barcodesState.variantInfo[s.variantId]) || {};
                    return String(vi.warehouseId || '') === String(bcWhId);
                })
                .map(s => s.variantId);
        }
        if (!variantIdsForPrint.length) { bcShowPrintError('На выбранном складе нет вариантов для этих размеров.'); return; }
        let unitsQuery = ortobotClient
            .from('stock_units')
            .select('*')
            .in('variant_id', variantIdsForPrint)
            .eq('status', 'in_stock')
            .order('seq', { ascending: true });
        // двойная подстраховка: если выбран склад — фильтр по warehouse_id самих кодов
        if (bcWhId) unitsQuery = unitsQuery.eq('warehouse_id', bcWhId);
        const { data: units, error: uErr } = await unitsQuery;
        if (uErr) throw uErr;

        // срез по остатку на каждый размер (charRef): печатаем не больше balance
        const balByChar = {};
        planRows.forEach(p => { balByChar[p.charRef] = p.balance; });
        const takenByChar = {};
        const allUnits = [];
        for (const u of (units || [])) {
            const vInfo = (barcodesState.variantInfo && barcodesState.variantInfo[u.variant_id]) || {};
            const ch = vInfo.charRef || u.c1_char_ref;
            const cap = (ch != null && balByChar[ch] != null) ? balByChar[ch] : Infinity;
            takenByChar[ch] = (takenByChar[ch] || 0);
            if (takenByChar[ch] >= cap) continue; // не печатаем больше остатка
            takenByChar[ch]++;
            allUnits.push(bcEnrichUnit(u));
        }
        if (!allUnits.length) { bcShowPrintError('Нет экземпляров для печати (проверьте остаток в 1С).'); return; }

        // 4) строка состояния
        let c1Line;
        if (totGen === 0) {
            c1Line = 'i Новых кодов не потребовалось — на все размеры кодов уже хватает (не больше остатка 1С).';
        } else if (c1errAll.length > 0) {
            c1Line = `⚠️ 1С: зарегистрировано ${totReg}, пропущено ${totSkip}, ошибки: ${c1errAll.slice(0, 2).join('; ')}`;
        } else {
            c1Line = `✅ 1С: отправлено ${totGen} новых код(ов) — зарегистрировано ${totReg}, уже было ${totSkip}`;
        }

        await bcEnsurePricesForUnits(allUnits);
        renderLabels(allUnits, w, h);

        if (info) {
            if (bcWhIdEarly) {
                // Режим «по складу»: только существующие коды выбранного склада
                const whName = (barcodesState.whById[bcWhIdEarly] || {}).name || 'выбранный склад';
                const byChar = {};
                allUnits.forEach(u => { const k = u.size_label || '?'; byChar[k] = (byChar[k] || 0) + 1; });
                const detail = Object.keys(byChar).sort((a, b) => a.localeCompare(b, 'ru'))
                    .map(k => `${escapeHtml(k)}: ${byChar[k]} шт.`).join(' | ');
                info.innerHTML =
                    `<div>На печать по складу <b>${escapeHtml(whName)}</b>: <b>${allUnits.length}</b> шт. — только существующие коды этого склада, новые НЕ генерируются.</div>` +
                    `<div style="margin-top:4px;font-size:11px;color:var(--color-text-secondary);">По размерам — ${detail}</div>`;
            } else {
                const detail = planRows
                    .sort((a, b) => String(a.sizeLabel).localeCompare(String(b.sizeLabel), 'ru'))
                    .map(p => {
                        return `${escapeHtml(p.sizeLabel)}: остаток ${p.balance}, было кодов ${p.own + p.ours + p.other}${p.generated ? `, новых +${p.generated}` : ''}${p.cappedByBalance ? ' (ограничено остатком)' : ''}`;
                    }).join(' | ');
                info.innerHTML =
                    `<div>На печать: <b>${allUnits.length}</b> шт. — новых сгенерировано: <b>${totGen}</b>. Правило: кодов на размер не больше остатка 1С.</div>` +
                    `<div style="margin-top:4px;">${c1Line}</div>` +
                    `<div style="margin-top:4px;font-size:11px;color:var(--color-text-secondary);">По размерам — ${detail}</div>`;
            }
        }
        bcDoPrint(w, h);
        // успешно отправили на печать — очищаем список номенклатур
        if (barcodesState.printCart.length) { barcodesState.printCart = []; bcRenderCart(); }
    } catch (e) {
        console.error('smart-plan generate:', e);
        bcShowPrintError(bcMissingTableMsg(e));
    }
}

// ── Массовая печать по складу (пачками) ─────────────────────────
// Рабочий процесс:
//  1) выбираем склад в самой карточке (#bcBatchWarehouse) и размер пачки,
//  2) «Загрузить пачку» — берём следующие N ещё НЕ напечатанных (printed_at IS NULL)
//     in_stock экземпляров склада (без «Диагностика стоп»), при нехватке — догенерируем
//     коды до остатка 1С; строим таблицу-предпросмотр с чекбоксами, отсортированную
//     по номенклатуре, внутри — по размерам,
//  3) «Печать выбранных → PDF» — печатаем только отмеченные строки (можно одну),
//     помечаем их printed_at, они становятся зелёными и «уже использованы».
const bcBatchState = { units: [], whId: '', whName: '' };

// Натуральная сортировка размеров (S/M/L/XL, числа 35..46, «стандарт» в конец).
// ВНИМАНИЕ: имя специально отличается от глобального bcSizeSortKey (тот возвращает число).
function bcBatchSizeKey(size) {
    const s = String(size || '').toLowerCase().replace(/^размер:?\s*/, '').trim();
    const order = { xs: 1, s: 2, m: 3, l: 4, xl: 5, xxl: 6, xxxl: 7 };
    if (order[s]) return [1, order[s], s];
    const num = parseFloat(s.replace(',', '.'));
    if (!isNaN(num)) return [2, num, s];
    if (s === 'стандарт' || s === '' || s === '—') return [4, 0, s];
    return [3, 0, s]; // прочие строковые размеры — по алфавиту
}
// Ключ номенклатуры-модели: код номенклатуры + характеристика (цвет/модель) из 1С
function bcNomenKey(u) {
    return String(u.c1_prod_ref || u.productC1Ref || '') + '|' + String(u.c1_char_ref || u.charRef || '');
}
// Сортировка размеров внутри одной модели
function bcCmpSize(a, b) {
    const ka = bcBatchSizeKey(a.size_label), kb = bcBatchSizeKey(b.size_label);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    if (ka[0] === 2) return ka[1] - kb[1]; // числовые размеры
    return String(ka[2]).localeCompare(String(kb[2]), 'ru');
}
// Сортировка экземпляров: сначала по названию номенклатуры, потом по размеру
function bcSortUnits(units) {
    return units.slice().sort((a, b) => {
        const na = (a.name || '').toLowerCase();
        const nb = (b.name || '').toLowerCase();
        if (na !== nb) return na.localeCompare(nb, 'ru');
        return bcCmpSize(a, b);
    });
}
// Строгая упаковка пачки ЦЕЛЫМИ номенклатурами-моделями.
// Группируем по (код номенклатуры + характеристика), сортируем группы по имени+характеристике,
// внутри группы — по размеру. Добавляем целые группы пока не превысим batchSize
// (первая группа входит всегда, даже если одна больше лимита — чтобы модель не резалась).
function bcPackWholeNomenclatures(units, batchSize) {
    const groups = new Map(); // key -> { name, units: [] }
    for (const u of units) {
        const key = bcNomenKey(u);
        if (!groups.has(key)) groups.set(key, { key, name: u.name || '', units: [] });
        groups.get(key).units.push(u);
    }
    const arr = Array.from(groups.values());
    // сортировка групп: по имени номенклатуры, затем по ключу (характеристике) для стабильности
    arr.sort((g1, g2) => {
        const n1 = (g1.name || '').toLowerCase(), n2 = (g2.name || '').toLowerCase();
        if (n1 !== n2) return n1.localeCompare(n2, 'ru');
        return g1.key.localeCompare(g2.key);
    });
    // внутри каждой группы — размеры по порядку
    arr.forEach(g => g.units.sort(bcCmpSize));
    const packed = [];
    for (const g of arr) {
        if (packed.length === 0) { packed.push(...g.units); continue; } // первая всегда
        if (packed.length + g.units.length > batchSize) break;          // не режем модель
        packed.push(...g.units);
    }
    return packed;
}

// Шаг 1: загрузить пачку в предпросмотр
async function bcLoadBatchPreview() {
    const err = document.getElementById('bcPrintError');
    const info = document.getElementById('bcBatchInfo');
    if (err) err.style.display = 'none';

    const whId = document.getElementById('bcBatchWarehouse')?.value || '';
    if (!whId) { bcShowPrintError('Выберите склад в карточке массовой печати.'); return; }
    const batchSize = Math.max(1, parseInt(document.getElementById('bcBatchSize')?.value, 10) || 100);
    const whName = (barcodesState.whById[whId] || {}).name || 'склад';

    try {
        if (info) info.innerHTML = '⏳ Считаю доступные экземпляры…';

        // берём расширенный пул (больше batchSize), чтобы можно было упаковать ЦЕЛЫМИ номенклатурами
        const pool = Math.min(5000, Math.max(batchSize * 5, batchSize + 500));

        // 1) ненапечатанные in_stock на складе (без диагностики), сгруппировано по номенклатуре
        let ready = await bcFetchUnprintedUnits(whId, pool);

        // 2) если вообще мало кодов — догенерируем до остатка 1С
        let genMsg = '';
        if (ready.length < batchSize) {
            if (info) info.innerHTML = '⏳ Не хватает кодов — догенерирую до остатка 1С…';
            const gen = await bcTopUpWarehouseCodes(whId);
            genMsg = gen.generated > 0
                ? ` Догенерировано и зарегистрировано в 1С: ${gen.generated} код(ов).`
                : '';
            if (gen.errors && gen.errors.length) {
                genMsg += ` ⚠️ 1С-ошибки: ${gen.errors.slice(0, 2).join('; ')}`;
            }
            ready = await bcFetchUnprintedUnits(whId, pool);
        }

        // 3) обогащаем (id/printed_at проставляем вручную, т.к. bcEnrichUnit их не переносит)
        const enrichedPool = ready.map(r => {
            const e = bcEnrichUnit({ ...r });
            e.id = r.id;
            e.c1_prod_ref = r.c1_prod_ref || null;
            e.c1_char_ref = r.c1_char_ref || null;
            e.printed_at = r.printed_at || null;
            e.printed_doc = r.printed_doc || null;
            return e;
        });
        // 4) СТРОГО упаковываем пачку целыми номенклатурами-моделями
        const packed = bcPackWholeNomenclatures(enrichedPool, batchSize);
        bcBatchState.units = packed;
        bcBatchState.whId = whId;
        bcBatchState.whName = whName;

        const remaining = await bcCountUnprinted(whId);
        const nomenCount = new Set(packed.map(bcNomenKey)).size;
        if (info) {
            info.innerHTML =
                `Склад <b>${escapeHtml(whName)}</b>: загружено <b>${packed.length}</b> экземпляр(ов) из <b>${nomenCount}</b> модел(ей) в пачку (целыми номенклатурами).${genMsg}` +
                ` Всего ненапечатанных на складе: <b>${remaining}</b>.`;
        }
        bcRenderBatchPreview();
    } catch (e) {
        console.error('bcLoadBatchPreview:', e);
        bcShowPrintError(bcMissingTableMsg(e));
    }
}

// Рендер таблицы предпросмотра с чекбоксами (сгруппировано по номенклатуре)
function bcRenderBatchPreview() {
    const box = document.getElementById('bcBatchPreview');
    if (!box) return;
    const units = bcBatchState.units || [];
    if (!units.length) {
        box.innerHTML = '<p style="color:var(--color-text-secondary);">Нет экземпляров для печати на этом складе.</p>';
        return;
    }
    let lastKey = null;
    const rows = units.map((u, idx) => {
        const printed = !!u.printed_at;
        const rowStyle = printed ? 'background:#e8f7ec;' : '';
        // группируем визуально по модели (код+характеристика): имя показываем 1 раз
        const key = bcNomenKey(u);
        const newGroup = key !== lastKey;
        const nameCell = newGroup
            ? `<td style="font-weight:600;">${escapeHtml(u.name || '—')}</td>`
            : '<td style="color:var(--color-text-secondary);"></td>';
        const topBorder = (newGroup && idx > 0) ? 'border-top:2px solid var(--color-border,#d0d0d0);' : '';
        lastKey = key;
        // всегда рабочий чекбокс (даже у напечатанных) — можно перепечатать ту же пачку
        const chk = `<input type="checkbox" class="bc-batch-chk" data-idx="${idx}" checked onchange="bcUpdateBatchCount()">`;
        const usedBadge = printed
            ? ' <span style="font-size:11px;color:#1e8e3e;" title="Уже было в документе — можно печатать повторно">🖨️ в документе</span>'
            : '';
        return `<tr style="${rowStyle}${topBorder}">
            <td style="text-align:center;width:34px;">${chk}</td>
            ${nameCell}
            <td>${escapeHtml(u.size_label || '—')}</td>
            <td><code>${escapeHtml(u.unique_barcode || '')}</code>${usedBadge}</td>
        </tr>`;
    }).join('');

    box.innerHTML =
        `<div style="display:flex;align-items:center;gap:12px;margin:8px 0;flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">
                <input type="checkbox" id="bcBatchAll" checked onchange="bcBatchToggleAll(this.checked)"> Выбрать все
            </label>
            <span id="bcBatchSelCount" style="font-size:12px;color:var(--color-text-secondary);"></span>
            <button class="btn btn-primary" style="margin-left:auto;" onclick="bcPrintSelectedBatch()">🖨️ Печать выбранных → PDF</button>
        </div>
        <div style="max-height:420px;overflow:auto;border:1px solid var(--color-border,#e0e0e0);border-radius:6px;">
        <table class="bc-units-table" style="width:100%;">
            <thead><tr>
                <th style="width:34px;"></th><th>Товар</th><th>Размер</th><th>Штрихкод</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table></div>`;
    bcUpdateBatchCount();
}

// Мастер-чекбокс: отметить/снять все строки
function bcBatchToggleAll(checked) {
    document.querySelectorAll('.bc-batch-chk').forEach(c => { c.checked = checked; });
    bcUpdateBatchCount();
}
// Обновить счётчик выбранных
function bcUpdateBatchCount() {
    const chks = document.querySelectorAll('.bc-batch-chk');
    const sel = Array.from(chks).filter(c => c.checked).length;
    const el = document.getElementById('bcBatchSelCount');
    if (el) el.textContent = `Выбрано: ${sel} из ${chks.length}`;
    const all = document.getElementById('bcBatchAll');
    if (all) all.checked = (sel === chks.length && chks.length > 0);
}

// Шаг 2: печать только выбранных строк
async function bcPrintSelectedBatch() {
    const err = document.getElementById('bcPrintError');
    const info = document.getElementById('bcBatchInfo');
    if (err) err.style.display = 'none';
    const { w, h } = bcGetLabelSize();

    const chks = Array.from(document.querySelectorAll('.bc-batch-chk')).filter(c => c.checked);
    if (!chks.length) { bcShowPrintError('Отметьте хотя бы одну строку для печати.'); return; }
    const idxs = chks.map(c => parseInt(c.dataset.idx, 10));
    const units = idxs.map(i => bcBatchState.units[i]).filter(Boolean);
    const batchIds = units.map(u => u.id).filter(Boolean);

    try {
        // порядок уже правильный (целыми номенклатурами), берём как есть по возрастанию idx
        const ordered = idxs.slice().sort((a, b) => a - b).map(i => bcBatchState.units[i]).filter(Boolean);
        await bcEnsurePricesForUnits(ordered);
        renderLabels(ordered, w, h);

        // помечаем как напечатанные ДО диалога печати
        const docTag = 'BATCH-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '');
        const nowIso = new Date().toISOString();
        if (batchIds.length) {
            const { error: upErr } = await ortobotClient
                .from('stock_units')
                .update({ printed_at: nowIso, printed_doc: docTag })
                .in('id', batchIds);
            if (upErr) throw upErr;
            // отражаем в локальном состоянии → строки станут зелёными
            units.forEach(u => { u.printed_at = nowIso; u.printed_doc = docTag; });
        }

        const remaining = await bcCountUnprinted(bcBatchState.whId);
        if (info) {
            info.innerHTML =
                `<div>✅ Напечатано <b>${ordered.length}</b> этикет(ок) по складу <b>${escapeHtml(bcBatchState.whName)}</b> — в диалоге выберите «Сохранить как PDF».</div>` +
                `<div style="margin-top:4px;">Осталось ненапечатанных: <b>${remaining}</b>${remaining > 0 ? '.' : ' — всё напечатано. 🎉'}</div>`;
        }

        bcDoPrint(w, h);
        bcRenderBatchPreview(); // перерисуем — напечатанные строки станут зелёными и без чекбокса

        // если открыта вкладка «Экземпляры» — обновим и её
        try {
            const unitsTab = document.getElementById('bcUnitsTab');
            if (unitsTab && unitsTab.classList.contains('active') && typeof loadUnitsTable === 'function') {
                loadUnitsTable();
            }
        } catch (_) {}
    } catch (e) {
        console.error('bcPrintSelectedBatch:', e);
        bcShowPrintError(bcMissingTableMsg(e));
    }
}

// Следующая пачка ненапечатанных in_stock экземпляров склада (без «Диагностика стоп»)
async function bcFetchUnprintedUnits(whId, limit) {
    const { data, error } = await ortobotClient
        .from('stock_units')
        .select('*')
        .eq('warehouse_id', whId)
        .eq('status', 'in_stock')
        .is('printed_at', null)
        .neq('c1_prod_ref', BC_DIAGNOSTIC_C1_REF)
        .order('c1_prod_ref', { ascending: true })
        .order('c1_char_ref', { ascending: true })
        .order('created_at', { ascending: true })
        .order('seq', { ascending: true })
        .limit(limit);
    if (error) throw error;
    return data || [];
}

// Сколько всего ненапечатанных in_stock на складе (без диагностики)
async function bcCountUnprinted(whId) {
    const { count, error } = await ortobotClient
        .from('stock_units')
        .select('id', { count: 'exact', head: true })
        .eq('warehouse_id', whId)
        .eq('status', 'in_stock')
        .is('printed_at', null)
        .neq('c1_prod_ref', BC_DIAGNOSTIC_C1_REF);
    if (error) throw error;
    return count || 0;
}

// Догенерация кодов до остатка 1С для всех товаров склада (кроме «Диагностика стоп»).
async function bcTopUpWarehouseCodes(whId) {
    let generated = 0; const errors = [];
    const variantsOnWh = (barcodesState.variants || []).filter(v => String(v.warehouse_id || '') === String(whId) && (v.stock || 0) > 0);
    const nomByProduct = {}; // productId -> c1_ref
    for (const v of variantsOnWh) {
        const c1 = barcodesState.prodC1ById ? barcodesState.prodC1ById[v.product_id] : null;
        if (c1) nomByProduct[v.product_id] = c1;
    }
    // исключаем сервисные позиции (Диагностика стоп, Пронация) из догенерации
    const noms = [...new Set(Object.values(nomByProduct))].filter(ref => !BC_NO_GEN_REFS.has(ref));
    for (const nom of noms) {
        try {
            const r = await fetch(`${BARCODE_SVC_URL}/api/smart-plan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Provision-Secret': BARCODE_SVC_SECRET },
                body: JSON.stringify({ nomenclature: nom, dryRun: false, warehouseId: whId })
            });
            const text = await r.text();
            let jr; try { jr = JSON.parse(text); } catch { jr = { ok: false, error: text.slice(0, 200) }; }
            if (!r.ok || jr.ok === false) { errors.push(`${nom}: ${jr.error || ('HTTP ' + r.status)}`); continue; }
            generated += jr.totals?.generated || 0;
            if (Array.isArray(jr.c1?.errors)) errors.push(...jr.c1.errors);
        } catch (e) {
            errors.push(`${nom}: ${e.message || e}`);
        }
    }
    return { generated, errors };
}

// Кнопка «Посчитать остаток»: показать, сколько ненапечатанных на складе
async function bcRefreshBatchCounter() {
    const err = document.getElementById('bcPrintError');
    const info = document.getElementById('bcBatchInfo');
    if (err) err.style.display = 'none';
    const whId = document.getElementById('bcBatchWarehouse')?.value || '';
    if (!whId) { bcShowPrintError('Выберите склад в карточке массовой печати.'); return; }
    const whName = (barcodesState.whById[whId] || {}).name || 'склад';
    try {
        if (info) info.innerHTML = '⏳ Считаю…';
        const remaining = await bcCountUnprinted(whId);
        const { count: printedCount } = await ortobotClient
            .from('stock_units')
            .select('id', { count: 'exact', head: true })
            .eq('warehouse_id', whId)
            .eq('status', 'in_stock')
            .neq('c1_prod_ref', BC_DIAGNOSTIC_C1_REF)
            .not('printed_at', 'is', null);
        if (info) info.innerHTML =
            `Склад <b>${escapeHtml(whName)}</b>: ненапечатанных — <b>${remaining}</b>, уже напечатано — <b>${printedCount || 0}</b>.` +
            (remaining > 0 ? ' Нажмите «Загрузить пачку».' : ' Всё напечатано. 🎉');
    } catch (e) {
        console.error('bcRefreshBatchCounter:', e);
        bcShowPrintError(bcMissingTableMsg(e));
    }
}

// Ручной режим: генерирует до N этикеток на каждый выбранный вариант (как раньше),
// переиспользуя существующие. НЕ ограничивается остатком 1С (осознанный выбор).
async function generateAndPrintManual(selected, manualQty, w, h) {
    const info = document.getElementById('bcPrintInfo');
    try {
        const allUnits = [];
        const newBarcodes = [];
        const perSize = [];
        let reusedTotal = 0, createdTotal = 0;
        for (const sel of selected) {
            const vInfo = (barcodesState.variantInfo && barcodesState.variantInfo[sel.variantId]) || {};
            const sizeName = vInfo.size || sel.variantId;
            const { data: existing, error: exErr } = await ortobotClient
                .from('stock_units').select('*')
                .eq('variant_id', sel.variantId).eq('status', 'in_stock')
                .order('seq', { ascending: true });
            if (exErr) throw exErr;
            const have = existing || [];
            const reuse = have.slice(0, manualQty);
            reuse.forEach(u => allUnits.push(bcEnrichUnit(u)));
            reusedTotal += reuse.length;
            const missing = manualQty - reuse.length;
            let createdHere = 0;
            if (missing > 0) {
                const { data, error } = await ortobotClient.rpc('generate_stock_units', {
                    p_variant_id: sel.variantId, p_qty: missing, p_source_doc: 'SMART-GEN'
                });
                if (error) throw error;
                (data || []).forEach(u => { allUnits.push(bcEnrichUnit(u)); if (u.unique_barcode) newBarcodes.push(u.unique_barcode); });
                createdHere = (data || []).length; createdTotal += createdHere;
            }
            perSize.push({ size: sizeName, existed: have.length, created: createdHere });
        }
        if (!allUnits.length) { bcShowPrintError('Нет экземпляров для печати.'); return; }

        let c1Line = '';
        if (newBarcodes.length > 0) {
            try {
                const r = await fetch(`${BARCODE_SVC_URL}/api/register-existing`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Provision-Secret': BARCODE_SVC_SECRET },
                    body: JSON.stringify({ barcodes: newBarcodes, onlyUnsent: false })
                });
                const text = await r.text();
                let jr; try { jr = JSON.parse(text); } catch { jr = { raw: text }; }
                if (!r.ok || jr.ok === false) c1Line = `❌ 1С: ошибка HTTP ${r.status}${jr.error ? ' — ' + jr.error : ''}`;
                else {
                    const c1 = jr.c1 || {}; const reg = c1.registered ?? 0; const skip = c1.skipped ?? 0;
                    const errs = Array.isArray(c1.errors) ? c1.errors : [];
                    c1Line = errs.length > 0
                        ? `⚠️ 1С: записано ${reg}, пропущено ${skip}, ошибки: ${errs.slice(0,2).join('; ')}`
                        : `✅ 1С: отправлено ${jr.sentToC1 ?? newBarcodes.length} — зарегистрировано ${reg}, уже было ${skip}`;
                }
            } catch (e) { c1Line = `❌ 1С: сетевая ошибка — ${e.message}`; }
        } else c1Line = 'i Новых кодов нет — печать существующих.';

        await bcEnsurePricesForUnits(allUnits);
        renderLabels(allUnits, w, h);
        if (info) {
            const detail = perSize.map(s => `${escapeHtml(s.size)}: было ${s.existed}, новых +${s.created}`).join(' | ');
            info.innerHTML =
                `<div>⚙️ Ручной режим — На печать: <b>${allUnits.length}</b> шт., новых: <b>${createdTotal}</b>, было: <b>${reusedTotal}</b></div>` +
                `<div style="margin-top:4px;">${c1Line}</div>` +
                `<div style="margin-top:4px;font-size:11px;color:var(--color-text-secondary);">По размерам — ${detail}</div>`;
        }
        bcDoPrint(w, h);
    } catch (e) {
        console.error('generateAndPrintManual:', e);
        bcShowPrintError(bcMissingTableMsg(e));
    }
}

// Повторная печать уже сгенерированных экземпляров (status='in_stock')
async function reprintExisting() {
    const err = document.getElementById('bcPrintError');
    const info = document.getElementById('bcPrintInfo');
    if (err) err.style.display = 'none';
    if (info) info.textContent = '';

    const selected = bcCollectAllSelections();
    if (!selected.length) { bcShowPrintError('Выберите хотя бы один размер (галочкой) или добавьте номенклатуры в список.'); return; }

    const { w, h } = bcGetLabelSize();

    try {
        // расширяем до всех вариантов, делящих выбранные характеристики (код мог лечь на соседний вариант).
        //    НО: если выбран склад (#bcWarehouse) — только варианты этого склада.
        const reWhId = document.getElementById('bcWarehouse')?.value || '';
        const selCharSet = new Set();
        for (const s of selected) {
            const vi = (barcodesState.variantInfo && barcodesState.variantInfo[s.variantId]) || {};
            if (vi.charRef) selCharSet.add(vi.charRef);
        }
        let variantIds = selected.map(s => s.variantId);
        if (selCharSet.size && barcodesState.variantInfo) {
            const extra = [];
            for (const [vid, vi] of Object.entries(barcodesState.variantInfo)) {
                if (vi && vi.charRef && selCharSet.has(vi.charRef)) extra.push(vid);
            }
            if (extra.length) variantIds = Array.from(new Set([...variantIds, ...extra]));
        }
        // фильтр по складу: оставляем только варианты выбранного склада
        if (reWhId && barcodesState.variantInfo) {
            variantIds = variantIds.filter(vid => {
                const vi = barcodesState.variantInfo[vid] || {};
                return String(vi.warehouseId || '') === String(reWhId);
            });
        }
        if (!variantIds.length) { bcShowPrintError('На выбранном складе нет вариантов для этих размеров.'); return; }
        let unitQuery = ortobotClient
            .from('stock_units')
            .select('*')
            .in('variant_id', variantIds)
            .eq('status', 'in_stock');
        // двойная подстраховка: фильтр по warehouse_id самих кодов
        if (reWhId) unitQuery = unitQuery.eq('warehouse_id', reWhId);
        const { data, error } = await unitQuery;
        if (error) throw error;

        const units = (data || []).map(u => bcEnrichUnit(u));
        if (!units.length) {
            bcShowPrintError('Нет экземпляров со статусом «на складе» для выбранных размеров.');
            return;
        }

        await bcEnsurePricesForUnits(units);
        renderLabels(units, w, h);
        if (info) {
            const whTxt = reWhId ? ` по складу ${escapeHtml((barcodesState.whById[reWhId] || {}).name || '')}` : '';
            info.textContent = `Повторная печать${whTxt}: ${units.length} шт. (размеров: ${selected.length})`;
        }
        bcDoPrint(w, h);
    } catch (e) {
        console.error('reprintExisting:', e);
        bcShowPrintError(bcMissingTableMsg(e));
    }
}

// Тестовая печать — одна пробная этикетка. НЕ зависит от базы.
function testPrint() {
    const { w, h } = bcGetLabelSize();
    const unit = {
        unique_barcode: '2200000052308',
        size_label: 'размер:стандарт',
        name: '199 корректор для пятки',
        priceOld: 140, priceNew: 80, currency: 'TJS'
    };
    renderLabels([unit], w, h);
    bcDoPrint(w, h);
    const info = document.getElementById('bcPrintInfo');
    if (info) info.textContent = 'Отправлена тестовая этикетка на печать.';
}

// Дополнить строку экземпляра названием товара/размером + ценами из справочника
function bcEnrichUnit(u) {
    const info = u.variant_id != null ? barcodesState.variantInfo[u.variant_id] : null;
    const enriched = {
        unique_barcode: u.unique_barcode || u.barcode || '',
        size_label: u.size_label || (info && info.size) || '',
        name: u.name || (info && info.name) || '',
        warehouse_id: u.warehouse_id,
        status: u.status,
        created_at: u.created_at || u.received_at,
        charRef: (info && info.charRef) || u.c1_char_ref || null,
        productC1Ref: (info && info.productC1Ref) || null,
        priceOld: null, priceNew: null, currency: 'TJS'
    };
    // если цены уже загружены в кэш — проставляем
    bcApplyPriceToUnit(enriched);
    return enriched;
}

// Проставить цены на экземпляр.
// НОВАЯ (продажная) цена — текущая из 1С (последняя проведённая).
// СТАРАЯ (зачёркнутая, «до скидки») — берётся из Supabase (product_variants.price_old, задаётся вручную).
// Если price_old в Supabase не задана — падаем на старую цену из 1С (если была скидка).
function bcApplyPriceToUnit(u) {
    const cache = barcodesState.priceCache || {};
    const pc = u.productC1Ref ? cache[u.productC1Ref] : null;
    if (!pc) return;
    let pair = (u.charRef && pc.prices && pc.prices[u.charRef]) ? pc.prices[u.charRef] : null;
    if (!pair) pair = pc.productPrice || null;
    if (pair) {
        u.priceNew = (pair.new != null) ? pair.new : null;
        // Старая цена: приоритет — ручная price_old из Supabase по характеристике.
        const manualOld = (u.charRef && barcodesState.oldPriceByChar)
            ? barcodesState.oldPriceByChar[u.charRef] : null;
        if (manualOld != null && Number(manualOld) > 0) {
            u.priceOld = Number(manualOld);
        } else {
            u.priceOld = (pair.old != null) ? pair.old : null;
        }
        u.currency = pc.currency || 'TJS';
    }
}

// Загрузить цены товара из 1С (через сервис) и положить в кэш
async function bcFetchPrices(productC1Ref) {
    if (!productC1Ref) return null;
    if (!barcodesState.priceCache) barcodesState.priceCache = {};
    if (barcodesState.priceCache[productC1Ref]) return barcodesState.priceCache[productC1Ref];
    try {
        const res = await fetch(`${BARCODE_SVC_URL}/api/inventory?action=prices`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Provision-Secret': BARCODE_SVC_SECRET },
            body: JSON.stringify({ productC1Ref }),
            cache: 'no-store'
        });
        const data = await res.json();
        if (res.ok && data.ok) {
            barcodesState.priceCache[productC1Ref] = {
                productPrice: data.productPrice || null,
                prices: data.prices || {},
                currency: data.currency || 'TJS'
            };
            return barcodesState.priceCache[productC1Ref];
        }
    } catch (e) { console.warn('bcFetchPrices:', e); }
    return null;
}

// Загрузить цены для текущего выбранного товара и перепроставить на экземпляры
async function bcEnsurePricesForUnits(units) {
    const refs = [...new Set(units.map(u => u.productC1Ref).filter(Boolean))];
    for (const ref of refs) { await bcFetchPrices(ref); }
    // Подгружаем ручные старые цены (price_old) из Supabase по характеристикам этих экземпляров
    const chars = [...new Set(units.map(u => u.charRef).filter(Boolean))];
    await bcLoadOldPricesForChars(chars);
    units.forEach(u => bcApplyPriceToUnit(u));
}

// Загрузить price_old из Supabase по списку c1_char_ref → barcodesState.oldPriceByChar.
// price_old хранится на product_variants, а характеристика (c1_char_ref) — на stock_units,
// поэтому связываем через stock_units → variant_id → product_variants.price_old.
async function bcLoadOldPricesForChars(charRefs) {
    if (!barcodesState.oldPriceByChar) barcodesState.oldPriceByChar = {};
    const need = (charRefs || []).filter(ch => ch && !(ch in barcodesState.oldPriceByChar));
    if (!need.length) return;
    try {
        // stock_units: c1_char_ref → variant_id (берём по одной строке на характеристику)
        const { data: su } = await ortobotClient
            .from('stock_units')
            .select('c1_char_ref,variant_id')
            .in('c1_char_ref', need)
            .not('variant_id', 'is', null);
        const varByChar = {}; // char -> variant_id
        (su || []).forEach(r => { if (!varByChar[r.c1_char_ref]) varByChar[r.c1_char_ref] = r.variant_id; });
        const variantIds = [...new Set(Object.values(varByChar))];
        const oldByVariant = {};
        if (variantIds.length) {
            const { data: pv } = await ortobotClient
                .from('product_variants')
                .select('id,price_old')
                .in('id', variantIds);
            (pv || []).forEach(v => { oldByVariant[v.id] = (v.price_old != null ? Number(v.price_old) : null); });
        }
        // заполняем кэш (null тоже кэшируем, чтобы не запрашивать повторно)
        need.forEach(ch => {
            const vid = varByChar[ch];
            barcodesState.oldPriceByChar[ch] = (vid != null && oldByVariant[vid] != null) ? oldByVariant[vid] : null;
        });
    } catch (e) {
        console.warn('bcLoadOldPricesForChars:', e);
    }
}

function bcShowPrintError(msg) {
    const err = document.getElementById('bcPrintError');
    if (err) { err.textContent = msg; err.style.display = 'block'; }
}

// Понятное сообщение, если таблица/RPC ещё не созданы миграцией
function bcMissingTableMsg(e) {
    const m = (e && e.message ? e.message : String(e || '')).toLowerCase();
    if (m.includes('does not exist') || m.includes('not find') || m.includes('schema cache') ||
        m.includes('relation') || m.includes('function') || m.includes('404')) {
        return 'Таблица экземпляров ещё не создана — примените миграцию.';
    }
    return 'Ошибка: ' + (e && e.message ? e.message : 'неизвестная ошибка');
}

// ── Рендер этикеток ─────────────────────────────────────────────
// Формирует HTML этикеток в скрытом #labelPrintArea и рисует штрихкоды EAN13 (фоллбэк CODE128).
function renderLabels(units, w, h) {
    const area = document.getElementById('labelPrintArea');
    if (!area) return;

    // Высота штрихкода зависит от высоты этикетки (в px), с разумными границами
    const barHeight = Math.max(18, Math.min(60, Math.round(h * 0.9)));

    area.innerHTML = units.map((u, i) => {
        const code = escapeHtml(u.unique_barcode || '');
        const size = escapeHtml(u.size_label || '');
        const title = escapeHtml(u.name || '');
        const cur = escapeHtml(u.currency || 'TJS');
        // Блок цен: если есть старая (большая) — показываем обе (старая зачёркнута),
        // иначе — только новую (продажную).
        let priceBlock = '';
        if (u.priceNew != null && u.priceOld != null) {
            priceBlock =
                `<div class="label-price-old">Старая цена: <s>${u.priceOld} ${cur}</s></div>` +
                `<div class="label-price-new">Новая цена: <b>${u.priceNew} ${cur}</b></div>`;
        } else if (u.priceNew != null) {
            priceBlock = `<div class="label-price-new"><b>${u.priceNew} ${cur}</b></div>`;
        }
        return `<div class="label-tag" style="width:${w}mm;height:${h}mm;">
            <div class="label-title">${title}</div>
            <div class="label-size">${size}</div>
            ${priceBlock}
            <div class="label-barcode"><svg id="bcSvg${i}"></svg></div>
            <div class="label-code">${code}</div>
        </div>`;
    }).join('');

    // Рисуем штрихкоды: EAN13 для 13-значных цифровых, иначе фоллбэк CODE128
    units.forEach((u, i) => {
        const svg = document.getElementById('bcSvg' + i);
        if (!svg) return;
        const value = String(u.unique_barcode || '').trim();
        if (!value) return;
        // Наши штрихкоды — настоящие EAN13 (13 цифр, префикс 20). Старые/чужие — CODE128.
        const isEan13 = /^\d{13}$/.test(value);
        try {
            JsBarcode(svg, value, {
                format: isEan13 ? 'EAN13' : 'CODE128',
                displayValue: false,
                margin: 0,
                height: barHeight,
                width: isEan13 ? 2 : 1.4,
                flat: true
            });
        } catch (e) {
            // если EAN13 не прошёл валидацию (напр. контрольная цифра) — чертим CODE128
            try {
                JsBarcode(svg, value, { format: 'CODE128', displayValue: false, margin: 0, height: barHeight, width: 1.4 });
            } catch (e2) {
                console.error('JsBarcode:', e2);
            }
        }
    });
}

// Печать: инжектим @page нужного размера, показываем только область этикеток
function bcDoPrint(w, h) {
    let st = document.getElementById('labelPageStyle');
    if (!st) {
        st = document.createElement('style');
        st.id = 'labelPageStyle';
        document.head.appendChild(st);
    }
    st.textContent = `@media print { @page { size: ${w}mm ${h}mm; margin: 0; } }`;

    document.body.classList.add('printing-labels');
    const cleanup = () => {
        document.body.classList.remove('printing-labels');
        window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    // Фолбэк на случай, если событие afterprint не сработает
    setTimeout(cleanup, 1500);
}

// ── Таблица экземпляров (с пагинацией и фильтром по дате) ────────
const BC_UNITS_PAGE_SIZE = 100;
let bcUnitsPage = 0; // 0-based
// Услуга «Диагностика стоп» — не физический товар, скрываем из списка экземпляров
const BC_DIAGNOSTIC_C1_REF = '7aca2288-3ade-11f0-8313-c018500f4abe';
// «Пронация» — сервисная позиция, штрихкоды НЕ генерируем
const BC_PRONATION_C1_REF = '5ae9087f-9163-11ef-87a7-d8c0a681cbca';
// Номенклатуры, для которых НИКОГДА не генерируем штрихкоды (диагностика/услуги)
const BC_NO_GEN_REFS = new Set([BC_DIAGNOSTIC_C1_REF, BC_PRONATION_C1_REF]);

// Применить фильтры — сбрасывает на первую страницу
function bcUnitsApplyFilters() {
    bcUnitsPage = 0;
    loadUnitsTable();
}

function bcUnitsGoTo(page) {
    if (page < 0) return;
    bcUnitsPage = page;
    loadUnitsTable();
}

async function loadUnitsTable() {
    const listEl = document.getElementById('bcUnitsList');
    const errEl = document.getElementById('bcUnitsError');
    const pagerEl = document.getElementById('bcUnitsPager');
    if (!listEl) return;
    if (errEl) errEl.style.display = 'none';
    listEl.innerHTML = '<p style="color:var(--color-text-secondary);">Загрузка…</p>';
    if (pagerEl) pagerEl.innerHTML = '';

    const whId = document.getElementById('bcUnitsWarehouse')?.value || '';
    const status = document.getElementById('bcUnitsStatus')?.value || '';
    const dateFrom = document.getElementById('bcUnitsDateFrom')?.value || '';
    const dateTo = document.getElementById('bcUnitsDateTo')?.value || '';
    const sort = document.getElementById('bcUnitsSort')?.value || 'date_asc';
    const search = (document.getElementById('bcUnitsSearch')?.value || '').trim().toLowerCase();
    const category = document.getElementById('bcUnitsCategory')?.value || '';
    const sizeSearch = (document.getElementById('bcUnitsSizeSearch')?.value || '').trim();

    // Привязка Enter в полях поиска (однократно)
    const searchEl = document.getElementById('bcUnitsSearch');
    if (searchEl && !searchEl.dataset.bcBound) {
        searchEl.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); bcUnitsApplyFilters(); }
        });
        searchEl.dataset.bcBound = '1';
    }
    const sizeEl = document.getElementById('bcUnitsSizeSearch');
    if (sizeEl && !sizeEl.dataset.bcBound) {
        sizeEl.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); bcUnitsApplyFilters(); }
        });
        sizeEl.dataset.bcBound = '1';
    }
    const catEl = document.getElementById('bcUnitsCategory');
    if (catEl && !catEl.dataset.bcBound) {
        catEl.addEventListener('change', function () { bcUnitsApplyFilters(); });
        catEl.dataset.bcBound = '1';
    }

    const from = bcUnitsPage * BC_UNITS_PAGE_SIZE;
    const to = from + BC_UNITS_PAGE_SIZE - 1;

    try {
        // Поиск по номенклатуре: находим variant_id товаров, чьё название содержит запрос
        let searchVariantIds = null;
        if (search) {
            const info = barcodesState.variantInfo || {};
            searchVariantIds = Object.keys(info).filter(id => (info[id].name || '').toLowerCase().includes(search));
            if (searchVariantIds.length === 0) {
                listEl.innerHTML = '<p style="color:var(--color-text-secondary);">По запросу «' + escapeHtml(search) + '» товаров не найдено.</p>';
                return;
            }
        }

        // Фильтр по категории: список c1_ref товаров выбранной категории
        if (category) {
            const catMap = barcodesState.prodCategoryByC1Ref || {};
            const catRefs = Object.keys(catMap).filter(ref => catMap[ref] === category);
            if (catRefs.length === 0) {
                listEl.innerHTML = '<p style="color:var(--color-text-secondary);">В категории «' + escapeHtml(category) + '» товаров не найдено.</p>';
                return;
            }
            var categoryRefs = catRefs;
        }

        let q = ortobotClient.from('stock_units').select('*', { count: 'exact' });
        // Скрываем услугу «Диагностика стоп» (не физический товар)
        q = q.neq('c1_prod_ref', BC_DIAGNOSTIC_C1_REF);
        if (searchVariantIds) q = q.in('variant_id', searchVariantIds);
        if (typeof categoryRefs !== 'undefined') q = q.in('c1_prod_ref', categoryRefs);
        if (sizeSearch) q = q.ilike('size_label', '%' + sizeSearch + '%');
        if (whId) q = q.eq('warehouse_id', whId);
        if (status) q = q.eq('status', status);
        if (dateFrom) q = q.gte('created_at', dateFrom + 'T00:00:00');
        if (dateTo) q = q.lte('created_at', dateTo + 'T23:59:59');

        if (sort === 'date_desc') q = q.order('created_at', { ascending: false });
        else if (sort === 'barcode') q = q.order('unique_barcode', { ascending: true });
        else q = q.order('created_at', { ascending: true }); // date_asc — давно лежащие сверху

        q = q.range(from, to);
        const { data, error, count } = await q;
        if (error) throw error;

        const rows = data || [];
        const totalCount = (typeof count === 'number') ? count : rows.length;
        const totalPages = Math.max(1, Math.ceil(totalCount / BC_UNITS_PAGE_SIZE));

        if (!rows.length) {
            listEl.innerHTML = '<p style="color:var(--color-text-secondary);">Экземпляров не найдено по заданным фильтрам.</p>';
            return;
        }

        const statusLabel = { in_stock: 'На складе', sold: 'Продан', written_off: 'Списан' };
        const today = new Date();
        const body = rows.map(r => {
            const u = bcEnrichUnit(r);
            const bc = u.unique_barcode || '';
            const date = u.created_at ? String(u.created_at).slice(0, 10) : '—';
            // Сохраняем поля прихода/продажи для ленивого рендера истории
            barcodesState.unitRowData[bc] = {
                received_at: r.received_at || null,
                created_at: r.created_at || null,
                source_doc_1c: r.source_doc_1c || null,
                warehouse_id: r.warehouse_id,
                status: r.status || null,
                sold_at: r.sold_at || null,
                sold_seller: r.sold_seller || null,
                sold_shop: r.sold_shop || null,
                sold_receipt_1c: r.sold_receipt_1c || null
            };
            // сколько дней лежит
            let ageBadge = '';
            if (u.created_at) {
                const days = Math.floor((today - new Date(u.created_at)) / 86400000);
                const color = days >= 90 ? '#c0392b' : (days >= 30 ? '#e67e22' : 'var(--color-text-secondary)');
                ageBadge = ` <span style="font-size:11px;color:${color};">(${days} дн.)</span>`;
            }
            // напечатанные (в документе печати) — подсвечиваем зелёным
            const isPrinted = !!r.printed_at;
            const rowStyle = isPrinted ? 'cursor:pointer;background:#e8f7ec;' : 'cursor:pointer;';
            const printedBadge = isPrinted
                ? ` <span style="font-size:11px;color:#1e8e3e;" title="Напечатано ${escapeHtml(String(r.printed_at).slice(0, 16).replace('T', ' '))}">🖨️ в документе</span>`
                : '';
            return `<tr class="unit-row" data-barcode="${escapeHtml(bc)}" onclick="bcToggleHistory(this)" style="${rowStyle}">
                <td class="unit-toggle" style="width:24px;text-align:center;color:var(--color-text-secondary);">▸</td>
                <td><code>${escapeHtml(bc)}</code></td>
                <td>${escapeHtml(u.size_label)}</td>
                <td>${escapeHtml(u.name)}</td>
                <td>${escapeHtml(bcWhName(u.warehouse_id))}</td>
                <td>${escapeHtml(statusLabel[u.status] || u.status || '—')}${printedBadge}</td>
                <td>${escapeHtml(date)}${ageBadge}</td>
            </tr>
            <tr class="unit-history-row" style="display:none;">
                <td colspan="7" style="background:var(--color-bg-1,#f7f7f7);padding:10px 16px;">
                    <div class="unit-history-body"></div>
                </td>
            </tr>`;
        }).join('');

        listEl.innerHTML =
            `<table class="bc-units-table">
                <thead><tr>
                    <th></th><th>Штрихкод</th><th>Размер</th><th>Товар</th>
                    <th>Склад</th><th>Статус</th><th>Дата прихода</th>
                </tr></thead>
                <tbody>${body}</tbody>
            </table>`;

        // пагинация
        if (pagerEl) {
            const cur = bcUnitsPage;
            const firstIdx = from + 1;
            const lastIdx = from + rows.length;
            const disPrev = cur <= 0 ? 'disabled' : '';
            const disNext = cur >= totalPages - 1 ? 'disabled' : '';
            pagerEl.innerHTML = `
                <button class="btn btn-secondary" ${disPrev} onclick="bcUnitsGoTo(0)">‹‹ В начало</button>
                <button class="btn btn-secondary" ${disPrev} onclick="bcUnitsGoTo(${cur - 1})">‹ Назад</button>
                <span style="font-size:13px;color:var(--color-text-secondary);">Страница ${cur + 1} из ${totalPages} &nbsp;•&nbsp; ${firstIdx}–${lastIdx} из ${totalCount}</span>
                <button class="btn btn-secondary" ${disNext} onclick="bcUnitsGoTo(${cur + 1})">Вперёд ›</button>
                <button class="btn btn-secondary" ${disNext} onclick="bcUnitsGoTo(${totalPages - 1})">В конец ››</button>`;
        }
    } catch (e) {
        console.error('loadUnitsTable:', e);
        listEl.innerHTML = '';
        if (errEl) { errEl.textContent = bcMissingTableMsg(e); errEl.style.display = 'block'; }
    }
}

// ── История экземпляра (раскрываемый дропдаун) ──────────────────
// Формат даты для ленты истории: yyyy-mm-dd или «—»
function bcFmtHistDate(d) {
    return d ? String(d).slice(0, 10) : '—';
}

// Клик по строке экземпляра — раскрыть/свернуть ленту истории.
// Историю грузим лениво при первом раскрытии и кешируем.
function bcToggleHistory(rowEl) {
    const histRow = rowEl.nextElementSibling;
    if (!histRow || !histRow.classList.contains('unit-history-row')) return;
    const toggle = rowEl.querySelector('.unit-toggle');
    const hidden = histRow.style.display === 'none' || !histRow.style.display;
    if (hidden) {
        histRow.style.display = '';
        if (toggle) toggle.textContent = '▾';
        const bodyEl = histRow.querySelector('.unit-history-body');
        if (bodyEl && !bodyEl.dataset.loaded) {
            bcLoadUnitHistory(rowEl.dataset.barcode || '', bodyEl);
        }
    } else {
        histRow.style.display = 'none';
        if (toggle) toggle.textContent = '▸';
    }
}

// Ленивая загрузка истории по штрихкоду: перемещения + продажи.
async function bcLoadUnitHistory(barcode, bodyEl) {
    if (!barcode) { bodyEl.innerHTML = '<span style="color:var(--color-text-secondary);">Нет штрихкода.</span>'; return; }
    bodyEl.dataset.loaded = '1';
    bodyEl.innerHTML = '<span style="color:var(--color-text-secondary);">Загрузка истории…</span>';

    let movements, sales, returns;
    const cached = barcodesState.unitHistoryCache[barcode];
    if (cached) {
        movements = cached.movements;
        sales = cached.sales;
        returns = cached.returns || [];
    } else {
        try {
            const [mvRes, saleRes, retRes] = await Promise.all([
                // ВАЖНО: в stock_unit_movements нет created_at — сортируем по moved_at
                ortobotClient.from('stock_unit_movements').select('*')
                    .eq('unique_barcode', barcode).order('moved_at', { ascending: true }),
                ortobotClient.from('stock_unit_sales').select('*')
                    .eq('unique_barcode', barcode).order('sold_at', { ascending: true }),
                ortobotClient.from('stock_unit_returns').select('*')
                    .eq('unique_barcode', barcode).order('returned_at', { ascending: true })
            ]);
            if (mvRes.error) throw mvRes.error;
            if (saleRes.error) throw saleRes.error;
            // таблицы возвратов может не быть на старых базах — не роняем
            movements = mvRes.data || [];
            sales = saleRes.data || [];
            returns = (retRes && !retRes.error && retRes.data) ? retRes.data : [];
            barcodesState.unitHistoryCache[barcode] = { movements, sales, returns };
        } catch (e) {
            console.error('bcLoadUnitHistory:', e);
            bodyEl.dataset.loaded = ''; // разрешаем повторную попытку
            bodyEl.innerHTML = '<span style="color:#c0392b;">Не удалось загрузить историю: ' +
                escapeHtml(e && e.message ? e.message : '') + '</span>';
            return;
        }
    }

    bodyEl.innerHTML = bcRenderUnitHistory(barcode, movements, sales, returns);
}

// Сборка хронологической ленты жизни экземпляра
function bcRenderUnitHistory(barcode, movements, sales, returns) {
    const rd = barcodesState.unitRowData[barcode] || {};
    const items = [];

    // 📦 Приход (всегда первым): дата, склад прихода, документ
    const arrivalRaw = rd.received_at || rd.created_at || null;
    const arrivalWhId = (movements && movements.length) ? movements[0].from_warehouse_id : rd.warehouse_id;
    const arrivalWh = arrivalWhId != null ? bcWhName(arrivalWhId) : '';
    let arrivalText = 'приход';
    const parts = [];
    if (arrivalWh) parts.push('склад ' + escapeHtml(arrivalWh));
    if (rd.source_doc_1c) parts.push('док ' + escapeHtml(rd.source_doc_1c));
    if (parts.length) arrivalText = parts.join(', ');
    items.push({ icon: '📦', color: '#7f8c8d', sort: arrivalRaw ? new Date(arrivalRaw).getTime() : 0, first: true, date: bcFmtHistDate(arrivalRaw), text: arrivalText });

    // 🔄 Перемещения
    (movements || []).forEach(m => {
        const fromWh = m.from_warehouse_id != null ? bcWhName(m.from_warehouse_id) : '—';
        const toWh = m.to_warehouse_id != null ? bcWhName(m.to_warehouse_id) : '—';
        let t = escapeHtml(fromWh) + ' → ' + escapeHtml(toWh);
        if (m.doc_number) t += ', док №' + escapeHtml(m.doc_number);
        items.push({ icon: '🔄', color: '#2980b9', sort: m.moved_at ? new Date(m.moved_at).getTime() : 0, date: bcFmtHistDate(m.moved_at), text: t });
    });

    // 💰 Продажи (все из истории)
    (sales || []).forEach(sale => {
        const p = [];
        if (sale.seller_name) p.push('продал ' + escapeHtml(sale.seller_name));
        if (sale.shop_name) p.push('магазин ' + escapeHtml(sale.shop_name));
        if (sale.receipt_number) p.push('чек №' + escapeHtml(sale.receipt_number));
        items.push({ icon: '💰', color: '#27ae60', sort: sale.sold_at ? new Date(sale.sold_at).getTime() : 0, date: bcFmtHistDate(sale.sold_at), text: p.length ? p.join(', ') : 'продан' });
    });
    // Фоллбэк: продан, но записи продажи нет (старые данные)
    if (rd.status === 'sold' && (!sales || !sales.length)) {
        const p = [];
        if (rd.sold_seller) p.push('продал ' + escapeHtml(rd.sold_seller));
        if (rd.sold_shop) p.push('магазин ' + escapeHtml(rd.sold_shop));
        if (rd.sold_receipt_1c) p.push('чек №' + escapeHtml(rd.sold_receipt_1c));
        items.push({ icon: '💰', color: '#27ae60', sort: rd.sold_at ? new Date(rd.sold_at).getTime() : 0, date: bcFmtHistDate(rd.sold_at), text: p.length ? p.join(', ') : 'продан' });
    }

    // ↩️ Возвраты (все из истории)
    (returns || []).forEach(r => {
        const p = [];
        if (r.shop_name) p.push('магазин ' + escapeHtml(r.shop_name));
        if (r.receipt_number) p.push('чек №' + escapeHtml(r.receipt_number));
        const txt = 'возврат' + (p.length ? ' (' + p.join(', ') + ')' : '') + ' — возвращён на склад';
        items.push({ icon: '↩️', color: '#e67e22', sort: r.returned_at ? new Date(r.returned_at).getTime() : 0, date: bcFmtHistDate(r.returned_at), text: txt });
    });

    // сортировка: приход всегда первый, остальное по дате
    items.sort((a, b) => (a.first ? -1 : b.first ? 1 : (a.sort || 0) - (b.sort || 0)));

    return items.map(it =>
        `<div style="display:flex;align-items:flex-start;gap:8px;padding:3px 0;font-size:13px;line-height:1.4;">
            <span style="flex:0 0 auto;">${it.icon}</span>
            <span style="flex:0 0 auto;color:var(--color-text-secondary);min-width:90px;">${escapeHtml(it.date)}</span>
            <span style="color:${it.color};">${it.text}</span>
        </div>`
    ).join('');
}

// ── Ревизия (сканирование и сверка) ─────────────────────────────
function setupRevision() {
    const inp = document.getElementById('bcScanInput');
    if (inp && !inp.dataset.bcBound) {
        inp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const code = this.value.trim();
                if (code) {
                    barcodesState.scanned.add(code);
                    bcRenderScanned();
                }
                this.value = '';
            }
        });
        inp.dataset.bcBound = '1';
    }
    bcRenderScanned();
}

function bcRenderScanned() {
    const countEl = document.getElementById('bcScanCount');
    const listEl = document.getElementById('bcScanList');
    const arr = Array.from(barcodesState.scanned);
    if (countEl) countEl.textContent = `Отсканировано уникальных кодов: ${arr.length}`;
    if (listEl) {
        listEl.innerHTML = arr.length
            ? arr.map(c => `<div>${escapeHtml(c)}</div>`).join('')
            : '<em>пусто</em>';
    }
}

function revisionClear() {
    barcodesState.scanned.clear();
    bcRenderScanned();
    const res = document.getElementById('bcRevisionResult');
    if (res) res.innerHTML = '';
    const inp = document.getElementById('bcScanInput');
    if (inp) inp.focus();
}

// Сверка: сравнить отсканированные коды с числящимися in_stock на складе
async function revisionCompare() {
    const errEl = document.getElementById('bcRevisionError');
    const resEl = document.getElementById('bcRevisionResult');
    if (errEl) errEl.style.display = 'none';
    if (resEl) resEl.innerHTML = '';

    const whId = document.getElementById('bcRevWarehouse')?.value || '';
    if (!whId) {
        if (errEl) { errEl.textContent = 'Выберите склад для сверки.'; errEl.style.display = 'block'; }
        return;
    }

    try {
        const { data, error } = await ortobotClient
            .from('stock_units')
            .select('unique_barcode')
            .eq('warehouse_id', whId)
            .eq('status', 'in_stock');
        if (error) throw error;

        const inStock = new Set((data || []).map(r => String(r.unique_barcode || '').trim()).filter(Boolean));
        const scanned = barcodesState.scanned;

        // Недостача — числятся, но не отсканированы
        const missing = Array.from(inStock).filter(c => !scanned.has(c));
        // Лишние/чужие — отсканированы, но не числятся in_stock
        const extra = Array.from(scanned).filter(c => !inStock.has(c));

        resEl.innerHTML =
            `<div class="bc-rev-block">
                <h4>Итог сверки по складу «${escapeHtml(bcWhName(whId))}»</h4>
                <div>Числится на складе: <b>${inStock.size}</b> · Отсканировано: <b>${scanned.size}</b></div>
            </div>
            <div class="bc-rev-block">
                <h4 class="bc-rev-miss">Недостача (числятся, но не отсканированы): ${missing.length}</h4>
                <ul class="bc-rev-list">${missing.map(c => `<li>${escapeHtml(c)}</li>`).join('') || '<li class="bc-rev-ok">нет</li>'}</ul>
            </div>
            <div class="bc-rev-block">
                <h4 class="bc-rev-extra">Лишние/чужие (отсканированы, но не числятся): ${extra.length}</h4>
                <ul class="bc-rev-list">${extra.map(c => `<li>${escapeHtml(c)}</li>`).join('') || '<li class="bc-rev-ok">нет</li>'}</ul>
            </div>`;
    } catch (e) {
        console.error('revisionCompare:', e);
        if (errEl) { errEl.textContent = bcMissingTableMsg(e); errEl.style.display = 'block'; }
    }
}

// ═══════════════════════════════════════════════════════════════════
// КАССИР: Распечатать ценник для витрины
// Отдельный минимальный сценарий: склад → товар (подсказки) → размер →
// список СУЩЕСТВУЮЩИХ штрихкодов → выбор кода → печать.
// НЕ генерирует и НЕ присваивает новые коды. Использует общие справочники
// из barcodesState (грузятся loadBarcodes) и общие функции печати.
// ═══════════════════════════════════════════════════════════════════
const cashierState = {
    inited: false,
    selectedProductId: null,
    selectedProductC1Ref: null,
    // Мультивыбор размеров: [{key,charRef,size,stock,checked,qty,mode,selectedBarcode,codes,loaded,loading}]
    sizes: []
};

async function loadCashier() {
    // Справочники товаров/складов те же, что в разделе «Штрихкоды».
    if (typeof loadBarcodes === 'function') { try { await loadBarcodes(); } catch (e) { console.warn(e); } }

    csFillWarehouses();
    csRestoreLabelSize();

    if (cashierState.inited) return;

    // Размер этикетки — дропдаун + custom
    const preset = document.getElementById('csLabelPreset');
    if (preset && !preset.dataset.csBound) {
        preset.addEventListener('change', function () { csToggleCustomSize(); csSaveLabelSize(); });
        preset.dataset.csBound = '1';
    }
    ['csLabelW', 'csLabelH'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.dataset.csBound) { el.addEventListener('change', csSaveLabelSize); el.dataset.csBound = '1'; }
    });

    // Поиск товара
    const searchEl = document.getElementById('csProductSearch');
    if (searchEl && !searchEl.dataset.csBound) {
        let t = null;
        searchEl.addEventListener('input', function () {
            clearTimeout(t);
            const q = this.value;
            t = setTimeout(() => csSearchProducts(q), 250);
        });
        searchEl.dataset.csBound = '1';
    }

    // Смена склада → перестроить размеры
    const wh = document.getElementById('csWarehouse');
    if (wh && !wh.dataset.csBound) {
        wh.addEventListener('change', function () {
            if (cashierState.selectedProductId) csSelectProduct(cashierState.selectedProductId);
        });
        wh.dataset.csBound = '1';
    }

    // Кнопки «Выбрать все размеры» / «Снять выбор»
    const selAll = document.getElementById('csSelectAllSizes');
    if (selAll && !selAll.dataset.csBound) {
        selAll.addEventListener('click', function () { csSelectAllSizes(true); });
        selAll.dataset.csBound = '1';
    }
    const clrAll = document.getElementById('csClearAllSizes');
    if (clrAll && !clrAll.dataset.csBound) {
        clrAll.addEventListener('click', function () { csSelectAllSizes(false); });
        clrAll.dataset.csBound = '1';
    }

    // Скрыть выпадашку при клике вне поля
    document.addEventListener('click', function (e) {
        const box = document.getElementById('csSearchResults');
        const inp = document.getElementById('csProductSearch');
        if (box && inp && !box.contains(e.target) && e.target !== inp) box.style.display = 'none';
    });

    cashierState.inited = true;
}

function csFillWarehouses() {
    const wh = document.getElementById('csWarehouse');
    if (!wh || !barcodesState || !barcodesState.warehouses) return;
    const opts = barcodesState.warehouses
        .map(w => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name || w.c1_code)}</option>`)
        .join('');
    wh.innerHTML = '<option value="">— выберите склад —</option>' + opts;
}

function csShowError(msg) {
    const err = document.getElementById('csError');
    if (err) { err.textContent = msg; err.style.display = 'block'; }
}
function csClearError() {
    const err = document.getElementById('csError');
    if (err) err.style.display = 'none';
}

// ── Размер этикетки ──────────────────────────────────────────────
function csToggleCustomSize() {
    const preset = document.getElementById('csLabelPreset');
    const custom = document.getElementById('csCustomSize');
    if (!preset || !custom) return;
    custom.style.display = preset.value === 'custom' ? '' : 'none';
}
function csGetLabelSize() {
    const preset = document.getElementById('csLabelPreset');
    const v = preset ? preset.value : '40x50';
    if (v === 'custom') {
        const w = parseInt(document.getElementById('csLabelW')?.value, 10) || 40;
        const h = parseInt(document.getElementById('csLabelH')?.value, 10) || 50;
        return { w, h };
    }
    const m = v.split('x');
    return { w: parseInt(m[0], 10) || 40, h: parseInt(m[1], 10) || 50 };
}
function csSaveLabelSize() {
    try {
        const preset = document.getElementById('csLabelPreset');
        localStorage.setItem('csLabelPreset', preset ? preset.value : '40x50');
        localStorage.setItem('csLabelW', document.getElementById('csLabelW')?.value || '40');
        localStorage.setItem('csLabelH', document.getElementById('csLabelH')?.value || '50');
    } catch (e) {}
}
function csRestoreLabelSize() {
    try {
        const preset = document.getElementById('csLabelPreset');
        const p = localStorage.getItem('csLabelPreset');
        if (preset && p) preset.value = p;
        const w = localStorage.getItem('csLabelW'); if (w) { const el = document.getElementById('csLabelW'); if (el) el.value = w; }
        const h = localStorage.getItem('csLabelH'); if (h) { const el = document.getElementById('csLabelH'); if (el) el.value = h; }
        csToggleCustomSize();
    } catch (e) {}
}

// ── Поиск товара (подсказки) ─────────────────────────────────────
function csEnsureSearchBox() {
    let box = document.getElementById('csSearchResults');
    if (!box) {
        const inp = document.getElementById('csProductSearch');
        box = document.createElement('div');
        box.id = 'csSearchResults';
        box.style.cssText = 'position:absolute;top:100%;left:0;right:0;z-index:60;background:#fff;' +
            'border:1px solid #ccc;border-radius:6px;max-height:260px;overflow-y:auto;' +
            'box-shadow:0 6px 18px rgba(0,0,0,.14);display:none;';
        inp.parentElement.style.position = 'relative';
        inp.parentElement.appendChild(box);
    }
    return box;
}
function csSearchProducts(query) {
    const box = csEnsureSearchBox();
    const q = String(query || '').trim().toLowerCase();
    if (q.length < 2) { box.style.display = 'none'; return; }
    const matches = (barcodesState.products || [])
        .filter(p => (p.name_ru || '').toLowerCase().includes(q))
        .slice(0, 30);
    if (!matches.length) {
        box.innerHTML = '<div style="padding:8px 10px;color:#888;">Ничего не найдено</div>';
        box.style.display = 'block';
        return;
    }
    box.innerHTML = matches.map(p =>
        `<div class="cs-search-item" data-pid="${escapeHtml(p.id)}" style="padding:8px 10px;cursor:pointer;border-bottom:1px solid #eee;">
            ${escapeHtml(p.name_ru)}${p.category ? ` <span style="color:#999;">· ${escapeHtml(p.category)}</span>` : ''}
        </div>`
    ).join('');
    box.style.display = 'block';
    box.querySelectorAll('.cs-search-item').forEach(item => {
        item.addEventListener('mouseenter', function () { this.style.background = '#f0f0f0'; });
        item.addEventListener('mouseleave', function () { this.style.background = ''; });
        item.addEventListener('click', function () { csSelectProduct(this.dataset.pid); box.style.display = 'none'; });
    });
}

// ── Выбор товара → список всех размеров (мультивыбор, каждый — блок с кодами) ─────
// cashierState.sizes: [{ key, charRef, size, stock, checked, qty, mode('all'|'one'), selectedBarcode, codes:[], loaded }]
async function csSelectProduct(pid) {
    csClearError();
    cashierState.selectedProductId = pid;
    cashierState.sizes = [];
    csUpdatePrintBtn();

    const prod = (barcodesState.products || []).find(p => String(p.id) === String(pid));
    cashierState.selectedProductC1Ref = prod ? (prod.c1_ref || null) : null;
    const inp = document.getElementById('csProductSearch');
    if (inp && prod) inp.value = prod.name_ru || '';

    const box = document.getElementById('csSizes');
    const toolbar = document.getElementById('csSizesToolbar');
    if (!box) return;
    const whId = document.getElementById('csWarehouse')?.value || '';

    let vs = (barcodesState.variants || []).filter(v => String(v.product_id) === String(pid));
    if (whId) vs = vs.filter(v => String(v.warehouse_id) === String(whId));
    vs = vs.filter(v => (v.stock || 0) > 0);

    // Схлопываем по характеристике (charRef) — один размер один раз
    const byChar = {};
    vs.forEach(v => {
        const key = v.c1_char_ref || ('sz:' + (v.size_label || ''));
        if (!byChar[key]) byChar[key] = { key, charRef: v.c1_char_ref || null, size: v.size_label || '(без размера)', stock: 0 };
        byChar[key].stock += (v.stock || 0);
    });
    let sizes = Object.values(byChar);
    sizes.sort((a, b) => {
        const ka = bcSizeSortKey(a.size), kb = bcSizeSortKey(b.size);
        if (ka !== kb) return ka - kb;
        return String(a.size).localeCompare(String(b.size));
    });

    if (!sizes.length) {
        if (toolbar) toolbar.style.display = 'none';
        box.innerHTML = '<div class="bc-variants-empty">Нет размеров с остатком' + (whId ? ' на этом складе' : '') + '.</div>';
        csUpdateSummary();
        return;
    }

    // Состояние по каждому размеру
    cashierState.sizes = sizes.map(s => ({
        key: s.key, charRef: s.charRef, size: s.size, stock: s.stock,
        checked: false, qty: 1, mode: 'all', selectedBarcode: null,
        codes: [], loaded: false, loading: false
    }));

    if (toolbar) toolbar.style.display = 'flex';
    csRenderSizes();
    csUpdateSummary();

    // Предзагружаем коды всех размеров в фоне (чтобы 'Выбрать все' сработало сразу)
    for (const st of cashierState.sizes) { csLoadSizeCodes(st); }
}

// Отрисовка всех блоков размеров
function csRenderSizes() {
    const box = document.getElementById('csSizes');
    if (!box) return;
    const sizes = cashierState.sizes || [];
    if (!sizes.length) { box.innerHTML = '<div class="bc-variants-empty">Нет размеров.</div>'; return; }
    box.innerHTML = sizes.map(st => csRenderSizeBlock(st)).join('');
    sizes.forEach(st => csBindSizeBlock(st));
}

// HTML одного блока размера
function csRenderSizeBlock(st) {
    const id = 'cssz_' + csSafeId(st.key);
    const codesCount = st.loaded ? st.codes.length : null;
    const countTxt = st.loading ? '…' : (codesCount == null ? '' : String(codesCount));
    const disabled = !st.checked ? 'opacity:.55;' : '';
    return `<div class="cs-size-block" data-key="${escapeHtml(st.key)}" style="border:1px solid #e3e3e3;border-radius:10px;padding:12px;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600;">
                <input type="checkbox" class="cs-sz-check" data-key="${escapeHtml(st.key)}" ${st.checked ? 'checked' : ''}>
                <span>Размер ${escapeHtml(st.size)}</span>
            </label>
            <span style="color:#999;font-size:12px;">остаток: ${st.stock}${countTxt !== '' ? ' · кодов: ' + countTxt : ''}</span>
        </div>
        <div class="cs-sz-body" data-key="${escapeHtml(st.key)}" style="margin-top:10px;${disabled}">
            <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:8px;">
                <label style="display:flex;align-items:center;gap:6px;">
                    <input type="radio" name="${id}_mode" class="cs-sz-mode" data-key="${escapeHtml(st.key)}" value="all" ${st.mode === 'all' ? 'checked' : ''} ${st.checked ? '' : 'disabled'}>
                    <span>Все коды по 1 этикетке</span>
                </label>
                <label style="display:flex;align-items:center;gap:6px;">
                    <input type="radio" name="${id}_mode" class="cs-sz-mode" data-key="${escapeHtml(st.key)}" value="one" ${st.mode === 'one' ? 'checked' : ''} ${st.checked ? '' : 'disabled'}>
                    <span>Выбранный код ×</span>
                </label>
                <input type="number" class="form-control cs-sz-qty" data-key="${escapeHtml(st.key)}" value="${st.qty}" min="1" max="999"
                    style="width:80px;" ${(st.checked && st.mode === 'one') ? '' : 'disabled'}>
            </div>
            <div class="cs-sz-codes" data-key="${escapeHtml(st.key)}" style="${st.mode === 'one' && st.checked ? '' : 'display:none;'}">
                ${csRenderSizeCodes(st)}
            </div>
        </div>
    </div>`;
}

// Список кодов внутри блока (для режима 'выбранный код')
function csRenderSizeCodes(st) {
    if (st.loading) return '<div class="bc-variants-empty">⏳ Загружаю штрихкоды…</div>';
    if (!st.loaded) return '<div class="bc-variants-empty">Коды не загружены.</div>';
    if (!st.codes.length) return '<div class="bc-variants-empty">Нет штрихкодов этого размера на складе.</div>';
    const nm = 'cscode_' + csSafeId(st.key);
    return st.codes.map((c, i) => {
        const t = csCodeType(c.barcode);
        const checked = (st.selectedBarcode ? String(st.selectedBarcode) === String(c.barcode) : i === 0) ? 'checked' : '';
        return `<label style="display:flex;align-items:center;gap:10px;padding:6px 8px;border:1px solid #eee;border-radius:8px;margin-bottom:5px;cursor:pointer;">
            <input type="radio" name="${nm}" class="cs-sz-code" data-key="${escapeHtml(st.key)}" value="${escapeHtml(String(c.barcode))}" ${checked}>
            <span style="font-family:monospace;font-size:14px;font-weight:600;">${escapeHtml(String(c.barcode))}</span>
            <span style="font-size:11px;color:${t.color};background:${t.color}18;padding:2px 7px;border-radius:10px;">${t.label}</span>
        </label>`;
    }).join('');
}

function csSafeId(k) { return String(k || '').replace(/[^a-zA-Z0-9]/g, ''); }

// Привязка обработчиков одного блока
function csBindSizeBlock(st) {
    const box = document.getElementById('csSizes');
    if (!box) return;
    const q = sel => box.querySelector(`${sel}[data-key="${cssEsc(st.key)}"]`);

    const chk = q('.cs-sz-check');
    if (chk) chk.addEventListener('change', function () {
        st.checked = this.checked;
        if (st.checked && st.mode === 'one' && !st.selectedBarcode && st.codes.length) st.selectedBarcode = st.codes[0].barcode;
        csRefreshSizeBlock(st);
        csUpdatePrintBtn(); csUpdateSummary();
    });

    box.querySelectorAll(`.cs-sz-mode[data-key="${cssEsc(st.key)}"]`).forEach(r => {
        r.addEventListener('change', function () {
            if (this.checked) st.mode = this.value;
            if (st.mode === 'one' && !st.selectedBarcode && st.codes.length) st.selectedBarcode = st.codes[0].barcode;
            csRefreshSizeBlock(st);
            csUpdatePrintBtn(); csUpdateSummary();
        });
    });

    const qty = q('.cs-sz-qty');
    if (qty) qty.addEventListener('input', function () {
        let n = parseInt(this.value, 10); if (!(n >= 1)) n = 1; if (n > 999) n = 999;
        st.qty = n; csUpdateSummary();
    });

    box.querySelectorAll(`.cs-sz-code[data-key="${cssEsc(st.key)}"]`).forEach(r => {
        r.addEventListener('change', function () {
            st.selectedBarcode = this.value; csUpdateSummary();
        });
    });
}

// Экранирование для CSS-селектора (ключ — guid или sz:XX)
function cssEsc(s) { return String(s || '').replace(/["\\]/g, '\\$&'); }

// Перерисовать один блок на месте (после смены состояния)
function csRefreshSizeBlock(st) {
    const box = document.getElementById('csSizes');
    if (!box) return;
    const el = box.querySelector(`.cs-size-block[data-key="${cssEsc(st.key)}"]`);
    if (!el) { csRenderSizes(); return; }
    el.outerHTML = csRenderSizeBlock(st);
    csBindSizeBlock(st);
}

// Загрузка кодов одного размера (из stock_units, фильтр по складу)
async function csLoadSizeCodes(st) {
    if (st.loaded || st.loading) return;
    st.loading = true;
    try {
        const pid = cashierState.selectedProductId;
        const whId = document.getElementById('csWarehouse')?.value || '';
        let vs = (barcodesState.variants || []).filter(v => String(v.product_id) === String(pid));
        if (st.charRef) vs = vs.filter(v => String(v.c1_char_ref || '') === String(st.charRef));
        else vs = vs.filter(v => String(v.size_label || '') === String(st.size));
        if (whId) vs = vs.filter(v => String(v.warehouse_id) === String(whId));
        const variantIds = vs.map(v => v.id).filter(Boolean);
        let codes = variantIds.length ? await csFetchCodes(variantIds) : [];
        codes.sort((a, b) => csCodeRank(a.barcode) - csCodeRank(b.barcode) || String(a.barcode).localeCompare(String(b.barcode)));
        st.codes = codes;
        if (!st.selectedBarcode && codes.length) st.selectedBarcode = codes[0].barcode;
    } catch (e) {
        console.error('csLoadSizeCodes:', e);
        st.codes = [];
    } finally {
        st.loading = false; st.loaded = true;
        csRefreshSizeBlock(st);
        csUpdateSummary();
    }
}

// Кнопки «Выбрать все» / «Снять»
function csSelectAllSizes(on) {
    (cashierState.sizes || []).forEach(st => {
        st.checked = !!on;
        if (on && st.mode === 'one' && !st.selectedBarcode && st.codes.length) st.selectedBarcode = st.codes[0].barcode;
    });
    csRenderSizes();
    csUpdatePrintBtn(); csUpdateSummary();
}

// Ранг для сортировки: родной размерный код — первым (его обычно печатают на витрину)
function csCodeRank(code) {
    const c = String(code || '');
    if (c.startsWith('2200000')) return 0;   // родной размерный
    if (c.startsWith('2000000')) return 1;   // наш индивидуальный
    return 2;                                 // заводской/прочий
}
function csCodeType(code) {
    const c = String(code || '');
    if (c.startsWith('2200000')) return { label: 'родной (размер)', color: '#0a7d28' };
    if (c.startsWith('2000000')) return { label: 'индивидуальный', color: '#8a6d00' };
    return { label: 'заводской', color: '#555' };
}

// Получить коды ИЗ SUPABASE (stock_units) по списку вариантов выбранного склада.
// Возвращает [{barcode, type, characteristic_ref}] — только status='in_stock'.
async function csFetchCodes(variantIds) {
    if (!variantIds || !variantIds.length) return [];
    const { data, error } = await ortobotClient
        .from('stock_units')
        .select('unique_barcode, c1_char_ref, status, variant_id')
        .in('variant_id', variantIds)
        .eq('status', 'in_stock')
        .limit(5000);
    if (error) throw new Error(error.message || 'ошибка чтения stock_units');
    return (data || []).map(r => ({
        barcode: r.unique_barcode,
        characteristic_ref: r.c1_char_ref,
        type: csCodeType(r.unique_barcode).label
    }));
}

// ── Сбор этикеток из выбранных размеров ──────────────────────────
// Режим 'all': каждый код размера по 1 этикетке. Режим 'one': выбранный код × qty.
// Возвращает [{ barcode, size, charRef }]
function csCollectLabels() {
    const out = [];
    (cashierState.sizes || []).forEach(st => {
        if (!st.checked) return;
        if (st.mode === 'all') {
            (st.codes || []).forEach(c => out.push({ barcode: c.barcode, size: st.size, charRef: st.charRef }));
        } else {
            const bc = st.selectedBarcode || (st.codes[0] && st.codes[0].barcode);
            if (!bc) return;
            const n = Math.max(1, parseInt(st.qty, 10) || 1);
            for (let i = 0; i < n; i++) out.push({ barcode: bc, size: st.size, charRef: st.charRef });
        }
    });
    return out;
}

// Кнопка печати: активна, если отмечен хотя бы один размер
function csUpdatePrintBtn() {
    const btn = document.getElementById('csPrintBtn');
    if (!btn) return;
    const any = (cashierState.sizes || []).some(st => st.checked);
    btn.disabled = !any;
}

// Сводка: сколько размеров и этикеток будет напечатано
function csUpdateSummary() {
    csUpdatePrintBtn();
    const el = document.getElementById('csPrintSummary');
    if (!el) return;
    const checked = (cashierState.sizes || []).filter(st => st.checked);
    if (!checked.length) { el.textContent = ''; return; }
    const labels = csCollectLabels().length;
    const stillLoading = checked.some(st => !st.loaded);
    el.textContent = `Выбрано размеров: ${checked.length} · этикеток к печати: ${labels}` + (stillLoading ? ' (загрузка кодов…)' : '');
}

// ── Печать всех выбранных размеров ───────────────────────────────
async function csPrint() {
    csClearError();
    const checked = (cashierState.sizes || []).filter(st => st.checked);
    if (!checked.length) { csShowError('Отметьте хотя бы один размер.'); return; }

    // Догружаем коды выбранных размеров, если ещё не загружены
    for (const st of checked) { if (!st.loaded) await csLoadSizeCodes(st); }

    const labels = csCollectLabels();
    if (!labels.length) { csShowError('Нет штрихкодов для печати по выбранным размерам.'); return; }

    const { w, h } = csGetLabelSize();
    const prod = (barcodesState.products || []).find(p => String(p.id) === String(cashierState.selectedProductId));
    const name = prod ? (prod.name_ru || '') : '';
    const productC1Ref = cashierState.selectedProductC1Ref;

    const units = labels.map(l => ({
        unique_barcode: l.barcode,
        size_label: l.size,
        name: name,
        charRef: l.charRef,
        productC1Ref: productC1Ref,
        priceOld: null, priceNew: null, currency: 'TJS'
    }));

    // Цены (один товар — один запрос, применяем по характеристике на каждый unit)
    try {
        if (productC1Ref && typeof bcFetchPrices === 'function') {
            await bcFetchPrices(productC1Ref);
            if (typeof bcApplyPriceToUnit === 'function') units.forEach(u => bcApplyPriceToUnit(u));
        }
    } catch (e) { console.warn('csPrint prices:', e); }

    renderLabels(units, w, h);
    bcDoPrint(w, h);
}

// ═══════════════════════════════════════════════════════════════
// АНОМАЛЬНЫЕ ПРОДАЖИ (двойное списание одного штрихкода)
// ═══════════════════════════════════════════════════════════════
async function loadAnomalies() {
    const wrap = document.getElementById('anomTableWrap');
    const errEl = document.getElementById('anomError');
    const cntEl = document.getElementById('anomCount');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    if (wrap) wrap.innerHTML = '<div style="color:var(--color-text-secondary);font-size:13px;">⏳ Загружаю…</div>';
    const showResolved = !!(document.getElementById('anomShowResolved') && document.getElementById('anomShowResolved').checked);
    try {
        const res = await fetch(`${BARCODE_SVC_URL}/api/inventory?action=anomalous-sales&resolved=${showResolved}`, {
            method: 'GET',
            headers: { 'X-Provision-Secret': BARCODE_SVC_SECRET },
            cache: 'no-store'
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        renderAnomalies(data.rows || []);
        updateAnomaliesBadge(data.unresolved || 0);
        if (cntEl) cntEl.textContent = `Неразобранных: ${data.unresolved || 0}`;
    } catch (e) {
        if (wrap) wrap.innerHTML = '';
        if (errEl) { errEl.style.display = 'block'; errEl.textContent = '❌ Не удалось загрузить: ' + e.message; }
    }
}

function updateAnomaliesBadge(n) {
    const b = document.getElementById('anomaliesBadge');
    if (!b) return;
    if (n > 0) { b.textContent = n; b.style.display = 'inline-block'; }
    else { b.style.display = 'none'; }
}

function renderAnomalies(rows) {
    const wrap = document.getElementById('anomTableWrap');
    if (!wrap) return;
    if (!rows.length) {
        wrap.innerHTML = '<div style="color:var(--color-text-secondary);font-size:13px;padding:12px 0;">✅ Аномальных продаж нет.</div>';
        return;
    }
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const fmt = (d) => d ? new Date(d).toLocaleString('ru-RU') : '—';
    let html = '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    html += '<thead><tr style="text-align:left;border-bottom:2px solid var(--color-border, #ddd);">'
        + '<th style="padding:8px;">Штрихкод</th>'
        + '<th style="padding:8px;">Размер</th>'
        + '<th style="padding:8px;">Магазин (чек)</th>'
        + '<th style="padding:8px;">Продавец</th>'
        + '<th style="padding:8px;">Чек №</th>'
        + '<th style="padding:8px;">Дата продажи</th>'
        + '<th style="padding:8px;">Уже был продан</th>'
        + '<th style="padding:8px;"></th>'
        + '</tr></thead><tbody>';
    for (const r of rows) {
        const prev = r.existing_status === 'sold'
            ? `${esc(r.existing_shop || '—')} · ${fmt(r.existing_sold_at)}`
            : esc(r.existing_status || '—');
        const rowStyle = r.resolved ? 'opacity:0.55;' : '';
        const btn = r.resolved
            ? `<button class="btn btn-secondary" style="padding:4px 10px;font-size:12px;" onclick="resolveAnomaly('${r.id}', false)">Вернуть</button>`
            : `<button class="btn btn-primary" style="padding:4px 10px;font-size:12px;" onclick="resolveAnomaly('${r.id}', true)">Разобрано</button>`;
        html += `<tr style="border-bottom:1px solid var(--color-border, #eee);${rowStyle}">`
            + `<td style="padding:8px;font-family:monospace;font-weight:600;">${esc(r.unique_barcode)}</td>`
            + `<td style="padding:8px;">${esc(r.size_label || '—')}</td>`
            + `<td style="padding:8px;">${esc(r.shop_name || '—')}</td>`
            + `<td style="padding:8px;">${esc(r.seller_name || '—')}</td>`
            + `<td style="padding:8px;">${esc(r.receipt_number || '—')}</td>`
            + `<td style="padding:8px;">${fmt(r.sold_at)}</td>`
            + `<td style="padding:8px;color:var(--color-text-secondary);">${prev}</td>`
            + `<td style="padding:8px;text-align:right;">${btn}</td>`
            + '</tr>';
        if (r.note) {
            html += `<tr style="${rowStyle}"><td colspan="8" style="padding:2px 8px 8px;color:var(--color-text-secondary);font-size:12px;">📝 ${esc(r.note)}</td></tr>`;
        }
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
}

async function resolveAnomaly(id, resolved) {
    try {
        const res = await fetch(`${BARCODE_SVC_URL}/api/inventory?action=anomalous-resolve`, {
            method: 'POST',
            headers: { 'X-Provision-Secret': BARCODE_SVC_SECRET, 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, resolved })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        loadAnomalies();
    } catch (e) {
        alert('Не удалось изменить статус: ' + e.message);
    }
}

// ═══════════════════════════════════════════════════════════════
// ПОЧИНКА РАССИНХРОНА variant_id (после перемещений)
// ═══════════════════════════════════════════════════════════════
async function scanVariantSync() {
    const errEl = document.getElementById('varSyncError');
    const resEl = document.getElementById('varSyncResult');
    const fixBtn = document.getElementById('btnFixVariantSync');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    if (fixBtn) fixBtn.style.display = 'none';
    if (resEl) resEl.innerHTML = '<div style="color:var(--color-text-secondary);font-size:13px;">⏳ Проверяю базу…</div>';
    try {
        const res = await fetch(`${BARCODE_SVC_URL}/api/inventory?action=variant-sync`, {
            method: 'GET',
            headers: { 'X-Provision-Secret': BARCODE_SVC_SECRET },
            cache: 'no-store'
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        renderVariantSync(data);
    } catch (e) {
        if (resEl) resEl.innerHTML = '';
        if (errEl) { errEl.style.display = 'block'; errEl.textContent = '❌ Не удалось проверить: ' + e.message; }
    }
}

function renderVariantSync(data) {
    const resEl = document.getElementById('varSyncResult');
    const fixBtn = document.getElementById('btnFixVariantSync');
    if (!resEl) return;
    const groups = data.groups || [];
    if (!data.total) {
        resEl.innerHTML = '<div style="color:#16a34a;font-size:13px;font-weight:600;padding:8px 0;">✅ Рассинхрона нет — все штрихкоды привязаны к своим складам.</div>';
        if (fixBtn) fixBtn.style.display = 'none';
        return;
    }
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    let html = `<div style="font-weight:600;margin-bottom:8px;">Найдено экземпляров с рассинхроном: ${data.total} (в ${groups.length} позициях)</div>`;
    html += '<div style="max-height:320px;overflow-y:auto;border:1px solid var(--color-border,#eee);border-radius:8px;">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12.5px;">';
    html += '<thead><tr style="text-align:left;position:sticky;top:0;background:var(--color-bg,#fff);">'
        + '<th style="padding:6px 8px;">Товар</th><th style="padding:6px 8px;">Размер</th>'
        + '<th style="padding:6px 8px;">Склад (факт)</th><th style="padding:6px 8px;">Сейчас привязан к</th>'
        + '<th style="padding:6px 8px;text-align:right;">Шт.</th></tr></thead><tbody>';
    for (const g of groups) {
        html += '<tr style="border-top:1px solid var(--color-border,#f0f0f0);">'
            + `<td style="padding:6px 8px;">${esc(g.product_name)}</td>`
            + `<td style="padding:6px 8px;">${esc(g.size_label)}</td>`
            + `<td style="padding:6px 8px;color:#16a34a;">${esc(g.su_warehouse_name)}</td>`
            + `<td style="padding:6px 8px;color:#e11d48;">${esc(g.variant_warehouse_name)}</td>`
            + `<td style="padding:6px 8px;text-align:right;font-weight:600;">${g.count}</td></tr>`;
    }
    html += '</tbody></table></div>';
    resEl.innerHTML = html;
    if (fixBtn) { fixBtn.style.display = 'inline-block'; fixBtn.textContent = `✅ Исправить всё (${data.total})`; }
}

async function applyVariantSync() {
    if (!confirm('Перепривязать штрихкоды к их фактическим складам? Сами коды не меняются.')) return;
    const errEl = document.getElementById('varSyncError');
    const resEl = document.getElementById('varSyncResult');
    const fixBtn = document.getElementById('btnFixVariantSync');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    if (fixBtn) { fixBtn.disabled = true; fixBtn.textContent = '⏳ Исправляю…'; }
    try {
        const res = await fetch(`${BARCODE_SVC_URL}/api/inventory?action=variant-sync`, {
            method: 'POST',
            headers: { 'X-Provision-Secret': BARCODE_SVC_SECRET, 'Content-Type': 'application/json' },
            body: JSON.stringify({ apply: true })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (resEl) resEl.innerHTML = `<div style="color:#16a34a;font-size:13px;font-weight:600;padding:8px 0;">✅ Исправлено экземпляров: ${data.fixed}. Обновите ценник для витрины (Ctrl+F5).</div>`;
        if (fixBtn) fixBtn.style.display = 'none';
    } catch (e) {
        if (errEl) { errEl.style.display = 'block'; errEl.textContent = '❌ Не удалось исправить: ' + e.message; }
    } finally {
        if (fixBtn) { fixBtn.disabled = false; }
    }
}


// ═══════════════════════════════════════════════════════════════════════
// КАССА / РМК  (этап 1: вход до области продаж)
//   Поток: выбор кассы → подтверждение → открытие смены → выбор продавца
//          → область регистрации продаж (сканер: mobile-камера / desktop-сканер)
// ═══════════════════════════════════════════════════════════════════════
const POS = {
    loaded: false,
    kassas: [],
    sellers: [],
    chosen: null,      // выбранная касса {ref,name,shopRef,shopName,...}
    shift: null,       // открытая смена из Supabase
    isMobile: null,    // определяется при инициализации
    scanBuffer: '',    // буфер аппаратного сканера (desktop)
    scanTimer: null,
    html5qr: null,     // экземпляр html5-qrcode
    camOn: false,
    keyHandler: null,
    // ── ЭТАП 2: чек ──
    cart: [],          // позиции: {key,barcode,uniqueBarcode,scans[],name,sizeLabel,price,qty,discountPct,productC1Ref,charC1Ref,warehouseC1Ref,kind,availableAtShop,status}
    activeKey: null,   // последняя отсканированная/выбранная позиция
    doctor: null,      // {c1_ref,full_name,card_code}
    client: null,      // {c1_ref,full_name,card_code,discount_pct}
    cartDiscountPct: 0,// ручная «5% на чек» (не считая клиентской карты)
    paytypes: null,    // {cash:[...],cards:[...],terminals:[...],defaultTerminal}
    payMode: 'cash',
    keySeq: 1,
    docTypeSearchT: null,
    busy: false,
    // ── мобильный UI кассира (#posMobile) ──
    mobScreen: 'cart',      // 'cart' | 'pay' | 'more' | 'card' | 'return' | 'retitem' | 'retdone' | 'search'
    mobDesktopView: false,  // кассир вручную переключился на классический вид
    mobFacing: 'environment',
    mobTorch: false,
    mobScanBusy: false,
    mobToastTimer: null,
    mobCamMode: 'cart',     // что сканируем: 'cart' | 'return' | 'card'
    mobStep3Disp: null,     // сохранённый inline-display ПК-РМК, чтобы вернуть его как было
    mobCardCode: null,      // отсканированный штрихкод дисконтной карты
    mobWhById: null,        // склады ОРТОБОТ для экрана поиска: id -> {name, c1_code}
    mobSearchT: null,       // debounce подсказок поиска
    mobSearchSeq: 0,        // защита от гонки ответов подсказок
};

// Целочисленные суммы (сомоны без копеек) — форматирование
function posMoney(n) {
    return Math.round(Number(n) || 0).toLocaleString('ru-RU');
}

function posDetectMobile() {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const ua = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
    const narrow = window.innerWidth <= 820;
    return (coarse && narrow) || (ua && narrow);
}

function posError(msg) {
    const el = document.getElementById('posError');
    if (!el) return;
    if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
    el.style.display = 'block';
    el.textContent = '⚠️ ' + msg;
}

function posShowStep(n) {
    [1, 2, 3].forEach(i => {
        const s = document.getElementById('posStep' + i);
        if (s) s.style.display = (i === n) ? '' : 'none';
    });
    // На телефоне область продаж рисует мобильный оверлей (#posMobile) вместо #posStep3.
    if (typeof pmobApply === 'function') pmobApply();
}

async function posApi(path, opts) {
    const res = await fetch(`${BARCODE_SVC_URL}/api/pos${path}`, {
        ...(opts || {}),
        headers: {
            'Content-Type': 'application/json',
            'X-Provision-Secret': BARCODE_SVC_SECRET,
            ...((opts && opts.headers) || {}),
        },
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
}

// posApi с таймаутом: при слабой сети не висим бесконечно, а бросаем ошибку → в очередь.
async function posApiTimeout(path, opts, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 12000);
    try {
        return await posApi(path, { ...(opts || {}), signal: ctrl.signal });
    } finally { clearTimeout(t); }
}

// ============================================================
//  ОФЛАЙН-ОЧЕРЕДЬ РМК (IndexedDB)
//  Онлайн-first: чек всегда сначала шлётся в сеть. Если сети нет/таймаут —
//  чек ложится в очередь на телефоне и досылается, когда связь вернётся.
// ============================================================
const PosQueue = (() => {
    const DB = 'orto_pos_queue', STORE = 'ops', VER = 1;
    let _db = null;
    function open() {
        if (_db) return Promise.resolve(_db);
        return new Promise((resolve, reject) => {
            const rq = indexedDB.open(DB, VER);
            rq.onupgradeneeded = () => {
                const db = rq.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE, { keyPath: 'clientSaleId' });
                }
            };
            rq.onsuccess = () => { _db = rq.result; resolve(_db); };
            rq.onerror = () => reject(rq.error);
        });
    }
    function tx(mode) { return open().then(db => db.transaction(STORE, mode).objectStore(STORE)); }
    return {
        // добавить операцию (продажа/возврат) в очередь
        async add(op) {
            const st = await tx('readwrite');
            return new Promise((res, rej) => {
                const r = st.put(op); r.onsuccess = () => res(op); r.onerror = () => rej(r.error);
            });
        },
        async all() {
            const st = await tx('readonly');
            return new Promise((res, rej) => {
                const r = st.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
            });
        },
        async remove(clientSaleId) {
            const st = await tx('readwrite');
            return new Promise((res, rej) => {
                const r = st.delete(clientSaleId); r.onsuccess = () => res(); r.onerror = () => rej(r.error);
            });
        },
        async count() { return (await this.all()).length; },
    };
})();

// Генератор уникального id чека (до отправки) — основа идемпотентности.
function posNewClientSaleId() {
    const rnd = (crypto && crypto.randomUUID) ? crypto.randomUUID()
        : (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
    return 'cs-' + rnd;
}

// Ошибка сети (не ответ сервера, а именно невозможность достучаться)?
function posIsNetworkError(e) {
    if (!e) return false;
    if (e.name === 'AbortError') return true;                    // таймаут
    if (e instanceof TypeError) return true;                     // fetch failed (нет сети)
    return /failed to fetch|networkerror|network request failed|load failed/i.test(String(e.message || ''));
}

// Сколько экземпляров/количества уже стоит в очереди по варианту/штрихкоду —
// чтобы офлайн не продать один экземпляр дважды (контроль остатка офлайн).
async function posQueuedReserved() {
    const ops = await PosQueue.all();
    const byBarcode = new Set();   // экземплярные штрихкоды, уже «проданные» офлайн
    const byChar = {};             // charC1Ref -> кол-во группового товара в очереди
    for (const op of ops) {
        if (op.action !== 'sell') continue;
        for (const it of (op.body.items || [])) {
            const codes = (Array.isArray(it.uniqueBarcodes) && it.uniqueBarcodes.length)
                ? it.uniqueBarcodes : (it.uniqueBarcode ? [it.uniqueBarcode] : []);
            if (codes.length) { codes.forEach(c => byBarcode.add(String(c))); }
            else if (it.charC1Ref) { byChar[it.charC1Ref] = (byChar[it.charC1Ref] || 0) + (Number(it.qty) || 1); }
        }
    }
    return { byBarcode, byChar };
}

// Авто-досылка очереди (последовательно, по порядку).
let _posFlushing = false;
async function posFlushQueue() {
    if (_posFlushing) return;
    if (!navigator.onLine) { posUpdateConnUI(); return; }
    _posFlushing = true;
    try {
        const ops = (await PosQueue.all()).sort((a, b) => (a.ts || 0) - (b.ts || 0));
        for (const op of ops) {
            try {
                const r = await posApiTimeout(`?action=${op.action}`, {
                    method: 'POST', body: JSON.stringify(op.body),
                }, 20000);
                if (r.ok && r.data && r.data.ok) {
                    // успех (вкл. duplicate:true — чек уже проведён) → убираем из очереди
                    await PosQueue.remove(op.clientSaleId);
                } else if (r.status >= 400 && r.status < 500 && !posIsNetworkError(null)) {
                    // Сервер отклонил по сути (напр. товар уже продан на другой кассе).
                    // Не зацикливаемся: помечаем как ошибочный и оставляем для ручного разбора.
                    op.error = (r.data && r.data.error) || ('HTTP ' + r.status);
                    op.failed = true;
                    await PosQueue.add(op);
                }
                // если 5xx или сеть отвалилась — оставляем в очереди, повторим позже
            } catch (e) {
                if (posIsNetworkError(e)) break;   // сеть снова пропала — останавливаемся
            }
        }
    } finally {
        _posFlushing = false;
        posUpdateConnUI();
    }
}

// Индикатор связи + счётчик очереди в шапке РМК.
async function posUpdateConnUI() {
    const el = document.getElementById('posTopStatus');
    if (!el) return;
    let n = 0;
    try { n = await PosQueue.count(); } catch (_) {}
    const online = navigator.onLine;
    let html = online
        ? '<span style="color:#437A22;">\u25cf Онлайн</span>'
        : '<span style="color:#b45309;">\u25cf Офлайн</span>';
    if (n > 0) {
        html += ` <span style="color:#b45309;font-weight:700;">\u2022 Записей к отправке: ${n}</span>`;
    }
    el.innerHTML = html;
}

// Слушатели событий связи + периодическая досылка (один раз на загрузку).
let _posQueueWired = false;
function posWireQueue() {
    if (_posQueueWired) return;
    _posQueueWired = true;
    window.addEventListener('online', () => { posUpdateConnUI(); posFlushQueue(); });
    window.addEventListener('offline', () => { posUpdateConnUI(); });
    setInterval(() => { if (navigator.onLine) posFlushQueue(); }, 30000); // каждые 30с
    posUpdateConnUI();
    if (navigator.onLine) posFlushQueue();
}

// Эмодзи для магазина
function posKassaEmoji(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('интернет')) return '🌐';
    if (n.includes('сити') || n.includes('молл')) return '🏬';
    if (n.includes('сиём') || n.includes('сием')) return '🏪';
    if (n.includes('баракат')) return '🏪';
    if (n.includes('айни')) return '🏪';
    return '🛒';
}

async function loadPos() {
    POS.isMobile = posDetectMobile();
    posError('');
    posWireQueue();   // подключаем офлайн-очередь + индикатор связи (один раз)

    // Если уже загружено и есть выбранная касса с открытой сменой — показываем её
    if (POS.loaded && POS.shift) { posShowStep(3); return; }
    if (POS.loaded && POS.chosen) { return; } // сохраняем текущее состояние

    posShowStep(1);
    const listEl = document.getElementById('posKassaList');
    if (listEl) listEl.innerHTML = '<div class="pos-loading">⏳ Загружаю кассы…</div>';

    try {
        const r = await posApi('', { method: 'GET' });
        if (!r.ok || !r.data.ok) throw new Error(r.data.error || `HTTP ${r.status}`);
        POS.kassas = r.data.kassas || [];
        // Логин магазина: оставляем только его СОБСТВЕННУЮ кассу.
        if (currentAllowedKassa) {
            const norm = s => String(s || '').trim().toLowerCase();
            POS.kassas = POS.kassas.filter(k => norm(k.name) === norm(currentAllowedKassa));
        }
        POS.sellers = r.data.sellers || [];
        POS.loaded = true;
        posRenderKassas();
        posPopulateSellers();
        // Если касса единственная (логин магазина) — сразу выбираем её,
        // чтобы кассир не выбирал одну и ту же кассу каждый раз.
        if (currentAllowedKassa && POS.kassas.length === 1) {
            posSelectKassa(POS.kassas[0]);
        }
    } catch (e) {
        if (listEl) listEl.innerHTML = '';
        posError('Не удалось загрузить кассы: ' + e.message);
    }
}

function posRenderKassas() {
    const listEl = document.getElementById('posKassaList');
    if (!listEl) return;
    if (!POS.kassas.length) { listEl.innerHTML = '<div class="pos-loading">Кассы не найдены.</div>'; return; }
    listEl.innerHTML = '';
    POS.kassas.forEach(k => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pos-kassa-item';
        btn.dataset.ref = k.ref;
        const sub = k.type ? (k.offline ? 'Автономная ККМ' : 'Фискальный регистратор') : '';
        btn.innerHTML = `<span class="pos-kassa-emoji">${posKassaEmoji(k.name)}</span>
            <span><span>${posEsc(k.name)}</span>${sub ? `<span class="pos-kassa-sub">${sub}</span>` : ''}</span>`;
        btn.onclick = () => posSelectKassa(k);
        listEl.appendChild(btn);
    });
}

function posEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function posSelectKassa(k) {
    POS.chosen = k;
    document.querySelectorAll('#posKassaList .pos-kassa-item').forEach(el => {
        el.classList.toggle('active', el.dataset.ref === k.ref);
    });
    // показать подтверждение
    const wrap = document.getElementById('posConfirmWrap');
    const nameEl = document.getElementById('posConfirmName');
    const chk = document.getElementById('posConfirmKassa');
    if (nameEl) nameEl.textContent = k.name;
    if (chk) chk.checked = false;
    if (wrap) wrap.style.display = 'flex';
    posUpdateStep1Btn();
}

function posUpdateStep1Btn() {
    const chk = document.getElementById('posConfirmKassa');
    const btn = document.getElementById('posToStep2');
    if (btn) btn.disabled = !(POS.chosen && chk && chk.checked);
}

function posPopulateSellers() {
    const sel = document.getElementById('posSeller');
    if (!sel) return;
    sel.innerHTML = '<option value="">— выберите продавца —</option>';
    let addedDivider = false;
    POS.sellers.forEach(s => {
        // разделитель между «реально продававшими» и остальными
        if (!s.recent && !addedDivider && POS.sellers.some(x => x.recent)) {
            const opt = document.createElement('option');
            opt.disabled = true; opt.textContent = '──────────';
            sel.appendChild(opt); addedDivider = true;
        }
        const opt = document.createElement('option');
        opt.value = s.ref;
        opt.textContent = (s.recent ? '⭐ ' : '') + s.name;
        opt.dataset.name = s.name;
        sel.appendChild(opt);
    });
}

// ── Шаг 2 ──
async function posGoStep2() {
    if (!POS.chosen) return;
    posError('');
    const badge = document.getElementById('posChosenKassa');
    if (badge) badge.textContent = posKassaEmoji(POS.chosen.name) + ' ' + POS.chosen.name;

    // Проверим, нет ли уже открытой смены по этой кассе
    try {
        const r = await posApi(`?action=shift&kassa=${encodeURIComponent(POS.chosen.ref)}`, { method: 'GET' });
        if (r.ok && r.data.ok && r.data.shift) {
            POS.shift = r.data.shift;
            posEnterSalesArea();
            return;
        }
    } catch (_) { /* игнор — просто откроем шаг 2 */ }

    posShowStep(2);
}

function posUpdateOpenBtn() {
    const sel = document.getElementById('posSeller');
    const btn = document.getElementById('posOpenShift');
    if (btn) btn.disabled = !(sel && sel.value);
}

async function posOpenShift() {
    const sel = document.getElementById('posSeller');
    if (!POS.chosen || !sel || !sel.value) return;
    const sellerRef = sel.value;
    const sellerName = sel.options[sel.selectedIndex]?.dataset.name || sel.options[sel.selectedIndex]?.textContent || '';
    const btn = document.getElementById('posOpenShift');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Открываю…'; }
    posError('');
    try {
        const r = await posApi('?action=open-shift', {
            method: 'POST',
            body: JSON.stringify({
                kassaC1Ref: POS.chosen.ref,
                kassaName: POS.chosen.name,
                shopC1Ref: POS.chosen.shopRef,
                shopName: POS.chosen.shopName || POS.chosen.name,
                sellerC1Ref: sellerRef,
                sellerName: sellerName.replace(/^⭐ /, ''),
                openedBy: currentUser || 'unknown',
                device: POS.isMobile ? 'mobile' : 'desktop',
            }),
        });
        if (r.status === 409 && r.data.shift) {
            // уже открыта — входим в неё
            POS.shift = r.data.shift;
            posEnterSalesArea();
            return;
        }
        if (!r.ok || !r.data.ok) throw new Error(r.data.error || `HTTP ${r.status}`);
        POS.shift = r.data.shift;
        posEnterSalesArea();
    } catch (e) {
        posError('Не удалось открыть смену: ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Открыть смену'; }
    }
}

// ── Шаг 3: область продаж ──
function posEnterSalesArea() {
    posShowStep(3);
    const sh = POS.shift || {};
    const meta = document.getElementById('posShiftMeta');
    if (meta) {
        const opened = sh.opened_at ? new Date(sh.opened_at).toLocaleString('ru-RU') : '';
        meta.innerHTML = `${posEsc(sh.kassa_name || '')} · Продавец: <b>${posEsc(sh.seller_name || '—')}</b><br>Открыта: ${opened}`;
    }
    const top = document.getElementById('posTopStatus');
    if (top) top.textContent = '🟢 Смена открыта · ' + (sh.kassa_name || '');

    // Режим сканирования
    const badge = document.getElementById('posModeBadge');
    const camWrap = document.getElementById('posCameraWrap');
    const hint = document.getElementById('posScanHint');
    if (POS.isMobile) {
        if (badge) badge.textContent = '📷 Камера телефона';
        if (camWrap) camWrap.style.display = '';
        if (hint) hint.textContent = 'Можно навести камеру или ввести код вручную.';
    } else {
        if (badge) badge.textContent = '🖥️ Аппаратный сканер';
        if (camWrap) camWrap.style.display = 'none';
        if (hint) hint.textContent = 'Отсканируйте товар аппаратным сканером — код появится здесь.';
        // фокус на поле ввода, чтобы сканер-«клавиатура» попадал сюда
        setTimeout(() => { const inp = document.getElementById('posScanInput'); if (inp) inp.focus(); }, 100);
    }
    posSetupHardwareScanner();
    if (typeof pmobApply === 'function') pmobApply();   // мобильный оверлей: свежие данные смены
}

// Desktop: аппаратный сканер работает как клавиатура — ловим быстрый ввод + Enter
function posSetupHardwareScanner() {
    if (POS.keyHandler) return; // уже установлен
    POS.keyHandler = function (e) {
        // работаем только когда открыта вкладка POS и есть смена
        const posSection = document.getElementById('posSection');
        if (!posSection || !posSection.classList.contains('active') || !POS.shift) return;
        const inp = document.getElementById('posScanInput');
        const activeIsScan = document.activeElement === inp;
        // если фокус в другом текстовом поле — не перехватываем
        const ae = document.activeElement;
        if (!activeIsScan && ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA')) return;

        if (e.key === 'Enter') {
            if (POS.scanBuffer.length >= 6) {
                const code = POS.scanBuffer;
                posHandleScannedCode(code);
            }
            POS.scanBuffer = '';
            return;
        }
        if (/^[0-9]$/.test(e.key)) {
            POS.scanBuffer += e.key;
            clearTimeout(POS.scanTimer);
            POS.scanTimer = setTimeout(() => { POS.scanBuffer = ''; }, 120); // сканер печатает быстро
        }
    };
    document.addEventListener('keydown', POS.keyHandler);
}

// Ручной ввод в поле (десктоп-сканер тоже сюда пишет + Enter)
function posScanInputHandler(e) {
    if (e.key === 'Enter') {
        const inp = e.target;
        const code = (inp.value || '').trim();
        if (code.length >= 6) posHandleScannedCode(code);
        inp.value = '';
        e.preventDefault();
    }
}

// ───────────── ЭТАП 2: регистрация продажи ─────────────
function posShopWh() {
    // склад продажи: сперва из открытой смены (резолвится на бэкенде при open-shift),
    // затем из метаданных выбранной кассы (фолбэк).
    const sh = POS.shift || {};
    return sh.sale_warehouse_c1_ref
        || (POS.chosen && (POS.chosen.warehouseRef || POS.chosen.whRef || POS.chosen.saleWarehouseRef))
        || null;
}

// Скан товара → автоподстановка в корзину
async function posHandleScannedCode(code) {
    code = String(code || '').trim();
    if (!code) return;
    const inp = document.getElementById('posScanInput');
    if (inp) inp.value = '';
    const hint = document.getElementById('posScanHint');
    if (hint) hint.innerHTML = `⏳ Ищу товар <b>${posEsc(code)}</b>…`;
    // Офлайн-защита: если этот же экземплярный штрихкод уже стоит в офлайн-очереди — нельзя продать дважды.
    try {
        const reserved = await posQueuedReserved();
        if (reserved.byBarcode.has(String(code))) {
            if (hint) hint.innerHTML = `⛔ Экземпляр <b>${posEsc(code)}</b> уже в неотправленном чеке (ждёт связи). Повторно продать нельзя.`;
            return;
        }
    } catch (_) { /* очередь недоступна — не блокируем скан */ }
    try {
        const wh = encodeURIComponent(posShopWh() || '');
        const r = await posApiTimeout(`?action=scan&barcode=${encodeURIComponent(code)}&wh=${wh}`, { method: 'GET' }, 10000);
        if (!r.ok || !r.data.ok) throw new Error(r.data.error || `HTTP ${r.status}`);
        const it = r.data.item;
        if (!it || !it.found) {
            if (hint) hint.innerHTML = `❌ Штрихкод <b>${posEsc(code)}</b> не найден в базе.`;
            if (POS.isMobile && typeof pmobToast === 'function') pmobToast('Штрихкод не найден', code, true);
            return;
        }
        const err = posAddToCart(it);
        if (hint) {
            if (err) hint.innerHTML = err;
            else {
                const last4 = String(it.uniqueBarcode || it.barcode || '').slice(-4);
                hint.innerHTML = `✅ Добавлено: <b>${posEsc(it.name)}</b>${it.sizeLabel ? ' · ' + posEsc(it.sizeLabel) : ''}${last4 ? ' · №' + posEsc(last4) : ''}`;
            }
        }
        // Мобильный UI: успешный скан → камера закрывается + зелёный попап «Товар добавлен в чек».
        if (POS.isMobile) {
            if (err) { if (typeof pmobToast === 'function') pmobToast('Нельзя добавить', String(err).replace(/<[^>]*>/g, '').trim(), true); }
            else if (typeof pmobScanSuccess === 'function') pmobScanSuccess();
        }
    } catch (e) {
        if (posIsNetworkError(e)) {
            if (hint) hint.innerHTML = `📶 Нет связи — не могу проверить товар <b>${posEsc(code)}</b>. Подождите пару секунд и отсканируйте снова.`;
            if (POS.isMobile && typeof pmobToast === 'function') pmobToast('Нет связи', 'Подождите пару секунд и отсканируйте снова', true);
        } else {
            if (hint) hint.innerHTML = `⚠️ Ошибка поиска: ${posEsc(e.message)}`;
            if (POS.isMobile && typeof pmobToast === 'function') pmobToast('Ошибка поиска', e.message || '', true);
        }
    }
}

// вернёт текст ошибки для hint (если добавить нельзя) либо null при успехе
function posAddToCart(it) {
    // Фактический остаток на складе кассы (из бэкенда scan).
    const avail = (it.availableAtShop != null) ? Number(it.availableAtShop) : null;

    // ─── ЭКЗЕМПЛЯРНЫЙ штрихкод (у каждой пары свой уникальный код) ───
    if (it.uniqueBarcode) {
        // не в наличии (уже продан/другой склад) — не добавляем
        if (it.status && it.status !== 'in_stock') {
            return '⛔ Экземпляр не в наличии (уже продан или списан).';
        }
        // ищем строку этого же варианта (группируем экземпляры одной модели+размера)
        let line = POS.cart.find(l => l.uniqueBarcode && l.charC1Ref === it.charC1Ref);
        if (line) {
            // этот штрихкод уже сканирован?
            if (line.scans.includes(it.uniqueBarcode)) {
                POS.activeKey = line.key; posRenderCart();
                return '⚠️ Этот экземпляр уже в чеке.';
            }
            // не превышаем фактический остаток на складе
            if (avail != null && line.scans.length >= avail) {
                POS.activeKey = line.key; posRenderCart();
                return `⛔ На складе кассы только ${avail} шт. Больше продать нельзя.`;
            }
            line.scans.push(it.uniqueBarcode);
            line.qty = line.scans.length;
            if (avail != null) line.availableAtShop = avail;
            POS.activeKey = line.key; posRenderCart();
            return null;
        }
        // новая строка экземплярного товара
        if (avail != null && avail < 1) {
            return '⛔ Товара нет на складе этой кассы.';
        }
        line = {
            key: 'L' + (POS.keySeq++), kind: it.kind,
            barcode: it.barcode, uniqueBarcode: it.uniqueBarcode,
            scans: [it.uniqueBarcode],
            name: it.name, sizeLabel: it.sizeLabel || null,
            price: Number(it.price) || 0, qty: 1, discountPct: 0,
            productC1Ref: it.productC1Ref, charC1Ref: it.charC1Ref || null,
            warehouseC1Ref: it.warehouseC1Ref || posShopWh() || null,
            warning: it.warning || null,
            availableAtShop: avail, status: it.status || null,
        };
        POS.cart.push(line);
        POS.activeKey = line.key;
        posRenderCart();
        return null;
    }

    // ─── ГРУППОВОЙ EAN (общий штрихкод на вариант, остаток из product_variants.stock) ───
    let line = POS.cart.find(l => !l.uniqueBarcode && l.barcode === it.barcode && l.charC1Ref === it.charC1Ref);
    if (line) {
        if (avail != null && line.qty >= avail) {
            POS.activeKey = line.key; posRenderCart();
            return `⛔ На складе кассы только ${avail} шт. Больше продать нельзя.`;
        }
        line.qty += 1;
        line.scans.push(it.barcode);
        if (avail != null) line.availableAtShop = avail;
        POS.activeKey = line.key; posRenderCart();
        return null;
    }
    if (avail != null && avail < 1) {
        return '⛔ Товара нет на складе этой кассы.';
    }
    line = {
        key: 'L' + (POS.keySeq++), kind: it.kind,
        barcode: it.barcode, uniqueBarcode: null,
        scans: [it.barcode],
        name: it.name, sizeLabel: it.sizeLabel || null,
        price: Number(it.price) || 0, qty: 1, discountPct: 0,
        productC1Ref: it.productC1Ref, charC1Ref: it.charC1Ref || null,
        warehouseC1Ref: it.warehouseC1Ref || posShopWh() || null,
        warning: it.warning || null,
        availableAtShop: avail, status: it.status || null,
    };
    POS.cart.push(line);
    POS.activeKey = line.key;
    posRenderCart();
    return null;
}

// Округление вниз до кратного 10 (523→520, 427→420). Только для положительных сумм.
function posFloor10(x) {
    const v = Number(x) || 0;
    if (v <= 0) return 0;
    return Math.floor(v / 10) * 10;
}

// Чистая цена позиции.
// Если на позиции включена скидка 5% — берём цену со скидкой и ОКРУГЛЯЕМ ВНИЗ до 10.
// Из-за округления фактическая скидка получается чуть больше 5% — это ожидаемо.
function posLineNet(l) {
    const gross = l.price * l.qty;
    if ((l.discountPct || 0) > 0) {
        return Math.max(0, posFloor10(gross * (1 - (l.discountPct || 0) / 100)));
    }
    return Math.max(0, gross);
}

// Фактическая скидка на позицию (после округления вниз): { amount (сомони), pct (%) }.
// Считаем от реальной разницы gross - net, а не от номинальных 5%.
function posLineDiscInfo(l) {
    const gross = Math.round((l.price * l.qty) || 0);
    const net = Math.round(posLineNet(l));
    const amount = Math.max(0, gross - net);
    const pct = gross > 0 ? (amount / gross) * 100 : 0;
    return { gross, net, amount, pct };
}

// Позиция «не в наличии на складе кассы»: экземпляр не in_stock, или на складе кассы 0 шт.
function posLineOutOfStock(l) {
    if (l.status && l.status !== 'in_stock') return true;
    if (l.availableAtShop != null && Number(l.availableAtShop) <= 0) return true;
    return false;
}
// Есть ли в корзине хоть одна позиция не в наличии на складе кассы
function posCartHasOutOfStock() {
    return POS.cart.some(posLineOutOfStock);
}

// Скидка на чек = клиентская карта (10%) + ручные 5%, ограничено 100%
function posCartDiscPct() {
    const client = POS.client ? (Number(POS.client.discount_pct) || 0) : 0;
    return Math.min(100, client + (POS.cartDiscountPct || 0));
}

function posTotals() {
    let gross = 0, lineNet = 0;
    POS.cart.forEach(l => { gross += l.price * l.qty; lineNet += posLineNet(l); });
    const cartPct = posCartDiscPct();
    const grand = Math.round(lineNet * (1 - cartPct / 100));
    const disc = Math.round(gross) - grand;
    return { gross: Math.round(gross), grand, disc, cartPct };
}

function posRenderCart() {
    const box = document.getElementById('posCart');
    if (!box) return;
    if (!POS.cart.length) {
        box.innerHTML = '<div class="pos-cart-empty">Корзина пуста. Отсканируйте товар.</div>';
        posToggleSaleBlocks(false);
        if (typeof pmobRender === 'function') pmobRender();
        return;
    }
    box.innerHTML = '';
    POS.cart.forEach(l => {
        const net = posLineNet(l);
        const div = document.createElement('div');
        const oos = posLineOutOfStock(l);
        div.className = 'pos-line' + (l.key === POS.activeKey ? ' active' : '') + (oos ? ' oos' : '');
        div.onclick = () => { POS.activeKey = l.key; posRenderCart(); };
        const discTag = l.discountPct ? ` <span class="pos-disc-tag">−${l.discountPct}%</span>` : '';
        const priceInfo = `${posMoney(l.price)}${l.qty > 1 ? ' × ' + l.qty : ''}${discTag}`;
        const warnText = l.warning || (oos ? 'Не числится на складе этой кассы' : null);
        // список отсканированных штрихкодов (последние 4 цифры)
        const scans = Array.isArray(l.scans) ? l.scans : [];
        let scanHtml = '';
        if (scans.length === 1) {
            const c = String(scans[0] || '');
            scanHtml = `<span class="pos-line-code">№ ${posEsc(c.slice(-4))}</span>`;
        } else if (scans.length > 1) {
            const opts = scans.map((c, i) =>
                `<div class="pos-code-item"><span>${i + 1}. № ${posEsc(String(c).slice(-4))}</span>` +
                `<button type="button" class="pos-code-rm" data-act="rmscan" data-idx="${i}" title="Убрать экземпляр">×</button></div>`
            ).join('');
            scanHtml =
                `<details class="pos-code-drop">` +
                `<summary>${scans.length} шт. · штрихкоды ▾</summary>` +
                `<div class="pos-code-list">${opts}</div></details>`;
        }
        div.innerHTML = `
            <div class="pos-line-info">
              <div class="pos-line-name">${posEsc(l.name)}</div>
              <div class="pos-line-sub">${l.sizeLabel ? posEsc(l.sizeLabel) + ' · ' : ''}${priceInfo}</div>
              ${scanHtml ? `<div class="pos-line-codes">${scanHtml}</div>` : ''}
              ${warnText ? `<div class="pos-line-warn">⚠️ ${posEsc(warnText)}</div>` : ''}
            </div>
            <div class="pos-qty pos-qty-ro" title="Количество = число отсканированных товаров">×${l.qty}</div>
            <div class="pos-line-sum">${posMoney(net)}</div>
            <button class="pos-line-rm" type="button" data-act="rm" title="Удалить позицию">×</button>`;
        div.querySelectorAll('[data-act]').forEach(b => {
            b.onclick = (ev) => {
                ev.stopPropagation();
                POS.activeKey = l.key;
                const act = b.dataset.act;
                if (act === 'rm') { posRemoveLine(l.key); return; }
                if (act === 'rmscan') {
                    const idx = parseInt(b.dataset.idx, 10);
                    if (!isNaN(idx) && Array.isArray(l.scans)) {
                        l.scans.splice(idx, 1);
                        l.qty = l.scans.length;
                        if (l.qty < 1) { posRemoveLine(l.key); return; }
                    }
                    posRenderCart();
                }
            };
        });
        // клик по details не должен выбирать/сбрасывать позицию
        div.querySelectorAll('.pos-code-drop, .pos-line-code').forEach(el => {
            el.addEventListener('click', ev => ev.stopPropagation());
        });
        box.appendChild(div);
    });
    posToggleSaleBlocks(true);
    posRenderTotals();
    if (typeof pmobRender === 'function') pmobRender();
}

function posRemoveLine(key) {
    POS.cart = POS.cart.filter(l => l.key !== key);
    if (POS.activeKey === key) POS.activeKey = POS.cart.length ? POS.cart[POS.cart.length - 1].key : null;
    posRenderCart();
}

function posToggleSaleBlocks(show) {
    const disc = document.getElementById('posDiscountCard');
    const tot = document.getElementById('posTotalsCard');
    if (disc) disc.style.display = show ? '' : 'none';
    if (tot) tot.style.display = show ? '' : 'none';
}

function posRenderTotals() {
    const t = posTotals();
    const g = document.getElementById('posSumGross');
    const dRow = document.getElementById('posSumDiscRow');
    const d = document.getElementById('posSumDisc');
    const grand = document.getElementById('posSumGrand');
    if (g) g.textContent = posMoney(t.gross);
    if (d) d.textContent = '−' + posMoney(t.disc);
    if (dRow) dRow.style.display = t.disc > 0 ? '' : 'none';
    if (grand) grand.textContent = posMoney(t.grand);
    // блокировка «К оплате», если есть позиция не в наличии на складе кассы
    const toPay = document.getElementById('posToPayment');
    if (toPay) {
        const blocked = !POS.cart.length || posCartHasOutOfStock();
        toPay.disabled = blocked;
        let warn = document.getElementById('posStockWarn');
        if (posCartHasOutOfStock()) {
            if (!warn) {
                warn = document.createElement('div');
                warn.id = 'posStockWarn';
                warn.className = 'pos-alert pos-alert-error';
                warn.style.cssText = 'margin:10px 0 0;';
                toPay.parentNode.insertBefore(warn, toPay);
            }
            warn.innerHTML = '⛔ В чеке есть товар, который не числится на складе этой кассы. Продажа невозможна — удалите такую позицию.';
            warn.style.display = '';
        } else if (warn) {
            warn.style.display = 'none';
        }
    }
}

// ── Быстрые скидки ──
function posApply5Item() {
    const l = POS.cart.find(x => x.key === POS.activeKey) || POS.cart[POS.cart.length - 1];
    if (!l) { posError('Сначала отсканируйте товар.'); return; }
    l.discountPct = l.discountPct >= 5 ? 0 : 5; // повторное нажатие снимает
    posRenderCart();
}
function posApply5Cart() {
    POS.cartDiscountPct = POS.cartDiscountPct >= 5 ? 0 : 5;
    posRenderTotals();
}

// ── Карта врача (ВР) ──
let posDoctorSearchT = null;
function posDoctorInputHandler(e) {
    const q = (e.target.value || '').trim();
    clearTimeout(posDoctorSearchT);
    const box = document.getElementById('posDoctorResults');
    if (q.length < 2) { if (box) box.innerHTML = ''; return; }
    posDoctorSearchT = setTimeout(() => posSearchCard('doctor', q, box), 280);
}

async function posSearchCard(type, q, box) {
    try {
        const r = await posApi(`?action=card&type=${type}&q=${encodeURIComponent(q)}`, { method: 'GET' });
        if (!r.ok || !r.data.ok) return;
        const cards = r.data.cards || [];
        if (!box) return;
        if (!cards.length) { box.innerHTML = '<div class="pos-hint" style="margin:4px 0;">Ничего не найдено.</div>'; return; }
        box.innerHTML = '';
        cards.forEach(c => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'pos-card-res-item';
            b.innerHTML = `<b>${posEsc(c.full_name)}</b> <span style="color:#889;">· код ${posEsc(c.card_code || '—')}</span>`;
            b.onclick = () => posChooseDoctor(c);
            box.appendChild(b);
        });
    } catch (_) { /* — */ }
}

function posChooseDoctor(c) {
    POS.doctor = c;
    const box = document.getElementById('posDoctorResults');
    const chosen = document.getElementById('posDoctorChosen');
    const inp = document.getElementById('posDoctorInput');
    if (box) box.innerHTML = '';
    if (inp) inp.value = '';
    if (chosen) {
        chosen.style.display = 'flex';
        chosen.innerHTML = `<span>🩺 Врач: <b>${posEsc(c.full_name)}</b> (код ${posEsc(c.card_code || '—')})</span>
            <button class="pos-chosen-rm" type="button" title="Убрать">×</button>`;
        chosen.querySelector('.pos-chosen-rm').onclick = () => { POS.doctor = null; chosen.style.display = 'none'; };
    }
}

// ── Карта клиента (10% на чек) ──
function posClientInputHandler(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = (e.target.value || '').trim();
    if (code.length < 3) return;
    posLookupClient(code);
}
async function posLookupClient(code) {
    const chosen = document.getElementById('posClientChosen');
    try {
        const r = await posApi(`?action=card&type=client&q=${encodeURIComponent(code)}`, { method: 'GET' });
        const cards = (r.data && r.data.cards) || [];
        const inp = document.getElementById('posClientInput');
        if (!cards.length) {
            if (chosen) { chosen.style.display = 'flex'; chosen.style.background = '#fef2f2'; chosen.style.borderColor = '#fecaca';
                chosen.innerHTML = `<span style="color:#b91c1c;">❌ Карта <b>${posEsc(code)}</b> не найдена</span>`; }
            return;
        }
        const c = cards[0];
        POS.client = c;
        if (inp) inp.value = '';
        if (chosen) {
            chosen.style.display = 'flex'; chosen.style.background = '#ecfdf5'; chosen.style.borderColor = '#a7f3d0';
            chosen.innerHTML = `<span>🏷️ Клиент: <b>${posEsc(c.full_name)}</b> · скидка ${Number(c.discount_pct) || 10}%</span>
                <button class="pos-chosen-rm" type="button" title="Убрать">×</button>`;
            chosen.querySelector('.pos-chosen-rm').onclick = () => { POS.client = null; chosen.style.display = 'none'; posRenderTotals(); };
        }
        posRenderTotals();
    } catch (_) { /* — */ }
}

// Камера для скана штрихкода дисконтной карты клиента
async function posToggleClientCamera() {
    const wrap = document.getElementById('posClientCamWrap');
    if (!window.Html5Qrcode) { posError('Библиотека сканера не загрузилась. Обновите страницу.'); return; }
    if (POS.clientCamOn) { await posStopClientCamera(); return; }
    try {
        if (wrap) wrap.style.display = '';
        POS.clientQr = new Html5Qrcode('posClientReader', { verbose: false });
        const cfg = {
            fps: 10, qrbox: { width: 250, height: 140 },
            formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8, Html5QrcodeSupportedFormats.CODE_128],
        };
        await POS.clientQr.start(
            { facingMode: 'environment' }, cfg,
            async (decoded) => {
                await posStopClientCamera();
                posLookupClient(String(decoded || '').trim());
            },
            () => {}
        );
        POS.clientCamOn = true;
    } catch (e) {
        posError('Не удалось включить камеру: ' + (e && e.message || e));
        if (wrap) wrap.style.display = 'none';
    }
}
async function posStopClientCamera() {
    const wrap = document.getElementById('posClientCamWrap');
    try { if (POS.clientQr) { await POS.clientQr.stop(); await POS.clientQr.clear(); } } catch (_) {}
    POS.clientQr = null; POS.clientCamOn = false;
    if (wrap) wrap.style.display = 'none';
}

// ── Оплата ──
async function posOpenPayment() {
    if (!POS.cart.length) return;
    posError('');
    // подгружаем виды оплат, если ещё нет
    if (!POS.paytypes) {
        try {
            const shop = encodeURIComponent((POS.chosen && POS.chosen.shopRef) || '');
            const r = await posApi(`?action=paytypes&shop=${shop}`, { method: 'GET' });
            if (r.ok && r.data.ok) POS.paytypes = r.data.paytypes;
        } catch (_) { /* — */ }
    }
    posPopulateCardSelects();
    const t = posTotals();
    const grandEl = document.getElementById('posPayGrand');
    if (grandEl) grandEl.textContent = posMoney(t.grand) + ' сом';
    posSetPayMode('cash');
    const cg = document.getElementById('posCashGiven'); if (cg) cg.value = '';
    const mc = document.getElementById('posMixCash'); if (mc) mc.value = '';
    document.getElementById('posChangeRow').style.display = 'none';
    const modal = document.getElementById('posPayModal'); if (modal) modal.style.display = 'flex';
}

function posPopulateCardSelects() {
    const cards = (POS.paytypes && POS.paytypes.cards) || [];
    ['posCardType', 'posMixCardType'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        sel.innerHTML = '';
        cards.forEach(c => {
            const o = document.createElement('option');
            o.value = c.ref; o.textContent = c.name;
            sel.appendChild(o);
        });
    });
}

function posSetPayMode(mode) {
    POS.payMode = mode;
    document.querySelectorAll('.pos-paymode').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    document.getElementById('posPayCash').style.display = mode === 'cash' ? '' : 'none';
    document.getElementById('posPayCard').style.display = mode === 'card' ? '' : 'none';
    document.getElementById('posPayMixed').style.display = mode === 'mixed' ? '' : 'none';
    posRecalcChange();
}

function posRecalcChange() {
    const t = posTotals();
    if (POS.payMode === 'cash') {
        const given = Number(document.getElementById('posCashGiven').value) || 0;
        const row = document.getElementById('posChangeRow');
        const val = document.getElementById('posChangeVal');
        const change = given - t.grand;
        if (given > 0) {
            row.style.display = '';
            row.classList.toggle('neg', change < 0);
            val.textContent = (change < 0 ? 'не хватает ' + posMoney(-change) : posMoney(change)) + ' сом';
        } else { row.style.display = 'none'; }
    } else if (POS.payMode === 'mixed') {
        const cash = Number(document.getElementById('posMixCash').value) || 0;
        const rest = Math.max(0, t.grand - cash);
        document.getElementById('posMixCardVal').textContent = posMoney(rest) + ' сом';
    }
}

// имя вида оплаты по ref (для разбивки выручки на закрытии смены)
function posPayName(ref) {
    const pt = POS.paytypes || {};
    const all = (pt.cash || []).concat(pt.cards || []);
    return (all.find(x => x.ref === ref) || {}).name || null;
}

function posBuildPayments() {
    const t = posTotals();
    const pt = POS.paytypes || {};
    const cashRef = (pt.cash && pt.cash[0] && pt.cash[0].ref) || null;
    const cashName = (pt.cash && pt.cash[0] && pt.cash[0].name) || 'Наличные';
    const term = (pt.defaultTerminal) || null;
    if (POS.payMode === 'cash') {
        return { payments: [{ payTypeC1Ref: cashRef, amount: t.grand, payName: cashName }], error: cashRef ? null : 'Нет вида оплаты «Наличные»' };
    }
    if (POS.payMode === 'card') {
        const ref = document.getElementById('posCardType').value;
        if (!ref) return { error: 'Выберите платёжную карту' };
        return { payments: [{ payTypeC1Ref: ref, amount: t.grand, terminalC1Ref: term, payName: posPayName(ref) }] };
    }
    // mixed
    const cash = Math.round(Number(document.getElementById('posMixCash').value) || 0);
    const ref = document.getElementById('posMixCardType').value;
    const rest = t.grand - cash;
    if (cash <= 0) return { error: 'Укажите сумму наличными' };
    if (cash >= t.grand) return { error: 'Наличные покрывают весь чек — выберите «Наличные»' };
    if (!ref) return { error: 'Выберите платёжную карту для остатка' };
    return { payments: [
        { payTypeC1Ref: cashRef, amount: cash, payName: cashName },
        { payTypeC1Ref: ref, amount: rest, terminalC1Ref: term, payName: posPayName(ref) },
    ], error: cashRef ? null : 'Нет вида оплаты «Наличные»' };
}

// ── Чек-сверка ──
function posShowReceipt() {
    const perr = document.getElementById('posPayError');
    const pb = posBuildPayments();
    if (pb.error) { if (perr) { perr.style.display = 'block'; perr.textContent = '⚠️ ' + pb.error; } return; }
    if (perr) perr.style.display = 'none';
    POS._payments = pb.payments;
    const t = posTotals();
    const sh = POS.shift || {};
    const now = new Date();
    const cashRow = pb.payments.find(p => p.payTypeC1Ref === ((POS.paytypes.cash[0] || {}).ref));
    const payModeName = POS.payMode === 'cash' ? 'Наличные'
        : POS.payMode === 'card' ? ('Электронные · ' + (document.getElementById('posCardType').selectedOptions[0]||{}).textContent)
        : 'Смешанный';
    let itemsHtml = '';
    POS.cart.forEach((l, i) => {
        const net = posLineNet(l);
        itemsHtml += `<div class="pr-item">
            <div class="pr-line"><span>${i + 1}. ${posEsc(l.name)}</span></div>
            <div class="pr-line"><span>&nbsp;&nbsp;${posMoney(l.price)} × ${l.qty}${l.discountPct ? ' <span class="pr-disc">(−' + l.discountPct + '%)</span>' : ''}</span><span>${posMoney(net)}</span></div>
        </div>`;
    });
    let payHtml = '';
    pb.payments.forEach(p => {
        const nm = (POS.paytypes.cash.concat(POS.paytypes.cards).find(x => x.ref === p.payTypeC1Ref) || {}).name || 'Оплата';
        payHtml += `<div class="pr-line"><span>${posEsc(nm)}</span><span>${posMoney(p.amount)}</span></div>`;
    });
    let changeHtml = '';
    if (POS.payMode === 'cash') {
        const given = Number(document.getElementById('posCashGiven').value) || 0;
        if (given > 0) changeHtml = `<div class="pr-line"><span>Внесено</span><span>${posMoney(given)}</span></div>
            <div class="pr-line"><span>Сдача</span><span>${posMoney(given - t.grand)}</span></div>`;
    }
    const prev = document.getElementById('posReceiptPreview');
    prev.innerHTML = `
        <div class="pr-title">${posEsc(sh.kassa_name || 'Касса')}</div>
        <div class="pr-sub">Чек к проведению · ${now.toLocaleString('ru-RU')}</div>
        <div class="pr-line"><span>Продавец</span><span>${posEsc(sh.seller_name || '—')}</span></div>
        ${POS.doctor ? `<div class="pr-line"><span>Врач (ВР)</span><span>${posEsc(POS.doctor.full_name)}</span></div>` : ''}
        ${POS.client ? `<div class="pr-line"><span>Клиент</span><span>${posEsc(POS.client.full_name)}</span></div>` : ''}
        <div class="pr-hr"></div>
        ${itemsHtml}
        <div class="pr-hr"></div>
        <div class="pr-line"><span>Сумма</span><span>${posMoney(t.gross)}</span></div>
        ${t.disc > 0 ? `<div class="pr-line pr-disc"><span>Скидка${t.cartPct ? ' (чек −' + t.cartPct + '%)' : ''}</span><span>−${posMoney(t.disc)}</span></div>` : ''}
        <div class="pr-line pr-grand"><span>ИТОГО</span><span>${posMoney(t.grand)} сом</span></div>
        <div class="pr-hr"></div>
        ${payHtml}
        ${changeHtml}`;
    document.getElementById('posPayModal').style.display = 'none';
    document.getElementById('posReceiptModal').style.display = 'flex';
    const rerr = document.getElementById('posReceiptError'); if (rerr) rerr.style.display = 'none';
}

// ── Проведение продажи ──
async function posConfirmSale() {
    if (POS.busy) return;
    const rerr = document.getElementById('posReceiptError');
    const btn = document.getElementById('posReceiptConfirm');
    POS.busy = true;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Провожу…'; }
    if (rerr) rerr.style.display = 'none';
    try {
        const items = POS.cart.map(l => ({
            productC1Ref: l.productC1Ref, charC1Ref: l.charC1Ref,
            warehouseC1Ref: l.warehouseC1Ref || posShopWh(),
            // ВАЖНО: отправляем ФАКТИЧЕСКИй % скидки (после округления вниз до 10),
            // чтобы net в 1С совпадал с тем, что видел кассир (а не номинальные 5%).
            qty: l.qty, price: l.price, discountPct: (l.discountPct ? posLineDiscInfo(l).pct : 0),
            uniqueBarcode: l.uniqueBarcode, barcode: l.barcode, name: l.name,
            // все отсканированные экземплярные штрихкоды (для экземплярного товара = каждый помечается отдельно)
            uniqueBarcodes: (l.uniqueBarcode && Array.isArray(l.scans)) ? l.scans.slice() : null,
        }));
        // скидка на чек (клиент + ручные 5%) — размазываем по позициям как доп. %
        const cartPct = posCartDiscPct();
        if (cartPct > 0) {
            items.forEach(it => {
                const combined = 1 - (1 - (it.discountPct || 0) / 100) * (1 - cartPct / 100);
                it.discountPct = Math.round(combined * 10000) / 100; // до 2 знаков
            });
        }
        const sh = POS.shift || {};
        const body = {
            clientSaleId: posNewClientSaleId(),   // уникальный id чека — защита от дублей при досылке
            kassaC1Ref: POS.chosen.ref,
            sellerC1Ref: sh.seller_c1_ref || sh.seller_ref || sh.sellerC1Ref,
            sellerName: sh.seller_name,
            shiftId: sh.id,
            warehouseC1Ref: posShopWh(),
            discountCardC1Ref: (POS.client && POS.client.c1_ref) || (POS.doctor && POS.doctor.c1_ref) || null,
            items,
            payments: POS._payments || [],
        };
        // ОНЛАЙН-FIRST: сначала пробуем отправить в сеть с таймаутом.
        let r;
        try {
            r = await posApiTimeout('?action=sell', { method: 'POST', body: JSON.stringify(body) }, 12000);
        } catch (netErr) {
            if (posIsNetworkError(netErr)) {
                // Сеть недоступна/таймаут → кладём в офлайн-очередь, дошлём позже.
                await PosQueue.add({ clientSaleId: body.clientSaleId, action: 'sell', body, ts: Date.now() });
                document.getElementById('posReceiptModal').style.display = 'none';
                posResetSale();
                posUpdateConnUI();
                const hint = document.getElementById('posScanHint');
                if (hint) hint.innerHTML = '💾 Слабая связь — чек <b>сохранён</b> и отправится автоматически, когда появится интернет.';
                return;   // не бросаем ошибку — для кассира это успех
            }
            throw netErr;
        }
        if (!r.ok || !r.data.ok) throw new Error(r.data.error || `HTTP ${r.status}`);
        // успех
        document.getElementById('posReceiptModal').style.display = 'none';
        const num = r.data.docNumber || '';
        const posted = r.data.posted;
        posResetSale();
        posUpdateConnUI();
        const hint = document.getElementById('posScanHint');
        if (hint) hint.innerHTML = `✅ Продажа проведена! Чек <b>${posEsc(num)}</b>${posted ? '' : ' <span style="color:#b45309;">(создан, проведённость проверьте в 1С)</span>'}`;
    } catch (e) {
        if (rerr) { rerr.style.display = 'block'; rerr.textContent = '⚠️ ' + e.message; }
    } finally {
        POS.busy = false;
        if (btn) { btn.disabled = false; btn.textContent = '✅ Провести продажу'; }
    }
}

function posResetSale() {
    POS.cart = []; POS.activeKey = null; POS.doctor = null; POS.client = null;
    POS.cartDiscountPct = 0; POS._payments = null;
    const dc = document.getElementById('posDoctorChosen'); if (dc) dc.style.display = 'none';
    const cc = document.getElementById('posClientChosen'); if (cc) cc.style.display = 'none';
    const dr = document.getElementById('posDoctorResults'); if (dr) dr.innerHTML = '';
    posRenderCart();
    if (typeof pmobAfterSale === 'function') pmobAfterSale();
}

// Mobile: камера через html5-qrcode
async function posToggleCamera() {
    const btn = document.getElementById('posCamToggle');
    if (!window.Html5Qrcode) { posError('Библиотека сканера не загрузилась. Обновите страницу.'); return; }
    if (POS.camOn) { await posStopCamera(); return; }
    try {
        POS.html5qr = new Html5Qrcode('posReader', { verbose: false });
        const config = {
            fps: 10,
            qrbox: { width: 250, height: 150 },
            formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8, Html5QrcodeSupportedFormats.CODE_128],
        };
        await POS.html5qr.start(
            { facingMode: 'environment' },
            config,
            (decodedText) => { posHandleScannedCode(decodedText); },
            () => {}
        );
        POS.camOn = true;
        if (btn) btn.textContent = '⏹ Выключить камеру';
    } catch (e) {
        posError('Не удалось запустить камеру: ' + (e.message || e));
    }
}

async function posStopCamera() {
    const btn = document.getElementById('posCamToggle');
    try {
        if (POS.html5qr) { await POS.html5qr.stop(); await POS.html5qr.clear(); }
    } catch (_) {}
    POS.html5qr = null;
    POS.camOn = false;
    if (btn) btn.textContent = '📷 Включить камеру';
}

async function posCloseShift() {
    if (!POS.shift) return;
    if (!confirm('Закрыть кассовую смену?')) return;
    posError('');
    try {
        await posStopCamera();
        const r = await posApi('?action=close-shift', {
            method: 'POST',
            body: JSON.stringify({ shiftId: POS.shift.id }),
        });
        if (!r.ok || !r.data.ok) throw new Error(r.data.error || `HTTP ${r.status}`);
        const closedShift = r.data.shift || {};
        const kassaName = (POS.shift && POS.shift.kassa_name) || closedShift.kassa_name || '';
        POS.shift = null;
        POS.chosen = null;
        const top = document.getElementById('posTopStatus');
        if (top) top.textContent = '';
        const chk = document.getElementById('posConfirmKassa');
        if (chk) chk.checked = false;
        const wrap = document.getElementById('posConfirmWrap');
        if (wrap) wrap.style.display = 'none';
        posUpdateStep1Btn();
        posShowStep(1);
        // Логин магазина: касса одна — сразу выбираем её, чтобы кассир
        // после закрытия смены сразу шёл к выбору продавца.
        if (currentAllowedKassa && POS.kassas && POS.kassas.length === 1) {
            posSelectKassa(POS.kassas[0]);
        }
        // Показываем итоги смены — разбивка выручки по способам оплаты.
        posShowShiftSummary(closedShift, kassaName);
    } catch (e) {
        posError('Не удалось закрыть смену: ' + e.message);
    }
}

// Рендер итогов закрытой смены: общая выручка + разбивка по каждому способу оплаты.
function posShowShiftSummary(shift, kassaName) {
    const body = document.getElementById('posShiftSummaryBody');
    if (!body) return;
    const total = Number(shift.total_sales) || 0;
    const receipts = Number(shift.receipts_count) || 0;
    const bd = shift.payments_breakdown || {};
    // порядок: Наличные первыми, остальные по убыванию суммы
    const entries = Object.keys(bd).map(k => [k, Number(bd[k]) || 0])
        .sort((a, b) => {
            const ca = /налич/i.test(a[0]) ? 1 : 0, cb = /налич/i.test(b[0]) ? 1 : 0;
            if (ca !== cb) return cb - ca;
            return b[1] - a[1];
        });
    const icon = (name) => {
        if (/налич/i.test(name)) return '💵';
        if (/qr|кьюар|кюар/i.test(name)) return '📱';
        if (/карт|visa|master|мир|uzcard|humo/i.test(name)) return '💳';
        return '💰';
    };
    let rows = '';
    if (entries.length) {
        rows = entries.map(([name, amt]) =>
            `<div class="pr-line"><span>${icon(name)} ${posEsc(name)}</span><b>${posMoney(amt)} сом</b></div>`
        ).join('');
    } else {
        rows = `<div class="pr-line" style="color:#7a7974;"><span>Продаж не было</span><span></span></div>`;
    }
    body.innerHTML = `
        <div class="pr-line" style="color:#4b5563;"><span>Касса</span><span>${posEsc(kassaName || '')}</span></div>
        <div class="pr-line" style="color:#4b5563;"><span>Чеков за смену</span><span>${receipts}</span></div>
        <div class="pr-hr"></div>
        <div style="font-weight:700;color:#01696F;margin:6px 0 4px;">Выручка по способам оплаты</div>
        ${rows}
        <div class="pr-hr"></div>
        <div class="pr-line pr-grand"><span>ИТОГО</span><b>${posMoney(total)} сом</b></div>
    `;
    const modal = document.getElementById('posShiftSummaryModal');
    if (modal) modal.style.display = 'flex';
}

// Навешиваем обработчики один раз при загрузке DOM
// ============================================================
//  ВОЗВРАТ ТОВАРА (РМК)
// ============================================================
POS._return = { look: null, busy: false };

function posRetShowStep(step) {
    ['scan', 'confirm', 'done'].forEach(s => {
        const el = document.getElementById('posRetStep' + s.charAt(0).toUpperCase() + s.slice(1));
        if (el) el.style.display = (s === step) ? '' : 'none';
    });
    if (step === 'scan') {
        setTimeout(() => { const inp = document.getElementById('posRetScanInput'); if (inp) { inp.value = ''; inp.focus(); } }, 80);
    }
}

function posOpenReturn() {
    if (!POS.shift) return;
    POS._return = { look: null, busy: false };
    const err1 = document.getElementById('posRetScanError'); if (err1) err1.style.display = 'none';
    const err2 = document.getElementById('posRetConfirmError'); if (err2) err2.style.display = 'none';
    const hint = document.getElementById('posRetScanHint');
    if (hint) hint.textContent = 'Каждый экземпляр имеет уникальный штрихкод — найдём именно ту продажу.';
    posRetShowStep('scan');
    const m = document.getElementById('posReturnModal');
    if (m) m.style.display = 'flex';
    // На телефоне возврат рисуют нативные мобильные экраны, ПК-модаль скрывается.
    if (POS.isMobile && typeof pmobReturnOpened === 'function') pmobReturnOpened();
}

function posCloseReturn() {
    const m = document.getElementById('posReturnModal');
    if (m) m.style.display = 'none';
    // вернём фокус на основное поле сканирования продажи
    setTimeout(() => { const inp = document.getElementById('posScanInput'); if (inp && !POS.isMobile) inp.focus(); }, 80);
}

// Шаг 1 → поиск продажи по штрихкоду
async function posReturnFind() {
    if (POS._return.busy) return;
    const inp = document.getElementById('posRetScanInput');
    const err = document.getElementById('posRetScanError');
    const btn = document.getElementById('posRetFindBtn');
    const code = (inp && inp.value || '').trim();
    if (err) err.style.display = 'none';
    if (code.length < 6) { if (err) { err.style.display = 'block'; err.textContent = '⚠️ Введите корректный штрихкод'; } return; }
    POS._return.busy = true;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Ищу…'; }
    try {
        const r = await posApi('?action=lookup-sale&barcode=' + encodeURIComponent(code), { method: 'GET' });
        if (!r.ok || !r.data.ok) throw new Error(r.data.error || ('HTTP ' + r.status));
        if (!r.data.found) throw new Error(r.data.reason || 'Экземпляр не найден');
        if (!r.data.sellable) throw new Error(r.data.reason || 'Возврат невозможен для этого экземпляра');
        POS._return.look = r.data;
        posRetRenderSale(r.data);
        posRetFillRefundOptions(r.data);
        // сброс причины к «Обмен»
        document.querySelectorAll('.pos-ret-reason').forEach((b, i) => b.classList.toggle('active', i === 0));
        posRetShowStep('confirm');
        if (POS.isMobile && typeof pmobRetFound === 'function') pmobRetFound();
    } catch (e) {
        if (err) { err.style.display = 'block'; err.textContent = '⚠️ ' + e.message; }
        if (POS.isMobile && typeof pmobRetLookupFail === 'function') pmobRetLookupFail(e.message);
    } finally {
        POS._return.busy = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Найти продажу'; }
    }
}

function posRetRenderSale(d) {
    const box = document.getElementById('posRetSaleCard');
    if (!box) return;
    const soldAt = d.sale.soldAt ? new Date(d.sale.soldAt).toLocaleString('ru-RU') : '—';
    box.innerHTML = `
        <div class="pr-title">Найдена продажа</div>
        <div class="pr-sub">Чек № ${posEsc(d.sale.receiptNumber || '—')} · ${soldAt}</div>
        <div class="pr-hr"></div>
        <div class="pr-line"><span>${posEsc(d.product.name || 'Товар')}</span></div>
        ${d.unit.sizeLabel ? `<div class="pr-line"><span>&nbsp;&nbsp;${posEsc(d.unit.sizeLabel)}</span></div>` : ''}
        <div class="pr-line"><span>Штрихкод</span><span>${posEsc(d.barcode)}</span></div>
        <div class="pr-line"><span>Магазин</span><span>${posEsc(d.sale.shopName || '—')}</span></div>
        <div class="pr-line"><span>Продавец</span><span>${posEsc(d.sale.sellerName || '—')}</span></div>
        <div class="pr-hr"></div>
        <div class="pr-line pr-grand"><span>К возврату</span><span>${posMoney(d.product.price)} сом</span></div>`;
}

function posRetFillRefundOptions(d) {
    const sel = document.getElementById('posRetRefund');
    if (!sel) return;
    sel.innerHTML = '';
    const pt = POS.paytypes || {};
    const list = (pt.cash || []).concat(pt.cards || []);
    if (!list.length) {
        const o = document.createElement('option');
        o.value = ''; o.textContent = 'Наличные (по умолчанию)';
        sel.appendChild(o);
        return;
    }
    list.forEach(p => {
        const o = document.createElement('option');
        o.value = p.ref; o.textContent = p.name;
        sel.appendChild(o);
    });
    // по умолчанию — наличные, если есть
    if (pt.cash && pt.cash[0]) sel.value = pt.cash[0].ref;
}

// Шаг 2 → оформление возврата
async function posReturnConfirm() {
    if (POS._return.busy) return;
    const look = POS._return.look;
    if (!look) return;
    const err = document.getElementById('posRetConfirmError');
    const btn = document.getElementById('posRetConfirm');
    if (err) err.style.display = 'none';
    const reasonBtn = document.querySelector('.pos-ret-reason.active');
    const reason = reasonBtn ? reasonBtn.getAttribute('data-reason') : '';
    const refundSel = document.getElementById('posRetRefund');
    const refundPayC1Ref = (refundSel && refundSel.value) || null;
    const sh = POS.shift || {};
    POS._return.busy = true;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Оформляю…'; }
    try {
        const body = {
            clientSaleId: posNewClientSaleId(),   // идемпотентность возврата
            uniqueBarcode: look.barcode,
            kassaC1Ref: POS.chosen.ref,
            sellerC1Ref: sh.seller_c1_ref || sh.seller_ref || sh.sellerC1Ref || null,
            sellerName: sh.seller_name || null,
            reason: reason,
            refundPayC1Ref: refundPayC1Ref,
        };
        // ОНЛАЙН-FIRST с таймаутом; при сбое сети — в очередь.
        let r;
        try {
            r = await posApiTimeout('?action=return-item', { method: 'POST', body: JSON.stringify(body) }, 12000);
        } catch (netErr) {
            if (posIsNetworkError(netErr)) {
                await PosQueue.add({ clientSaleId: body.clientSaleId, action: 'return-item', body, ts: Date.now() });
                posUpdateConnUI();
                const done = document.getElementById('posRetDoneMsg');
                if (done) done.innerHTML = '💾 Слабая связь — возврат <b>сохранён</b> и оформится автоматически, когда появится интернет.<br>' +
                    'Товар «' + posEsc(look.product.name || '') + '» будет возвращён на склад после досылки.';
                POS._return.result = { queued: true, docNumber: '', sum: look.product.price, posted: false, reason: reason };
                posRetShowStep('done');
                if (POS.isMobile && typeof pmobRetDone === 'function') pmobRetDone();
                return;
            }
            throw netErr;
        }
        if (!r.ok || !r.data.ok) throw new Error(r.data.error || ('HTTP ' + r.status));
        const num = r.data.docNumber || '';
        const done = document.getElementById('posRetDoneMsg');
        if (done) done.innerHTML = `✅ Возврат оформлен!<br>Чек-возврат <b>${posEsc(num)}</b><br>` +
            `Товар «${posEsc(look.product.name || '')}» возвращён на склад.<br>` +
            `Сумма к возврату: <b>${posMoney(r.data.sum)} сом</b>` +
            (r.data.posted ? '' : '<br><span style="color:#b45309;">(создан, проведённость проверьте в 1С)</span>');
        POS._return.result = { queued: false, docNumber: num, sum: r.data.sum, posted: !!r.data.posted, reason: reason };
        posUpdateConnUI();
        posRetShowStep('done');
        if (POS.isMobile && typeof pmobRetDone === 'function') pmobRetDone();
    } catch (e) {
        if (err) { err.style.display = 'block'; err.textContent = '⚠️ ' + e.message; }
        if (POS.isMobile && typeof pmobRetFail === 'function') pmobRetFail(e.message);
    } finally {
        POS._return.busy = false;
        if (btn) { btn.disabled = false; btn.textContent = '↩️ Оформить возврат'; }
    }
}

// ============================================================
//  МОБИЛЬНЫЙ UI КАССИРА (#posMobile) — только новая презентация.
//  Бизнес-логика переиспользуется целиком: POS.cart, posHandleScannedCode,
//  posAddToCart, posTotals, posOpenPayment, posSetPayMode, posShowReceipt,
//  posConfirmSale, posOpenReturn, posCloseShift, posStopCamera.
//  ПК-версия РМК (#posStep3 + модали) не меняется.
// ============================================================
const PMOB_CUR = 'с.';

function pmobEl(id) { return document.getElementById(id); }
function pmobMoney(n) { return posMoney(n) + ' ' + PMOB_CUR; }

function pmobPlural(n, one, few, many) {
    const t = Math.abs(Math.round(Number(n) || 0)) % 100;
    const d = t % 10;
    if (t > 10 && t < 20) return many;
    if (d > 1 && d < 5) return few;
    if (d === 1) return one;
    return many;
}

function pmobCartQty() {
    return POS.cart.reduce((s, l) => s + (Number(l.qty) || 0), 0);
}

// Мобильный интерфейс активен: телефон + открыта вкладка «Касса» + есть смена.
function pmobActive() {
    if (!POS.isMobile || POS.mobDesktopView) return false;
    const sec = document.getElementById('posSection');
    if (!sec || !sec.classList.contains('active')) return false;
    return !!POS.shift;
}

// Показать/скрыть оверлей. Вызывается из posShowStep / posEnterSalesArea / switchTab.
function pmobApply() {
    const ov = pmobEl('posMobile');
    if (!ov) return;
    const on = pmobActive();
    const step3 = pmobEl('posStep3');
    ov.style.display = on ? '' : 'none';
    document.body.classList.toggle('pmob-on', on);
    if (on) {
        if (step3) {
            if (POS.mobStep3Disp === null) POS.mobStep3Disp = step3.style.display;
            step3.style.display = 'none';
        }
        if (!POS.mobScreen) POS.mobScreen = 'cart';
        pmobShow(POS.mobScreen);
    } else {
        const scan = pmobEl('pmobScreenScan');
        if (scan) scan.style.display = 'none';
        // возвращаем ПК-РМК ровно в то состояние, в котором его застали
        if (step3 && POS.mobStep3Disp !== null) { step3.style.display = POS.mobStep3Disp; POS.mobStep3Disp = null; }
    }
    pmobRestoreBtn(!!(POS.isMobile && POS.shift && POS.mobDesktopView));
}

// Плавающая кнопка «вернуться в мобильную кассу» из классического вида.
function pmobRestoreBtn(show) {
    let b = pmobEl('pmobRestore');
    if (!show) { if (b) b.remove(); return; }
    if (b) return;
    b = document.createElement('button');
    b.id = 'pmobRestore';
    b.type = 'button';
    b.className = 'pmob-restore';
    b.textContent = '📱 Мобильная касса';
    b.addEventListener('click', () => { POS.mobDesktopView = false; pmobApply(); });
    document.body.appendChild(b);
}

// Экраны оверлея и то, какая кнопка нижней навигации для них активна.
const PMOB_SCREENS = {
    cart: 'pmobScreenCart',
    pay: 'pmobScreenPay',
    more: 'pmobScreenMore',
    card: 'pmobScreenCard',
    doctor: 'pmobScreenDoctor',
    search: 'pmobScreenSearch',
    return: 'pmobScreenReturn',
    retitem: 'pmobScreenRetItem',
    retdone: 'pmobScreenRetDone',
};
const PMOB_NAV_OF = {
    cart: 'cart', card: 'cart', doctor: 'cart', pay: 'pay', more: 'more', search: 'more',
    return: 'return', retitem: 'return', retdone: 'return',
};

function pmobShow(screen) {
    if (!PMOB_SCREENS[screen]) screen = 'cart';
    POS.mobScreen = screen;
    Object.keys(PMOB_SCREENS).forEach(k => {
        const el = pmobEl(PMOB_SCREENS[k]);
        if (el) el.style.display = (k === screen) ? '' : 'none';
    });
    const navKey = PMOB_NAV_OF[screen] || 'cart';
    const nav = pmobEl('pmobNav');
    if (nav) {
        nav.classList.toggle('ret', navKey === 'return');
        nav.querySelectorAll('.pmob-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.pmob === navKey));
    }
    pmobRender();
}

function pmobUpdateFoot() {
    const ov = pmobEl('posMobile');
    const foot = pmobEl('pmobFoot');
    const show = POS.mobScreen === 'cart' && POS.cart.length > 0;
    if (foot) foot.style.display = show ? '' : 'none';
    if (ov) ov.classList.toggle('has-foot', show);
}

function pmobRender() {
    if (!POS.isMobile) return;
    const ov = pmobEl('posMobile');
    if (!ov || ov.style.display === 'none') return;
    const sh = POS.shift || {};
    const t = posTotals();
    const qty = pmobCartQty();

    // продавец и статус смены есть на нескольких экранах — заполняем по классу
    const sellerTxt = sh.seller_name || '—';
    const statusTxt = 'Смена открыта' + (sh.kassa_name ? ' · ' + sh.kassa_name : '');
    ov.querySelectorAll('.pmob-seller-name').forEach(e => { e.textContent = sellerTxt; });
    ov.querySelectorAll('.pmob-shift-text').forEach(e => { e.textContent = statusTxt; });

    const cnt = pmobEl('pmobCartCount');
    if (cnt) cnt.textContent = qty + ' ' + pmobPlural(qty, 'товар', 'товара', 'товаров');
    const sum = pmobEl('pmobCartSum');
    if (sum) sum.textContent = pmobMoney(t.grand);
    const tot = pmobEl('pmobTotal');
    if (tot) tot.textContent = pmobMoney(t.grand);
    const grand = pmobEl('pmobPayGrand');
    if (grand) grand.textContent = pmobMoney(t.grand);

    const toPay = pmobEl('pmobToPay');
    if (toPay) toPay.disabled = !POS.cart.length || posCartHasOutOfStock();

    const discItem = pmobEl('pmobMoreDisc');
    const discState = pmobEl('pmobDiscState');
    const discOn = (POS.cartDiscountPct || 0) >= 5;
    if (discState) discState.textContent = discOn ? 'вкл' : 'выкл';
    if (discItem) discItem.classList.toggle('on', discOn);

    const meta = pmobEl('pmobMoreMeta');
    if (meta) {
        const opened = sh.opened_at ? new Date(sh.opened_at).toLocaleString('ru-RU') : '—';
        meta.innerHTML = `Касса: <b>${posEsc(sh.kassa_name || '—')}</b><br>` +
            `Продавец: <b>${posEsc(sh.seller_name || '—')}</b><br>Смена открыта: ${posEsc(opened)}`;
    }
    pmobRenderLines();
    pmobRenderClient();
    pmobRenderDoctor();
    pmobRenderCard();
    pmobUpdateFoot();
}

function pmobRenderLines() {
    const box = pmobEl('pmobLines');
    if (!box) return;
    if (!POS.cart.length) {
        box.innerHTML = '<div class="pmob-empty">Чек пуст — отсканируйте товар.</div>';
        return;
    }
    box.innerHTML = '';
    POS.cart.forEach(l => {
        const oos = posLineOutOfStock(l);
        const scans = Array.isArray(l.scans) ? l.scans : [];
        const code = scans.length ? String(scans[scans.length - 1]).slice(-6) : (l.barcode ? String(l.barcode).slice(-6) : '');
        const parts = [];
        if (l.sizeLabel) parts.push('Размер: ' + l.sizeLabel);
        if (code) parts.push('№ ' + code);
        const warn = l.warning || (oos ? 'Не числится на складе этой кассы' : '');
        const hasDisc = (l.discountPct || 0) >= 5;
        const di = posLineDiscInfo(l);
        // Фактический % скидки (после округления вниз): 1 знак, без лишнего .0
        const realPct = di.pct % 1 === 0 ? String(Math.round(di.pct)) : di.pct.toFixed(1);
        const row = document.createElement('div');
        row.className = 'pmob-line' + (oos ? ' oos' : '');
        // Количество = число отсканированных штрихкодов (только чтение, без степпера).
        row.innerHTML = `
            <div class="pmob-line-info">
              <div class="pmob-line-name">${posEsc(l.name)}</div>
              ${parts.length ? `<div class="pmob-line-sub">${posEsc(parts.join(' | '))}</div>` : ''}
              ${warn ? `<div class="pmob-line-warn">⚠️ ${posEsc(warn)}</div>` : ''}
              <button type="button" class="pmob-line-disc${hasDisc ? ' on' : ''}"
                      title="Скидка 5% на эту позицию (с округлением вниз до 10)">${hasDisc ? '−5%' : '5%'}</button>
              ${hasDisc ? `<div class="pmob-line-discinfo">Скидка: −${pmobMoney(di.amount)} · ${realPct}%</div>` : ''}
            </div>
            <div class="pmob-line-right">
              <div class="pmob-line-price">${pmobMoney(di.net)}</div>
              ${hasDisc ? `<div class="pmob-line-old">${pmobMoney(di.gross)}</div>` : ''}
              <div class="pmob-line-qty">${l.qty} шт.</div>
            </div>
            <button type="button" class="pmob-line-rm" aria-label="Удалить позицию">×</button>`;
        row.querySelector('.pmob-line-rm').addEventListener('click', () => posRemoveLine(l.key));
        row.querySelector('.pmob-line-disc').addEventListener('click', () => pmobToggleLineDisc(l.key));
        box.appendChild(row);
    });
}

// Скидка 5% на КОНКРЕТНУЮ позицию (повторное нажатие снимает).
function pmobToggleLineDisc(key) {
    const l = POS.cart.find(x => x.key === key);
    if (!l) return;
    l.discountPct = (l.discountPct || 0) >= 5 ? 0 : 5;
    POS.activeKey = key;
    posRenderCart();   // общая перерисовка: ПК-корзина + итоги + мобильный список
}

// ── Дисконтная карта покупателя ──
function pmobCardMask() {
    const c = POS.client || {};
    const last4 = String(c.card_code || POS.mobCardCode || '').replace(/\s+/g, '').slice(-4);
    return '**** ' + (last4 || '————');
}

function pmobRenderClient() {
    const bar = pmobEl('pmobClientBar');
    if (!bar) return;
    const c = POS.client;
    const title = pmobEl('pmobClientTitle');
    const sub = pmobEl('pmobClientSub');
    const rm = pmobEl('pmobClientRm');
    bar.classList.toggle('on', !!c);
    if (c) {
        if (title) title.textContent = 'Дисконтная карта ' + pmobCardMask();
        if (sub) sub.textContent = 'Скидка ' + (Number(c.discount_pct) || 10) + '% · ' + (c.full_name || 'покупатель');
        if (rm) rm.style.display = '';
    } else {
        if (title) title.textContent = 'Применить скидку покупателя';
        if (sub) sub.textContent = 'Отсканируйте штрихкод карты';
        if (rm) rm.style.display = 'none';
    }
}

function pmobRenderCard() {
    const num = pmobEl('pmobCardNum');
    if (!num) return;
    const c = POS.client;
    const t = posTotals();
    num.textContent = pmobCardMask();
    const set = (id, v) => { const e = pmobEl(id); if (e) e.textContent = v; };
    set('pmobCardPct', (c ? (Number(c.discount_pct) || 10) : 0) + '%');
    set('pmobCardDiscTop', '−' + pmobMoney(t.disc));
    set('pmobCardGross', pmobMoney(t.gross));
    set('pmobCardDisc', '−' + pmobMoney(t.disc));
    set('pmobCardGrand', pmobMoney(t.grand));
    const who = pmobEl('pmobCardWho');
    if (who) who.textContent = c ? ('Покупатель: ' + (c.full_name || '—')) : '';
}

// Скан карты → общая логика posLookupClient (скидка идёт через POS.client → posCartDiscPct).
async function pmobCardHandleCode(code) {
    const c = String(code || '').trim();
    if (c.length < 3) { pmobToast('Некорректный код карты', c, true); return; }
    POS.client = null;
    POS.mobCardCode = c;
    await posLookupClient(c);
    if (POS.client) {
        const scr = pmobEl('pmobScreenScan');
        if (scr) scr.style.display = 'none';
        pmobCloseScan();
        pmobShow('card');
        pmobToast('Скидка по карте применена', 'Скидка ' + (Number(POS.client.discount_pct) || 10) + '%');
    } else {
        POS.mobCardCode = null;
        pmobToast('Карта не найдена', c, true);
    }
}

function pmobRemoveClient() {
    POS.client = null;
    POS.mobCardCode = null;
    posRenderCart();
    pmobShow('cart');
    pmobToast('Скидка по карте снята', '');
}

// ── Врач (ВР) — привязка к чеку по номеру или имени/фамилии ──
// Зеркалит десктопную логику posSearchCard('doctor') / posChooseDoctor → POS.doctor.
function pmobRenderDoctor() {
    const bar = pmobEl('pmobDoctorBar');
    if (!bar) return;
    const d = POS.doctor;
    const title = pmobEl('pmobDoctorTitle');
    const sub = pmobEl('pmobDoctorSub');
    const rm = pmobEl('pmobDoctorRm');
    bar.classList.toggle('on', !!d);
    if (d) {
        if (title) title.textContent = 'Врач: ' + (d.full_name || '—');
        if (sub) sub.textContent = 'Код ' + (d.card_code || '—');
        if (rm) rm.style.display = '';
    } else {
        if (title) title.textContent = 'Применить врача';
        if (sub) sub.textContent = 'Номер или имя/фамилия врача';
        if (rm) rm.style.display = 'none';
    }
}

// Открыть экран выбора врача
function pmobOpenDoctor() {
    pmobShow('doctor');
    const inp = pmobEl('pmobDocInput');
    const sug = pmobEl('pmobDocSug');
    const rmBtn = pmobEl('pmobDocRemove');
    if (sug) sug.innerHTML = '';
    if (rmBtn) rmBtn.style.display = POS.doctor ? '' : 'none';
    pmobRenderDocChosen();
    if (inp) { inp.value = ''; setTimeout(() => { try { inp.focus(); } catch (_) {} }, 60); }
}

// Живой поиск по буквам (и имя, и фамилия) или по номеру/коду
var pmobDocSearchT = null;
function pmobDocInputHandler(e) {
    const q = (e.target.value || '').trim();
    clearTimeout(pmobDocSearchT);
    const sug = pmobEl('pmobDocSug');
    if (q.length < 2) { if (sug) sug.innerHTML = ''; return; }
    pmobDocSearchT = setTimeout(() => pmobDocSearch(q), 260);
}

async function pmobDocSearch(q) {
    const sug = pmobEl('pmobDocSug');
    if (!sug) return;
    sug.innerHTML = '<div class="pmob-sug-empty">Поиск…</div>';
    try {
        const r = await posApi(`?action=card&type=doctor&q=${encodeURIComponent(q)}`, { method: 'GET' });
        const cards = (r.data && r.data.cards) || [];
        if (!cards.length) { sug.innerHTML = '<div class="pmob-sug-empty">Ничего не найдено</div>'; return; }
        sug.innerHTML = '';
        cards.forEach(c => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'pmob-sug-item';
            b.innerHTML = `<b>${posEsc(c.full_name || '—')}</b><i>код ${posEsc(c.card_code || '—')}</i>`;
            b.onclick = () => pmobChooseDoctor(c);
            sug.appendChild(b);
        });
    } catch (_) {
        sug.innerHTML = '<div class="pmob-sug-empty">Ошибка поиска</div>';
    }
}

function pmobChooseDoctor(c) {
    POS.doctor = c;
    const inp = pmobEl('pmobDocInput');
    const sug = pmobEl('pmobDocSug');
    if (inp) inp.value = '';
    if (sug) sug.innerHTML = '';
    pmobRenderDocChosen();
    const rmBtn = pmobEl('pmobDocRemove');
    if (rmBtn) rmBtn.style.display = '';
    pmobRenderDoctor();
    pmobToast('Врач применён', (c.full_name || '') + (c.card_code ? ' · код ' + c.card_code : ''));
}

function pmobRenderDocChosen() {
    const box = pmobEl('pmobDocChosen');
    if (!box) return;
    const d = POS.doctor;
    if (!d) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = '';
    box.innerHTML = `<span class="pmob-doc-chosen-ico">🩺</span>
        <span class="pmob-doc-chosen-txt"><b>${posEsc(d.full_name || '—')}</b><i>Код ${posEsc(d.card_code || '—')}</i></span>`;
}

function pmobRemoveDoctor() {
    POS.doctor = null;
    pmobRenderDocChosen();
    const rmBtn = pmobEl('pmobDocRemove');
    if (rmBtn) rmBtn.style.display = 'none';
    pmobRenderDoctor();
    pmobToast('Врач убран', '');
}

// ── Экран 2: сканирование (один экран на три режима: чек / возврат / карта) ──
async function pmobOpenScan(mode) {
    POS.mobCamMode = (mode === 'return' || mode === 'card') ? mode : 'cart';
    const scr = pmobEl('pmobScreenScan');
    if (scr) { scr.style.display = ''; scr.classList.toggle('ret', POS.mobCamMode === 'return'); }
    const ttl = pmobEl('pmobCamTitle');
    if (ttl) ttl.textContent = POS.mobCamMode === 'card' ? 'Сканирование карты' : 'Сканирование';
    const cap = pmobEl('pmobCamCap');
    if (cap) {
        cap.textContent = POS.mobCamMode === 'card'
            ? 'Наведите камеру на штрихкод дисконтной карты'
            : 'Наведите камеру на штрихкод товара';
    }
    await pmobStartCamera();
}

function pmobDispatchScan(code) {
    if (POS.mobCamMode === 'return') return pmobRetHandleCode(code);
    if (POS.mobCamMode === 'card') return pmobCardHandleCode(code);
    return posHandleScannedCode(code);
}

async function pmobStartCamera() {
    const cap = pmobEl('pmobCamCap');
    if (!window.Html5Qrcode) {
        if (cap) cap.textContent = 'Библиотека сканера не загрузилась — обновите страницу.';
        return;
    }
    if (POS.camOn) await posStopCamera();
    try {
        POS.html5qr = new Html5Qrcode('pmobReader', { verbose: false });
        const cfg = { fps: 10, qrbox: { width: 260, height: 160 } };
        // Форматы указываем ТОЛЬКО если библиотека их экспортирует.
        // Если Html5QrcodeSupportedFormats недоступен (гонка загрузки скрипта) —
        // запускаем БЕЗ ограничения (авто-детект всех символик), а не падаем.
        // Расширенный список: карты/этикетки могут быть не только EAN/CODE_128.
        if (typeof Html5QrcodeSupportedFormats !== 'undefined' && Html5QrcodeSupportedFormats) {
            const F = Html5QrcodeSupportedFormats;
            cfg.formatsToSupport = [
                F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E,
                F.CODE_128, F.CODE_39, F.CODE_93, F.ITF, F.CODABAR, F.QR_CODE,
            ].filter(v => v !== undefined);
        }
        await POS.html5qr.start(
            { facingMode: POS.mobFacing || 'environment' },
            cfg,
            (decodedText) => {
                // один код за раз: пауза до окончания обработки, чтобы не задвоить экземпляр
                if (POS.mobScanBusy) return;
                POS.mobScanBusy = true;
                try { if (POS.html5qr && POS.html5qr.pause) POS.html5qr.pause(true); } catch (_) {}
                Promise.resolve(pmobDispatchScan(decodedText)).catch(() => {}).then(() => {
                    POS.mobScanBusy = false;
                    const s = pmobEl('pmobScreenScan');
                    if (POS.camOn && POS.html5qr && s && s.style.display !== 'none') {
                        try { POS.html5qr.resume(); } catch (_) {}
                    }
                });
            },
            () => {}
        );
        POS.camOn = true;
    } catch (e) {
        if (cap) cap.textContent = 'Не удалось запустить камеру: ' + ((e && e.message) || e);
    }
}

async function pmobCloseScan() {
    POS.mobScanBusy = false;
    await posStopCamera();
    pmobResetTorchBtn();
    const scr = pmobEl('pmobScreenScan');
    if (scr) scr.style.display = 'none';
    POS.mobCamMode = 'cart';
}

function pmobResetTorchBtn() {
    POS.mobTorch = false;
    const t = pmobEl('pmobTorch');
    if (t) t.classList.remove('on');
}

async function pmobFlipCamera() {
    POS.mobFacing = (POS.mobFacing === 'user') ? 'environment' : 'user';
    pmobResetTorchBtn();
    await posStopCamera();
    await pmobStartCamera();
}

async function pmobToggleTorch() {
    if (!POS.camOn || !POS.html5qr) return;
    const want = !POS.mobTorch;
    try {
        await POS.html5qr.applyVideoConstraints({ advanced: [{ torch: want }] });
        POS.mobTorch = want;
        const t = pmobEl('pmobTorch');
        if (t) t.classList.toggle('on', want);
    } catch (_) {
        const cap = pmobEl('pmobCamCap');
        if (cap) cap.textContent = 'Вспышка недоступна на этом устройстве.';
    }
}

// Товар успешно добавлен: камера закрывается, показываем зелёный попап, уходим в чек.
function pmobScanSuccess() {
    if (!POS.isMobile) return;
    const qty = pmobCartQty();
    const t = posTotals();
    POS.mobScanBusy = false;
    posStopCamera();
    pmobResetTorchBtn();
    const scr = pmobEl('pmobScreenScan');
    if (scr) scr.style.display = 'none';
    pmobShow('cart');
    pmobToast('Товар добавлен в чек',
        qty + ' ' + pmobPlural(qty, 'товар', 'товара', 'товаров') + ' на сумму ' + pmobMoney(t.grand));
}

function pmobToast(title, sub, isError) {
    const el = pmobEl('pmobToast');
    if (!el) return;
    const t = pmobEl('pmobToastTitle');
    if (t) t.textContent = title;
    const s = pmobEl('pmobToastSub');
    if (s) s.textContent = sub || '';
    const ico = el.querySelector('.pmob-toast-ico');
    if (ico) ico.textContent = isError ? '!' : '✓';
    el.classList.toggle('err', !!isError);
    el.classList.add('show');
    clearTimeout(POS.mobToastTimer);
    POS.mobToastTimer = setTimeout(() => el.classList.remove('show'), isError ? 2600 : 1600);
}

// ── Экран 4: оплата (виды оплат — наши, из 1С) ──
async function pmobOpenPay() {
    const err = pmobEl('pmobPayError');
    if (err) err.style.display = 'none';
    if (!POS.cart.length) {
        pmobShow('cart');
        pmobToast('Чек пуст', 'Сначала отсканируйте товар', true);
        return;
    }
    if (posCartHasOutOfStock()) {
        pmobShow('cart');
        pmobToast('Продажа невозможна', 'В чеке есть товар не со склада этой кассы', true);
        return;
    }
    await posOpenPayment();                        // грузит POS.paytypes (общая логика)
    const modal = pmobEl('posPayModal');
    if (modal) modal.style.display = 'none';       // ПК-модаль на мобиле не показываем
    pmobCloseMix();                                // сброс панели смешанной оплаты
    pmobRenderPayList();
    pmobShow('pay');
}

function pmobPayIcon(name) {
    const n = String(name || '').toLowerCase();
    if (/налич|cash/.test(n)) return '💵';
    if (/qr|alif|алиф/.test(n)) return '📱';
    return '💳';
}

function pmobRenderPayList() {
    const box = pmobEl('pmobPayList');
    if (!box) return;
    const pt = POS.paytypes || {};
    const cash = pt.cash || [];
    const cards = pt.cards || [];
    box.innerHTML = '';
    if (!cash.length && !cards.length) {
        box.innerHTML = '<div class="pmob-empty">Виды оплаты не загрузились. Проверьте связь и попробуйте снова.</div>';
        return;
    }
    const add = (title, sub, mode, ref, extraClass) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pmob-pay-item' + (extraClass ? ' ' + extraClass : '');
        b.innerHTML = `<span class="pmob-pay-ico">${pmobPayIcon(title)}</span>` +
            `<span class="pmob-pay-name">${posEsc(title)}` +
            (sub ? `<span class="pmob-pay-sub">${posEsc(sub)}</span>` : '') + `</span>` +
            `<span class="pmob-chev">›</span>`;
        b.addEventListener('click', () => pmobPickPay(mode, ref));
        box.appendChild(b);
    };
    cash.forEach(c => add(c.name || 'Наличными', 'Оплата наличными', 'cash', c.ref, 'cash'));
    cards.forEach(c => add(c.name, 'Электронная оплата', 'card', c.ref));
    // Смешанная оплата доступна, если есть и наличные, и хотя бы одна карта.
    if (cash.length && cards.length) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pmob-pay-item mixed';
        b.innerHTML = `<span class="pmob-pay-ico">🔀</span>` +
            `<span class="pmob-pay-name">Смешанная оплата` +
            `<span class="pmob-pay-sub">Наличные + остаток картой</span></span>` +
            `<span class="pmob-chev">›</span>`;
        b.addEventListener('click', () => pmobOpenMix());
        box.appendChild(b);
    }
}

// Открыть панель смешанной оплаты.
function pmobOpenMix() {
    const err = pmobEl('pmobPayError');
    if (err) err.style.display = 'none';
    // Заполняем список карт для остатка (переиспользуем ПК-элементы + мобильный select).
    posPopulateCardSelects();
    const sel = pmobEl('pmobMixCard');
    const cards = (POS.paytypes && POS.paytypes.cards) || [];
    if (sel) {
        sel.innerHTML = '';
        cards.forEach(c => {
            const o = document.createElement('option');
            o.value = c.ref; o.textContent = c.name;
            sel.appendChild(o);
        });
    }
    const cashInput = pmobEl('pmobMixCash');
    if (cashInput) cashInput.value = '';
    const list = pmobEl('pmobPayList');
    if (list) list.style.display = 'none';
    const panel = pmobEl('pmobMixPanel');
    if (panel) panel.style.display = 'block';
    pmobMixRecalc();
    if (cashInput) setTimeout(() => cashInput.focus(), 60);
}

// Закрыть панель, вернуться к списку способов.
function pmobCloseMix() {
    const panel = pmobEl('pmobMixPanel');
    if (panel) panel.style.display = 'none';
    const list = pmobEl('pmobPayList');
    if (list) list.style.display = '';
    const err = pmobEl('pmobPayError');
    if (err) err.style.display = 'none';
}

// Пересчёт остатка картой = К оплате − наличные.
function pmobMixRecalc() {
    const t = posTotals();
    const cash = Math.round(Number((pmobEl('pmobMixCash') || {}).value) || 0);
    const rest = t.grand - cash;
    const restEl = pmobEl('pmobMixRest');
    if (restEl) {
        if (cash <= 0) restEl.textContent = 'Остаток картой: ' + pmobMoney(t.grand);
        else if (cash >= t.grand) restEl.textContent = 'Наличные покрывают весь чек — выберите «Наличными»';
        else restEl.textContent = 'Остаток картой: ' + pmobMoney(rest);
        restEl.classList.toggle('warn', cash >= t.grand);
    }
}

// Подтвердить смешанную оплату → переиспользуем ПК-логику posBuildPayments('mixed').
function pmobConfirmMix() {
    const t = posTotals();
    const cash = Math.round(Number((pmobEl('pmobMixCash') || {}).value) || 0);
    const cardRef = (pmobEl('pmobMixCard') || {}).value || '';
    const err = pmobEl('pmobPayError');
    const showErr = (m) => { if (err) { err.style.display = 'block'; err.textContent = '⚠️ ' + m; } };
    if (cash <= 0) { showErr('Укажите сумму наличными'); return; }
    if (cash >= t.grand) { showErr('Наличные покрывают весь чек — выберите «Наличными»'); return; }
    if (!cardRef) { showErr('Выберите карту для остатка'); return; }
    // Пишем значения в ПК-элементы, которые читает posBuildPayments (mixed).
    const mc = pmobEl('posMixCash'); if (mc) mc.value = String(cash);
    const mct = pmobEl('posMixCardType'); if (mct) mct.value = cardRef;
    posSetPayMode('mixed');
    if (err) err.style.display = 'none';
    posShowReceipt();
    // Если posShowReceipt выставил ошибку в ПК-поле — продублируем в мобильное.
    const perr = pmobEl('posPayError');
    if (perr && perr.style.display !== 'none' && perr.textContent) { showErr(perr.textContent.replace(/^⚠️\s*/, '')); }
}

// Выбор способа → существующий flow: posSetPayMode → чек-сверка → posConfirmSale.
function pmobPickPay(mode, ref) {
    const err = pmobEl('pmobPayError');
    if (err) err.style.display = 'none';
    posSetPayMode(mode);
    if (mode === 'card') {
        posPopulateCardSelects();
        const sel = pmobEl('posCardType');
        if (sel && ref) sel.value = ref;
    } else {
        const cg = pmobEl('posCashGiven');
        if (cg) cg.value = '';
    }
    posShowReceipt();
    const perr = pmobEl('posPayError');
    if (perr && perr.style.display !== 'none' && perr.textContent && err) {
        err.style.display = 'block';
        err.textContent = perr.textContent;
    }
}

// Чек проведён (или ушёл в офлайн-очередь) — начинаем новый.
function pmobAfterSale() {
    if (!POS.isMobile) return;
    const ov = pmobEl('posMobile');
    if (!ov || ov.style.display === 'none') return;
    pmobShow('cart');
    pmobToast('Чек закрыт', 'Можно начинать новый чек');
}

// ============================================================
//  ВОЗВРАТ — нативные мобильные экраны (4 шага, красная тема).
//  Вся логика — существующие posReturnFind / posReturnConfirm,
//  данные — POS._return.look / POS._return.result.
// ============================================================

// posOpenReturn() уже сбросил POS._return и открыл ПК-модаль — прячем её и рисуем своё.
function pmobReturnOpened() {
    if (!POS.isMobile) return;
    const m = pmobEl('posReturnModal');
    if (m) m.style.display = 'none';
    const ov = pmobEl('posMobile');
    if (!ov || ov.style.display === 'none') return;
    const err = pmobEl('pmobRetError');
    if (err) { err.style.display = 'none'; err.textContent = ''; }
    const rc = pmobEl('pmobRetReceipt');
    if (rc) { rc.style.display = 'none'; rc.innerHTML = ''; }
    pmobEnsurePaytypes();
    pmobShow('return');
}

// Способы возврата средств берутся из POS.paytypes — подгружаем, не открывая модаль оплаты.
async function pmobEnsurePaytypes() {
    if (POS.paytypes) return;
    try {
        const shop = encodeURIComponent((POS.chosen && POS.chosen.shopRef) || '');
        const r = await posApi(`?action=paytypes&shop=${shop}`, { method: 'GET' });
        if (r.ok && r.data.ok) POS.paytypes = r.data.paytypes;
    } catch (_) { /* — */ }
    if (POS.paytypes && (POS._return && POS._return.look)) {
        posRetFillRefundOptions(POS._return.look);
        pmobFillRetRefund();
    }
}

// Скан штрихкода в режиме возврата → существующий posReturnFind (он вызовет pmobRetFound/pmobRetLookupFail).
async function pmobRetHandleCode(code) {
    const c = String(code || '').trim();
    if (c.length < 6) { pmobToast('Некорректный штрихкод', c, true); return; }
    if (!POS._return) POS._return = { look: null, busy: false };
    POS._return.look = null;
    const inp = pmobEl('posRetScanInput');
    if (inp) inp.value = c;
    await posReturnFind();
}

function pmobRetFound() {
    if (!POS.isMobile) return;
    const m = pmobEl('posReturnModal');
    if (m) m.style.display = 'none';
    // экран камеры гасим синхронно, чтобы колбэк декодера не сделал resume()
    const scr = pmobEl('pmobScreenScan');
    if (scr) scr.style.display = 'none';
    pmobCloseScan();
    pmobFillRetReason();
    pmobFillRetRefund();
    pmobRenderRetItem();
    const err = pmobEl('pmobRetError');
    if (err) { err.style.display = 'none'; err.textContent = ''; }
    pmobShow('retitem');
}

function pmobRetLookupFail(msg) {
    if (!POS.isMobile) return;
    pmobToast('Возврат невозможен', msg || 'Экземпляр не найден', true);
}

// Причины — из ПК-кнопок .pos-ret-reason (единый источник, без дублей).
function pmobFillRetReason() {
    const sel = pmobEl('pmobRetReason');
    if (!sel) return;
    const btns = Array.from(document.querySelectorAll('.pos-ret-reason'));
    sel.innerHTML = '';
    if (!btns.length) {
        sel.innerHTML = '<option value="">Обмен</option>';
        return;
    }
    btns.forEach(b => {
        const o = document.createElement('option');
        o.value = b.getAttribute('data-reason') || '';
        o.textContent = (b.textContent || '').trim();
        sel.appendChild(o);
    });
    const act = document.querySelector('.pos-ret-reason.active');
    if (act) sel.value = act.getAttribute('data-reason') || '';
}

// Способ возврата — зеркалим уже заполненный posRetFillRefundOptions селект.
function pmobFillRetRefund() {
    const src = pmobEl('posRetRefund');
    const dst = pmobEl('pmobRetRefund');
    if (!dst) return;
    if (!src || !src.options.length) {
        dst.innerHTML = '<option value="">Наличные (по умолчанию)</option>';
        return;
    }
    dst.innerHTML = src.innerHTML;
    dst.value = src.value;
}

function pmobRenderRetItem() {
    const look = (POS._return && POS._return.look) || null;
    const box = pmobEl('pmobRetCard');
    if (!box) return;
    if (!look) { box.innerHTML = '<div class="pmob-empty">Товар не выбран</div>'; return; }
    const bc = String(look.barcode || '');
    const tail = bc.length > 6 ? bc.slice(-6) : bc;
    box.innerHTML =
        `<div class="pmob-ret-name">${posEsc(look.product.name || 'Товар')}</div>` +
        (look.unit && look.unit.sizeLabel ? `<div class="pmob-ret-row"><span>Размер</span><b>${posEsc(String(look.unit.sizeLabel).replace(/^размер:\s*/i, ''))}</b></div>` : '') +
        `<div class="pmob-ret-row"><span>Штрихкод</span><b>№ ${posEsc(tail)}</b></div>` +
        `<div class="pmob-ret-row"><span>Цена</span><b>${pmobMoney(look.product.price)}</b></div>` +
        `<div class="pmob-ret-row"><span>Количество</span><b>1 шт.</b></div>` +
        (look.sale && look.sale.receiptNumber ? `<div class="pmob-ret-row"><span>Чек продажи</span><b>${posEsc(look.sale.receiptNumber)}</b></div>` : '');
    const sum = pmobEl('pmobRetSum');
    if (sum) sum.textContent = pmobMoney(look.product.price);
}

// Подтверждение: переносим выбор в ПК-контролы и вызываем общий posReturnConfirm.
async function pmobRetConfirm() {
    const look = (POS._return && POS._return.look) || null;
    if (!look) { pmobShow('return'); return; }
    const err = pmobEl('pmobRetError');
    if (err) { err.style.display = 'none'; err.textContent = ''; }
    const rSel = pmobEl('pmobRetReason');
    if (rSel) {
        const want = rSel.value;
        document.querySelectorAll('.pos-ret-reason').forEach(b => {
            b.classList.toggle('active', (b.getAttribute('data-reason') || '') === want);
        });
    }
    const fSel = pmobEl('pmobRetRefund');
    const pcSel = pmobEl('posRetRefund');
    if (fSel && pcSel) pcSel.value = fSel.value;
    const btn = pmobEl('pmobRetConfirmBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Оформляю…'; }
    try {
        await posReturnConfirm();
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Подтвердить возврат'; }
    }
}

function pmobRetDone() {
    if (!POS.isMobile) return;
    const m = pmobEl('posReturnModal');
    if (m) m.style.display = 'none';
    const res = (POS._return && POS._return.result) || {};
    const sum = pmobEl('pmobRetDoneSum');
    if (sum) sum.textContent = pmobMoney(res.sum || 0);
    const note = pmobEl('pmobRetDoneNote');
    if (note) {
        if (res.queued) {
            note.innerHTML = '💾 Слабая связь — возврат <b>сохранён</b> и оформится автоматически, когда появится интернет.';
        } else {
            note.innerHTML = (res.docNumber ? 'Чек-возврат <b>' + posEsc(res.docNumber) + '</b><br>' : '') +
                (res.posted ? 'Товар возвращён на склад.' : 'Создан — проведённость проверьте в 1С.');
        }
    }
    const rc = pmobEl('pmobRetReceipt');
    if (rc) { rc.style.display = 'none'; rc.innerHTML = ''; }
    pmobShow('retdone');
}

function pmobRetFail(msg) {
    if (!POS.isMobile) return;
    const err = pmobEl('pmobRetError');
    if (err) { err.style.display = 'block'; err.textContent = '⚠️ ' + (msg || 'Ошибка возврата'); }
    pmobShow('retitem');
}

// Чек возврата из данных POS._return (готового механизма печати чеков в РМК нет).
function pmobRetReceiptHtml() {
    const look = (POS._return && POS._return.look) || {};
    const res = (POS._return && POS._return.result) || {};
    const sh = POS.shift || {};
    const p = look.product || {};
    const u = look.unit || {};
    const row = (a, b) => `<div class="pmob-rcpt-row"><span>${posEsc(a)}</span><span>${posEsc(b)}</span></div>`;
    return '<div class="pmob-rcpt-row" style="justify-content:center;"><b>ЧЕК ВОЗВРАТА</b></div>' +
        '<div class="pmob-rcpt-hr"></div>' +
        row('Документ', res.docNumber || (res.queued ? 'в очереди на отправку' : '—')) +
        row('Дата', new Date().toLocaleString('ru-RU')) +
        row('Касса', sh.kassa_name || '—') +
        row('Продавец', sh.seller_name || '—') +
        '<div class="pmob-rcpt-hr"></div>' +
        `<div class="pmob-rcpt-row"><span>${posEsc(p.name || 'Товар')}</span></div>` +
        (u.sizeLabel ? row('Размер', String(u.sizeLabel).replace(/^размер:\s*/i, '')) : '') +
        row('Штрихкод', look.barcode || '—') +
        row('Количество', '1 шт.') +
        (res.reason ? row('Причина', res.reason) : '') +
        (look.sale && look.sale.receiptNumber ? row('Чек продажи', look.sale.receiptNumber) : '') +
        '<div class="pmob-rcpt-hr"></div>' +
        `<div class="pmob-rcpt-row pmob-rcpt-grand"><span>К возврату</span><span>${posEsc(pmobMoney(res.sum || p.price || 0))}</span></div>`;
}

function pmobRetToggleReceipt() {
    const rc = pmobEl('pmobRetReceipt');
    if (!rc) return;
    if (rc.style.display === 'none' || !rc.innerHTML) {
        rc.innerHTML = pmobRetReceiptHtml();
        rc.style.display = 'block';
    } else {
        rc.style.display = 'none';
    }
}

function pmobRetPrint() {
    const area = pmobEl('pmobPrintArea');
    if (!area) { window.print(); return; }
    area.innerHTML = '<div class="pmob-rcpt">' + pmobRetReceiptHtml() + '</div>';
    document.body.classList.add('pmob-printing');
    let done = false;
    const cleanup = () => {
        if (done) return;
        done = true;
        document.body.classList.remove('pmob-printing');
        area.innerHTML = '';
        window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => { try { window.print(); } catch (_) {} }, 60);
    setTimeout(cleanup, 1500);   // страховка, если afterprint не придёт
}

// ============================================================
//  ПОИСК ТОВАРА (раздел «Ещё») — справочные остатки по складам.
//  Только чтение из Supabase OrtoBot, в чек ничего не добавляет.
// ============================================================
async function pmobLoadWh() {
    if (POS.mobWhById) return POS.mobWhById;
    if (typeof barcodesState !== 'undefined' && barcodesState && barcodesState.whById
        && Object.keys(barcodesState.whById).length) {
        POS.mobWhById = barcodesState.whById;
        return POS.mobWhById;
    }
    const map = {};
    try {
        const { data } = await ortobotClient.from('warehouses').select('id,name,is_active');
        (data || []).forEach(w => { map[w.id] = w; });
    } catch (_) {}
    POS.mobWhById = map;
    return map;
}

// В products нет c1_code — артикул показываем по хвосту c1_ref.
function pmobArt(p) {
    const ref = String((p && p.c1_ref) || '').replace(/[^0-9a-zA-Z]/g, '');
    return ref ? ref.slice(-6).toUpperCase() : '—';
}

function pmobSearchInputHandler() {
    const inp = pmobEl('pmobSearchInput');
    const q = ((inp && inp.value) || '').trim();
    if (POS.mobSearchT) clearTimeout(POS.mobSearchT);
    if (q.length < 2) {
        const sug = pmobEl('pmobSearchSug');
        if (sug) { sug.innerHTML = ''; sug.style.display = 'none'; }
        return;
    }
    POS.mobSearchT = setTimeout(() => pmobSearchSuggest(q), 280);
}

async function pmobSearchSuggest(q) {
    const sug = pmobEl('pmobSearchSug');
    if (!sug) return;
    const seq = ++POS.mobSearchSeq;
    sug.style.display = 'block';
    sug.innerHTML = '<div class="pmob-sug-item"><span class="pmob-sug-name">Ищу…</span></div>';
    let rows = [];
    try {
        const { data, error } = await ortobotClient
            .from('products')
            .select('id,name_ru,c1_ref')
            .ilike('name_ru', '%' + q + '%')
            .limit(15);
        if (error) throw error;
        rows = data || [];
    } catch (e) {
        if (seq !== POS.mobSearchSeq) return;
        sug.innerHTML = '<div class="pmob-sug-item"><span class="pmob-sug-name">Не удалось загрузить: ' +
            posEsc((e && e.message) || 'ошибка сети') + '</span></div>';
        return;
    }
    if (seq !== POS.mobSearchSeq) return;
    if (!rows.length) {
        sug.innerHTML = '<div class="pmob-sug-item"><span class="pmob-sug-name">Ничего не найдено</span></div>';
        return;
    }
    sug.innerHTML = '';
    rows.forEach(p => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pmob-sug-item';
        b.innerHTML = `<span class="pmob-sug-name">${posEsc(p.name_ru || '—')}</span>` +
            `<span class="pmob-sug-sub">Артикул ${posEsc(pmobArt(p))}</span>`;
        b.addEventListener('click', () => pmobSearchPick(p));
        sug.appendChild(b);
    });
}

async function pmobSearchPick(p) {
    const sug = pmobEl('pmobSearchSug');
    if (sug) { sug.innerHTML = ''; sug.style.display = 'none'; }
    const inp = pmobEl('pmobSearchInput');
    if (inp) { inp.value = p.name_ru || ''; inp.blur(); }
    const res = pmobEl('pmobSearchRes');
    if (!res) return;
    res.innerHTML = '<div class="pmob-empty">Загружаю остатки…</div>';
    let variants = [];
    let units = [];
    try {
        const { data, error } = await ortobotClient
            .from('product_variants')
            .select('id,warehouse_id,size_label,stock')
            .eq('product_id', p.id);
        if (error) throw error;
        variants = data || [];
    } catch (e) {
        res.innerHTML = '<div class="pmob-empty">Не удалось загрузить остатки: ' +
            posEsc((e && e.message) || 'ошибка сети') + '</div>';
        return;
    }
    const ids = variants.map(v => v.id);
    if (ids.length) {
        // stock_units может отсутствовать — экран должен выжить без экземпляров
        try {
            const { data } = await ortobotClient
                .from('stock_units')
                .select('variant_id,warehouse_id,size_label,unique_barcode,status')
                .in('variant_id', ids)
                .eq('status', 'in_stock')
                .limit(4000);
            units = data || [];
        } catch (_) { units = []; }
    }
    const whMap = await pmobLoadWh();
    res.innerHTML = pmobSearchResultHtml(p, variants, units, whMap);
    res.querySelectorAll('.pmob-size-tbl [data-codes]').forEach(el => {
        el.addEventListener('click', () => {
            const box = el.closest('.pmob-wh').querySelector('[data-codes-for="' + el.dataset.codes + '"]');
            if (box) box.style.display = (box.style.display === 'none' || !box.style.display) ? 'flex' : 'none';
        });
    });
}

function pmobSearchResultHtml(p, variants, units, whMap) {
    const clean = s => String(s == null ? '' : s).replace(/^размер:\s*/i, '').trim();
    const byWh = {};
    variants.forEach(v => {
        const w = v.warehouse_id || '—';
        if (!byWh[w]) byWh[w] = {};
        const sz = clean(v.size_label) || '—';
        if (!byWh[w][sz]) byWh[w][sz] = { stock: 0, codes: [] };
        byWh[w][sz].stock += Number(v.stock) || 0;
    });
    units.forEach(u => {
        const w = u.warehouse_id || '—';
        if (!byWh[w]) byWh[w] = {};
        const sz = clean(u.size_label) || '—';
        if (!byWh[w][sz]) byWh[w][sz] = { stock: 0, codes: [] };
        byWh[w][sz].codes.push(String(u.unique_barcode || '').slice(-4));
    });

    let html = `<div class="pmob-prod-head"><div class="pmob-prod-name">${posEsc(p.name_ru || '—')}</div>` +
        `<div class="pmob-prod-art">Артикул ${posEsc(pmobArt(p))}</div></div>`;

    const whIds = Object.keys(byWh).filter(w => {
        const wh = whMap[w];
        if (wh && wh.is_active === false) return false;
        const sizes = byWh[w];
        return Object.keys(sizes).some(s => (sizes[s].codes.length || sizes[s].stock) > 0);
    });
    if (!whIds.length) return html + '<div class="pmob-empty">Нет товара в наличии ни на одном складе.</div>';

    whIds.sort((a, b) => String((whMap[a] && whMap[a].name) || a).localeCompare(String((whMap[b] && whMap[b].name) || b), 'ru'));
    whIds.forEach((w, wi) => {
        const sizes = byWh[w];
        const keys = Object.keys(sizes)
            .filter(s => (sizes[s].codes.length || sizes[s].stock) > 0)
            .sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0) || a.localeCompare(b, 'ru'));
        const qtyOf = s => sizes[s].codes.length || Number(sizes[s].stock) || 0;
        const total = keys.reduce((acc, s) => acc + qtyOf(s), 0);
        const whName = (whMap[w] && whMap[w].name) || 'Склад';
        html += `<div class="pmob-wh">` +
            `<div class="pmob-wh-head"><span class="pmob-wh-name">${posEsc(whName)}</span>` +
            `<span class="pmob-wh-tot">Всего: ${total} ${pmobPlural(total, 'пара', 'пары', 'пар')}</span></div>` +
            `<table class="pmob-size-tbl"><tbody>` +
            `<tr><th>Размер</th>${keys.map((s, i) => `<td data-codes="${wi}-${i}">${posEsc(s)}</td>`).join('')}</tr>` +
            `<tr><th>В наличии</th>${keys.map((s, i) => `<td data-codes="${wi}-${i}"><b>${qtyOf(s)}</b></td>`).join('')}</tr>` +
            `</tbody></table>`;
        keys.forEach((s, i) => {
            const codes = sizes[s].codes;
            if (!codes.length) return;
            html += `<div class="pmob-codes" data-codes-for="${wi}-${i}" style="display:none;">` +
                `<span class="pmob-code-cap">Размер ${posEsc(s)}:</span>` +
                codes.map(c => `<span class="pmob-code-chip">№ ${posEsc(c)}</span>`).join('') +
                `</div>`;
        });
        html += `<div class="pmob-codes-hint">Нажмите на размер, чтобы увидеть штрихкоды экземпляров.</div></div>`;
    });
    return html;
}

function pmobOpenSearch() {
    const res = pmobEl('pmobSearchRes');
    if (res && !res.innerHTML) res.innerHTML = '<div class="pmob-empty">Введите название товара, чтобы посмотреть остатки по складам.</div>';
    pmobShow('search');
    setTimeout(() => { const i = pmobEl('pmobSearchInput'); if (i) i.focus(); }, 120);
}

function pmobBindEvents() {
    const ov = pmobEl('posMobile');
    if (!ov) return;
    const on = (id, fn) => { const el = pmobEl(id); if (el) el.addEventListener('click', fn); };
    on('pmobScanCard', () => pmobOpenScan('cart'));
    on('pmobReceiptBar', () => pmobShow('cart'));
    on('pmobScanBack', pmobCloseScan);
    on('pmobScanCancel', pmobCloseScan);
    on('pmobCamFlip', pmobFlipCamera);
    on('pmobTorch', pmobToggleTorch);
    on('pmobToPay', pmobOpenPay);
    on('pmobPayBack', () => { pmobCloseMix(); pmobShow('cart'); });
    // смешанная оплата
    const mixCash = pmobEl('pmobMixCash');
    if (mixCash) mixCash.addEventListener('input', pmobMixRecalc);
    const mixCard = pmobEl('pmobMixCard');
    if (mixCard) mixCard.addEventListener('change', pmobMixRecalc);
    on('pmobMixCancel', pmobCloseMix);
    on('pmobMixOk', pmobConfirmMix);
    on('pmobMoreBack', () => pmobShow('cart'));
    on('pmobCloseShift', posCloseShift);
    on('pmobMoreCloseShift', posCloseShift);
    on('pmobMoreReturn', posOpenReturn);
    on('pmobMoreSearch', pmobOpenSearch);
    on('pmobMoreDisc', () => { posApply5Cart(); pmobRender(); });
    on('pmobMoreDesktop', () => { POS.mobDesktopView = true; pmobApply(); });

    // дисконтная карта покупателя
    on('pmobClientMain', () => { if (POS.client) pmobShow('card'); else pmobOpenScan('card'); });
    on('pmobClientRm', pmobRemoveClient);
    on('pmobCardBack', () => pmobShow('cart'));
    on('pmobCardRemove', pmobRemoveClient);
    on('pmobCardToPay', pmobOpenPay);

    // врач (ВР): поиск по номеру или имени/фамилии
    on('pmobDoctorMain', pmobOpenDoctor);
    on('pmobDoctorRm', pmobRemoveDoctor);
    on('pmobDocBack', () => pmobShow('cart'));
    on('pmobDocRemove', pmobRemoveDoctor);
    on('pmobDocClear', () => {
        const i = pmobEl('pmobDocInput');
        if (i) { i.value = ''; try { i.focus(); } catch (_) {} }
        const s = pmobEl('pmobDocSug');
        if (s) s.innerHTML = '';
    });
    const di = pmobEl('pmobDocInput');
    if (di) di.addEventListener('input', pmobDocInputHandler);

    // возврат: 4 экрана
    on('pmobRetBack', () => pmobShow('cart'));
    on('pmobRetCloseShift', posCloseShift);
    on('pmobRetScanCard', () => pmobOpenScan('return'));
    on('pmobRetiBack', () => pmobShow('return'));
    on('pmobRetiCloseShift', posCloseShift);
    on('pmobRetConfirmBtn', pmobRetConfirm);
    on('pmobRetdBack', () => pmobShow('return'));
    on('pmobRetPrint', pmobRetPrint);
    on('pmobRetView', pmobRetToggleReceipt);
    on('pmobRetAgain', posOpenReturn);

    // поиск товара
    on('pmobSearchBack', () => pmobShow('more'));
    on('pmobSearchClear', () => {
        const i = pmobEl('pmobSearchInput');
        if (i) { i.value = ''; i.focus(); }
        const s = pmobEl('pmobSearchSug');
        if (s) { s.innerHTML = ''; s.style.display = 'none'; }
        const r = pmobEl('pmobSearchRes');
        if (r) r.innerHTML = '<div class="pmob-empty">Введите название товара, чтобы посмотреть остатки по складам.</div>';
    });
    const si = pmobEl('pmobSearchInput');
    if (si) si.addEventListener('input', pmobSearchInputHandler);
    ov.querySelectorAll('.pmob-nav-btn').forEach(b => {
        b.addEventListener('click', () => {
            const to = b.dataset.pmob;
            if (to === 'return') { posOpenReturn(); return; }
            if (to === 'pay') { pmobOpenPay(); return; }
            pmobShow(to);
        });
    });
}

function posBindEvents() {
    const chk = document.getElementById('posConfirmKassa');
    if (chk) chk.addEventListener('change', posUpdateStep1Btn);
    const toStep2 = document.getElementById('posToStep2');
    if (toStep2) toStep2.addEventListener('click', posGoStep2);
    const back = document.getElementById('posBackToStep1');
    if (back) back.addEventListener('click', () => posShowStep(1));
    const sellerSel = document.getElementById('posSeller');
    if (sellerSel) sellerSel.addEventListener('change', posUpdateOpenBtn);
    const openBtn = document.getElementById('posOpenShift');
    if (openBtn) openBtn.addEventListener('click', posOpenShift);
    const closeBtn = document.getElementById('posCloseShift');
    if (closeBtn) closeBtn.addEventListener('click', posCloseShift);
    const camToggle = document.getElementById('posCamToggle');
    if (camToggle) camToggle.addEventListener('click', posToggleCamera);
    const scanInp = document.getElementById('posScanInput');
    if (scanInp) scanInp.addEventListener('keydown', posScanInputHandler);

    // ——— ЭТАП 2: корзина / скидки / карты / оплата / чек ———
    // Кнопка «Отсканировать товар» — фокус на поле скана (или камера на мобильном).
    const scanNext = document.getElementById('posScanNext');
    if (scanNext) scanNext.addEventListener('click', () => {
        const inp = document.getElementById('posScanInput');
        if (inp) { inp.focus(); inp.select && inp.select(); }
    });
    // Быстрые скидки 5%
    const d5i = document.getElementById('posDisc5Item');
    if (d5i) d5i.addEventListener('click', posApply5Item);
    const d5c = document.getElementById('posDisc5Cart');
    if (d5c) d5c.addEventListener('click', posApply5Cart);
    // Карта врача (поиск по коду/имени) и дисконтная карта клиента (скан)
    const docInp = document.getElementById('posDoctorInput');
    if (docInp) docInp.addEventListener('input', posDoctorInputHandler);
    const cliInp = document.getElementById('posClientInput');
    if (cliInp) cliInp.addEventListener('keydown', posClientInputHandler);
    // Кнопка скана карты клиента камерой
    const cliScan = document.getElementById('posClientScanBtn');
    if (cliScan) cliScan.addEventListener('click', posToggleClientCamera);
    const cliCamClose = document.getElementById('posClientCamClose');
    if (cliCamClose) cliCamClose.addEventListener('click', posStopClientCamera);
    // Переход к оплате
    const toPay = document.getElementById('posToPayment');
    if (toPay) toPay.addEventListener('click', posOpenPayment);
    // Выбор режима оплаты
    document.querySelectorAll('.pos-paymode').forEach(btn => {
        btn.addEventListener('click', () => posSetPayMode(btn.getAttribute('data-mode')));
    });
    // Пересчёт сдачи
    const cashGiven = document.getElementById('posCashGiven');
    if (cashGiven) cashGiven.addEventListener('input', posRecalcChange);
    const mixCash = document.getElementById('posMixCash');
    if (mixCash) mixCash.addEventListener('input', posRecalcChange);
    // Переход к экрану-чеку (сверка)
    const toReceipt = document.getElementById('posToReceipt');
    if (toReceipt) toReceipt.addEventListener('click', posShowReceipt);
    // Назад из чека к оплате
    const rcptBack = document.getElementById('posReceiptBack');
    if (rcptBack) rcptBack.addEventListener('click', () => {
        const rm = document.getElementById('posReceiptModal');
        if (rm) rm.style.display = 'none';
        const pm = document.getElementById('posPayModal');
        if (pm) pm.style.display = 'flex';
    });
    // Подтверждение продажи
    const rcptConfirm = document.getElementById('posReceiptConfirm');
    if (rcptConfirm) rcptConfirm.addEventListener('click', posConfirmSale);
    // Закрытие модалок
    const payClose = document.getElementById('posPayClose');
    if (payClose) payClose.addEventListener('click', () => {
        const pm = document.getElementById('posPayModal');
        if (pm) pm.style.display = 'none';
    });
    const rcptClose = document.getElementById('posReceiptClose');
    if (rcptClose) rcptClose.addEventListener('click', () => {
        const rm = document.getElementById('posReceiptModal');
        if (rm) rm.style.display = 'none';
    });
    // Клик по фону модалки — закрыть
    const payModal = document.getElementById('posPayModal');
    if (payModal) payModal.addEventListener('click', (e) => { if (e.target === payModal) payModal.style.display = 'none'; });
    const rcptModal = document.getElementById('posReceiptModal');
    if (rcptModal) rcptModal.addEventListener('click', (e) => { if (e.target === rcptModal) rcptModal.style.display = 'none'; });

    // ——— Итоги смены при закрытии ———
    const ssClose = () => { const m = document.getElementById('posShiftSummaryModal'); if (m) m.style.display = 'none'; };
    const ssX = document.getElementById('posShiftSummaryClose');
    if (ssX) ssX.addEventListener('click', ssClose);
    const ssOk = document.getElementById('posShiftSummaryOk');
    if (ssOk) ssOk.addEventListener('click', ssClose);
    const ssModal = document.getElementById('posShiftSummaryModal');
    if (ssModal) ssModal.addEventListener('click', (e) => { if (e.target === ssModal) ssClose(); });

    // ——— ВОЗВРАТ ТОВАРА ———
    const retBtn = document.getElementById('posReturnBtn');
    if (retBtn) retBtn.addEventListener('click', posOpenReturn);
    const retClose = document.getElementById('posReturnClose');
    if (retClose) retClose.addEventListener('click', posCloseReturn);
    const retModal = document.getElementById('posReturnModal');
    if (retModal) retModal.addEventListener('click', (e) => { if (e.target === retModal) posCloseReturn(); });
    const retFind = document.getElementById('posRetFindBtn');
    if (retFind) retFind.addEventListener('click', posReturnFind);
    const retScanInp = document.getElementById('posRetScanInput');
    if (retScanInp) retScanInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); posReturnFind(); } });
    const retBack = document.getElementById('posRetBack');
    if (retBack) retBack.addEventListener('click', () => posRetShowStep('scan'));
    const retConfirm = document.getElementById('posRetConfirm');
    if (retConfirm) retConfirm.addEventListener('click', posReturnConfirm);
    const retDoneClose = document.getElementById('posRetDoneClose');
    if (retDoneClose) retDoneClose.addEventListener('click', posCloseReturn);
    document.querySelectorAll('.pos-ret-reason').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.pos-ret-reason').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // ——— МОБИЛЬНЫЙ UI КАССИРА ———
    pmobBindEvents();
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', posBindEvents);
} else {
    posBindEvents();
}

// ============================================================
//  ИСТОРИЯ ПРОДАЖ (кассир) + ОТЧЁТЫ И КАССЫ (админ-дашборд)
// ============================================================

// --- утилиты ---
function repFmtNum(n) {
  n = Number(n) || 0;
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function repToday() {
  // сегодня в TZ Душанбе (+05) как YYYY-MM-DD
  const d = new Date();
  const dush = new Date(d.getTime() + (5 * 60 - d.getTimezoneOffset()) * 60000);
  return dush.toISOString().slice(0, 10);
}
// ISO-строка → 'ДД.ММ HH:MM' по Душанбе (+05)
function repDushTime(iso, withDate) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const dush = new Date(d.getTime() + (5 * 60 - (-0)) * 60000 - (0));
  // Приводим к +05 явно: берём UTC и добавляем 5ч
  const u = new Date(d.getTime() + 5 * 3600000);
  const hh = String(u.getUTCHours()).padStart(2, '0');
  const mm = String(u.getUTCMinutes()).padStart(2, '0');
  const dd = String(u.getUTCDate()).padStart(2, '0');
  const mo = String(u.getUTCMonth() + 1).padStart(2, '0');
  return withDate ? `${dd}.${mo} ${hh}:${mm}` : `${hh}:${mm}`;
}
function repErr(elId, msg) {
  const e = document.getElementById(elId);
  if (!e) return;
  if (!msg) { e.style.display = 'none'; e.textContent = ''; return; }
  e.style.display = ''; e.textContent = msg;
}

// ─────────────── ИСТОРИЯ ПРОДАЖ (кассир) ───────────────
let posHistLoaded = false;
function loadPosHistory() {
  const f = document.getElementById('posHistFrom');
  const t = document.getElementById('posHistTo');
  if (f && !f.value) f.value = repToday();
  if (t && !t.value) t.value = repToday();
  if (!posHistLoaded) { posHistFetch(); posHistLoaded = true; }
}
async function posHistFetch() {
  const from = (document.getElementById('posHistFrom') || {}).value || repToday();
  const to = (document.getElementById('posHistTo') || {}).value || from;
  const status = document.getElementById('posHistStatus');
  const rows = document.getElementById('posHistRows');
  repErr('posHistError', '');
  if (status) status.textContent = '⏳ Загружаю…';
  if (rows) rows.innerHTML = `<tr><td class="rep-empty" colspan="5">⏳ Загружаю чеки…</td></tr>`;
  try {
    const r = await posApi(`?action=history&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { method: 'GET' });
    if (!r.ok || !r.data.ok) throw new Error((r.data && r.data.error) || 'Ошибка загрузки');
    const list = r.data.receipts || [];
    // KPI
    const kpis = document.getElementById('posHistKpis');
    if (kpis) kpis.innerHTML = `
      <div class="rep-kpi"><div class="rep-kpi-label">Чеков</div><div class="rep-kpi-val">${list.length}</div></div>
      <div class="rep-kpi accent"><div class="rep-kpi-label">Сумма продаж</div><div class="rep-kpi-val">${repFmtNum(r.data.total)} <span style="font-size:14px;">сом</span></div></div>`;
    if (!list.length) {
      if (rows) rows.innerHTML = `<tr><td class="rep-empty" colspan="5">За выбранный период чеков нет</td></tr>`;
    } else if (rows) {
      rows.innerHTML = list.map(x => `
        <tr>
          <td class="rep-td l">${posEsc(x.number)}</td>
          <td class="rep-td l muted">${repDushTime(x.date, false)}</td>
          <td class="rep-td l">${posEsc(x.shop)}</td>
          <td class="rep-td l">${posEsc(x.seller)}</td>
          <td class="rep-td">${repFmtNum(x.total)}</td>
        </tr>`).join('');
    }
    if (status) status.textContent = `${from === to ? from : from + ' — ' + to} · ${list.length} чек(ов)`;
  } catch (e) {
    repErr('posHistError', 'Ошибка: ' + (e.message || e));
    if (status) status.textContent = '';
    if (rows) rows.innerHTML = `<tr><td class="rep-empty" colspan="5">Не удалось загрузить</td></tr>`;
  }
}

// ─────────────── ОТЧЁТЫ И КАССЫ (админ) ───────────────
let repLoaded = false;
let repLastReport = null;
function loadSalesReports() {
  const f = document.getElementById('repFrom');
  const t = document.getElementById('repTo');
  if (f && !f.value) f.value = repToday();
  if (t && !t.value) t.value = repToday();
  if (!repLoaded) { repFetchShifts(); repLoaded = true; }
}

async function repFetchShifts() {
  const box = document.getElementById('repShifts');
  repErr('repError', '');
  if (box) box.innerHTML = `<div class="rep-empty">⏳ Загружаю смены…</div>`;
  try {
    const r = await posApi(`?action=shifts-active`, { method: 'GET' });
    if (!r.ok || !r.data.ok) throw new Error((r.data && r.data.error) || 'Ошибка');
    const shifts = r.data.shifts || [];
    if (!shifts.length) { if (box) box.innerHTML = `<div class="rep-empty">На сегодня смен нет</div>`; return; }
    if (box) box.innerHTML = shifts.map(s => {
      const on = s.status === 'open';
      return `<div class="rep-shift">
        <div class="rep-shift-top">
          <span class="rep-dot ${on ? 'on' : 'off'}"></span>
          <span class="rep-shift-name">${posEsc(s.shopName || s.kassaName || '—')}</span>
          <span class="rep-badge ${on ? 'on' : 'off'}">${on ? 'Открыта' : 'Закрыта'}</span>
        </div>
        <div class="rep-shift-row"><span class="k">Касса:</span> ${posEsc(s.kassaName || '—')}</div>
        <div class="rep-shift-row"><span class="k">Продавец:</span> ${posEsc(s.seller || '—')}</div>
        <div class="rep-shift-row"><span class="k">Открыта:</span> ${repDushTime(s.openedAt, false)}${on ? '' : ' · <span class="k">Закрыта:</span> ' + repDushTime(s.closedAt, false)}</div>
        <div class="rep-shift-row"><span class="k">Чеков:</span> ${s.receipts || 0} · <span class="k">Сумма:</span> ${repFmtNum(s.totalSales)} сом</div>
      </div>`;
    }).join('');
  } catch (e) {
    repErr('repError', 'Смены: ' + (e.message || e));
    if (box) box.innerHTML = `<div class="rep-empty">Не удалось загрузить смены</div>`;
  }
}

async function repBuildReport() {
  const from = (document.getElementById('repFrom') || {}).value || repToday();
  const to = (document.getElementById('repTo') || {}).value || from;
  const status = document.getElementById('repStatus');
  const btn = document.getElementById('repBuild');
  repErr('repError', '');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Считаю…'; }
  if (status) status.textContent = '⏳ Формирую отчёт…';
  try {
    const r = await posApi(`?action=sales-report&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { method: 'GET' });
    if (!r.ok || !r.data.ok) throw new Error((r.data && r.data.error) || 'Ошибка');
    const rep = r.data.report;
    repLastReport = rep;
    repRenderReport(rep);
    if (status) status.textContent = `${rep.from === rep.to ? rep.from : rep.from + ' — ' + rep.to} · ${rep.grand.receipts} чек(ов)`;
  } catch (e) {
    repErr('repError', 'Отчёт: ' + (e.message || e));
    if (status) status.textContent = '';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📊 Сформировать отчёт'; }
  }
}

function repRenderReport(rep) {
  const g = rep.grand;
  const kpis = document.getElementById('repKpis');
  if (kpis) kpis.innerHTML = `
    <div class="rep-kpi accent"><div class="rep-kpi-label">Итого продаж</div><div class="rep-kpi-val">${repFmtNum(g.total)} <span style="font-size:13px;">сом</span></div><div class="rep-kpi-sub">${g.receipts} чеков</div></div>
    <div class="rep-kpi"><div class="rep-kpi-label">Наличные</div><div class="rep-kpi-val">${repFmtNum(g.cash)}</div></div>
    <div class="rep-kpi"><div class="rep-kpi-label">Alif QR</div><div class="rep-kpi-val">${repFmtNum(g.alifqr)}</div></div>
    <div class="rep-kpi"><div class="rep-kpi-label">Alif кошелёк</div><div class="rep-kpi-val">${repFmtNum(g.alifwlt)}</div></div>
    <div class="rep-kpi"><div class="rep-kpi-label">DC кошелёк</div><div class="rep-kpi-val">${repFmtNum(g.dcwlt)}</div></div>
    <div class="rep-kpi"><div class="rep-kpi-label">DC QR</div><div class="rep-kpi-val">${repFmtNum(g.dcqr)}</div></div>`;
  const rows = document.getElementById('repRows');
  if (rows) {
    const shopRows = rep.shops.map(s => `
      <tr>
        <td class="rep-td l">${posEsc(s.shop)}</td>
        <td class="rep-td">${repFmtNum(s.cash)}</td>
        <td class="rep-td">${repFmtNum(s.alifqr)}</td>
        <td class="rep-td">${repFmtNum(s.alifwlt)}</td>
        <td class="rep-td">${repFmtNum(s.dcwlt)}</td>
        <td class="rep-td">${repFmtNum(s.dcqr)}</td>
        <td class="rep-td muted">${repFmtNum(s.other)}</td>
        <td class="rep-td">${repFmtNum(s.total)}</td>
        <td class="rep-td muted">${s.receipts}</td>
      </tr>`).join('');
    const totalRow = `
      <tr class="rep-tr-total">
        <td class="rep-td l">ИТОГО</td>
        <td class="rep-td">${repFmtNum(g.cash)}</td>
        <td class="rep-td">${repFmtNum(g.alifqr)}</td>
        <td class="rep-td">${repFmtNum(g.alifwlt)}</td>
        <td class="rep-td">${repFmtNum(g.dcwlt)}</td>
        <td class="rep-td">${repFmtNum(g.dcqr)}</td>
        <td class="rep-td">${repFmtNum(g.other)}</td>
        <td class="rep-td">${repFmtNum(g.total)}</td>
        <td class="rep-td">${g.receipts}</td>
      </tr>`;
    rows.innerHTML = shopRows + totalRow;
  }
  const wrap = document.getElementById('repTableWrap');
  if (wrap) wrap.style.display = '';
  const exp = document.getElementById('repExport');
  if (exp) exp.style.display = 'flex';
}

// --- экспорт Excel (SheetJS) ---
function repExportXlsx() {
  if (!repLastReport || !window.XLSX) { alert('Сначала сформируйте отчёт'); return; }
  const rep = repLastReport, g = rep.grand;
  const head = ['Магазин', 'Наличные', 'Alif QR', 'Alif кошелёк', 'DC кошелёк', 'DC QR', 'Прочее', 'Итого', 'Чеков'];
  const aoa = [
    [`Отчёт по продажам · ${rep.from === rep.to ? rep.from : rep.from + ' — ' + rep.to}`],
    [],
    head,
  ];
  rep.shops.forEach(s => aoa.push([s.shop, s.cash, s.alifqr, s.alifwlt, s.dcwlt, s.dcqr, s.other, s.total, s.receipts]));
  aoa.push(['ИТОГО', g.cash, g.alifqr, g.alifwlt, g.dcwlt, g.dcqr, g.other, g.total, g.receipts]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 22 }, { wch: 12 }, { wch: 11 }, { wch: 13 }, { wch: 13 }, { wch: 11 }, { wch: 11 }, { wch: 13 }, { wch: 8 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Отчёт');
  XLSX.writeFile(wb, `Отчёт_продажи_${rep.from}${rep.from !== rep.to ? '_' + rep.to : ''}.xlsx`);
}

// --- экспорт PDF (печать стилизованной области; кириллица нативная) ---
function repExportPdf() {
  if (!repLastReport) { alert('Сначала сформируйте отчёт'); return; }
  const rep = repLastReport, g = rep.grand;
  const period = rep.from === rep.to ? rep.from : `${rep.from} — ${rep.to}`;
  const row = (name, s, cls) => `<tr class="${cls || ''}">
    <td class="l">${posEsc(name)}</td><td>${repFmtNum(s.cash)}</td><td>${repFmtNum(s.alifqr)}</td>
    <td>${repFmtNum(s.alifwlt)}</td><td>${repFmtNum(s.dcwlt)}</td><td>${repFmtNum(s.dcqr)}</td>
    <td>${repFmtNum(s.other)}</td><td><b>${repFmtNum(s.total)}</b></td><td>${s.receipts}</td></tr>`;
  const shopRows = rep.shops.map(s => row(s.shop, s)).join('');
  const totalRow = row('ИТОГО', g, 'tot');
  const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
    <title>Отчёт по продажам ${period}</title>
    <style>
      *{font-family:Arial,'Segoe UI',sans-serif;box-sizing:border-box;}
      body{margin:0;padding:28px 30px;color:#1f3a3c;}
      .hd{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #0f8b91;padding-bottom:12px;margin-bottom:6px;}
      .hd h1{margin:0;font-size:22px;color:#0a6f74;}
      .hd .br{font-size:20px;font-weight:800;color:#f47a1f;}
      .sub{color:#6b7f80;font-size:13px;margin:4px 0 18px;}
      .kpis{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;}
      .kpi{border:1px solid #e7ddd0;border-radius:12px;padding:10px 14px;min-width:120px;}
      .kpi .l{font-size:11px;color:#6b7f80;text-transform:uppercase;letter-spacing:.3px;}
      .kpi .v{font-size:19px;font-weight:800;color:#0a6f74;}
      .kpi.acc .v{color:#e06810;}
      table{border-collapse:collapse;width:100%;font-size:12.5px;}
      th{background:#e9f6f6;color:#0a6f74;font-weight:800;padding:9px 8px;text-align:right;border-bottom:2px solid #0f8b91;}
      th.l,td.l{text-align:left;}
      td{padding:8px;text-align:right;border-bottom:1px solid #e7ddd0;color:#1f3a3c;}
      tr.tot td{background:#f2faf9;font-weight:800;border-top:2px solid #13a2a9;}
      .ft{margin-top:22px;font-size:11px;color:#8a9a9a;text-align:center;}
      @media print{body{padding:12px;} @page{size:A4 landscape;margin:12mm;}}
    </style></head><body>
    <div class="hd"><h1>💰 Отчёт по продажам</h1><div class="br">OrtoSalon</div></div>
    <div class="sub">Период: <b>${period}</b> · Сформирован: ${repDushTime(new Date().toISOString(), true)} (Душанбе)</div>
    <div class="kpis">
      <div class="kpi acc"><div class="l">Итого продаж</div><div class="v">${repFmtNum(g.total)} сом</div></div>
      <div class="kpi"><div class="l">Наличные</div><div class="v">${repFmtNum(g.cash)}</div></div>
      <div class="kpi"><div class="l">Alif QR</div><div class="v">${repFmtNum(g.alifqr)}</div></div>
      <div class="kpi"><div class="l">Alif кошелёк</div><div class="v">${repFmtNum(g.alifwlt)}</div></div>
      <div class="kpi"><div class="l">DC кошелёк</div><div class="v">${repFmtNum(g.dcwlt)}</div></div>
      <div class="kpi"><div class="l">DC QR</div><div class="v">${repFmtNum(g.dcqr)}</div></div>
      <div class="kpi"><div class="l">Чеков</div><div class="v">${g.receipts}</div></div>
    </div>
    <table><thead><tr>
      <th class="l">Магазин</th><th>Наличные</th><th>Alif QR</th><th>Alif кошелёк</th>
      <th>DC кошелёк</th><th>DC QR</th><th>Прочее</th><th>Итого</th><th>Чеков</th>
    </tr></thead><tbody>${shopRows}${totalRow}</tbody></table>
    <div class="ft">Отчёт для снятия денежных средств · OrtoSalon · данные из 1С (Чеки ККМ)</div>
    <script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('Разрешите всплывающие окна для скачивания PDF'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

// --- биндинги ---
function repBindEvents() {
  const ha = document.getElementById('posHistApply');
  if (ha) ha.addEventListener('click', posHistFetch);
  const ht = document.getElementById('posHistToday');
  if (ht) ht.addEventListener('click', () => {
    const f = document.getElementById('posHistFrom'), t = document.getElementById('posHistTo');
    if (f) f.value = repToday(); if (t) t.value = repToday();
    posHistFetch();
  });
  const sr = document.getElementById('repShiftsRefresh');
  if (sr) sr.addEventListener('click', repFetchShifts);
  const rb = document.getElementById('repBuild');
  if (rb) rb.addEventListener('click', repBuildReport);
  const rp = document.getElementById('repExportPdf');
  if (rp) rp.addEventListener('click', repExportPdf);
  const rx = document.getElementById('repExportXlsx');
  if (rx) rx.addEventListener('click', repExportXlsx);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', repBindEvents);
} else {
  repBindEvents();
}
