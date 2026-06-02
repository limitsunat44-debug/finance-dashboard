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
const ADMIN_ACCOUNTS = {
    'Sunnat': { password: 'Sunna0909', displayName: 'Sunnat' },
    'Iskandar': { password: '1111', displayName: 'Iskandar' },
    'Shahida': { password: 's2364170', displayName: 'Shahida' }
};

// Salons
const SALONS = ['Ортосалон СитиМолл', 'Ортосалон Сиема', 'Ортосалон Баракат', 'Ортосалон Айни'];

// ═══════════════════════════════════════════════════════════════
// 1С ИНТЕГРАЦИЯ (Supabase, только чтение)
// ═══════════════════════════════════════════════════════════════
const AI_INSIGHTS_URL = 'https://1c-sync.vercel.app/api/ai-insights';

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
function login(username, password) {
    const account = ADMIN_ACCOUNTS[username];
    if (account && account.password === password) {
        currentUser = account.displayName;
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        document.getElementById('currentUser').textContent = currentUser;
        
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
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('loginForm').reset();
}

// Navigation functions
function switchTab(tabName) {
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });

    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.remove('active');
    });

    document.getElementById(tabName + 'Section').classList.add('active');
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

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

    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            switchTab(this.dataset.tab);
        });
    });

    document.querySelectorAll('.section-tab').forEach(tab => {
        if (tab.dataset.prodtab) return; // подразделы «Товары» обрабатываются отдельно
        tab.addEventListener('click', function() {
            const section = this.closest('.section').id.replace('Section', '');
            switchSectionTab(section, this.dataset.section);
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

    const actionsHtml = s.archived ? `
        <div class="shipment-actions">
            ${(s.receipts && s.receipts.length > 0) ? `<button class="shipment-btn shipment-btn-history" onclick="toggleReceiptsHistory(${s.id})">📋 История приёмов</button>` : ''}
            <button class="shipment-btn shipment-btn-edit" onclick="unarchiveShipment(${s.id})">↩️ Вернуть в активные</button>
            <button class="shipment-btn shipment-btn-delete" onclick="deleteShipment(${s.id})">🗑 Удалить</button>
        </div>` : `
        <div class="shipment-actions">
            <button class="shipment-btn shipment-btn-receive" onclick="toggleReceiveForm(${s.id})">📥 Принять груз</button>
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
            </div>
        </div>`;
}

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

    const recs = [];
    for (const [, vars] of byKey) {
        // Получатели: дефицит, но НЕ Основной склад и НЕ Интернет магазин (исключён выше)
        const deficits = vars.filter(v => v.stock <= LOW_STOCK_THRESHOLD && !isMainWarehouse(v.warehouse_id));
        const surplus = vars.filter(v => v.stock >= transferSurplusMin(v.warehouse_id))
            .sort((a, b) => b.stock - a.stock);
        if (deficits.length === 0 || surplus.length === 0) continue;
        // Излишек на Основном складе (если есть и достаточен)
        const mainSurplus = surplus.find(s => isMainWarehouse(s.warehouse_id));
        for (const d of deficits) {
            // приоритет за Основным складом; иначе — магазин с максимальным остатком (не тот же склад)
            let src = (mainSurplus && mainSurplus.warehouse_id !== d.warehouse_id)
                ? mainSurplus
                : surplus.find(s => s.warehouse_id !== d.warehouse_id && !isMainWarehouse(s.warehouse_id));
            if (!src) continue;
            // Фильтры «Откуда»/«Куда» по конкретному складу (по умолчанию — все)
            if (fromFilter && src.warehouse_id !== fromFilter) continue;
            if (toFilter && d.warehouse_id !== toFilter) continue;
            const p = productsState.prodById[d.product_id];
            // переместить столько, чтобы донор сохранил минимум 2, а у получателя стало хотя бы 2
            const moveQty = Math.max(1, Math.min(src.stock - 2, 2 - d.stock + 1));
            recs.push({
                name: p ? p.name_ru : '(?)',
                size: d.size_label || '—',
                from: whName(src.warehouse_id),
                fromStock: src.stock,
                to: whName(d.warehouse_id),
                toStock: d.stock,
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
