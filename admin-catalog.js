// ═════════════════════════════════════════════════════════════════════
//  ПОИСК ТОВАРОВ (v1.5.6) — каталог карточками в Админ РМК.
//  Поиск: название, артикул, штрихкод (полный или последние цифры), бренд, поставщик, цвет, место (B-1).
//  Фильтры: категория, бренд, размер, поставщик, склад, наличие на витрине, дата поступления,
//  цена, количество, цвет, сезон, статус; сортировка (по умолчанию — по количеству, убывание).
//  Панель товара: фото, размеры, вкладки Остатки / Витрина (адрес каждого штрихкода) / Продажи /
//  Поступления / Перемещения.  Backend: /api/pos?action=catalog&sub=board|detail
// ═════════════════════════════════════════════════════════════════════
const CT = {
  f: { q: '', cat: '', brand: '', size: '', supplier: '', wh: '', show: '', from: '', to: '', pmin: '', pmax: '', qmin: '', qmax: '', color: '', season: '', status: '', sort: 'qty_desc' },
  page: 0, per: 24, data: null, pid: '', det: null, detTab: 'show', detWh: '', hlBc: '', open: {}, seq: 0, adv: localStorage.getItem('ct_adv') ? localStorage.getItem('ct_adv') === '1' : window.innerWidth > 700,
};
const CT_SORTS = [
  ['qty_desc', 'По количеству (убывание)'], ['qty_asc', 'По количеству (возрастание)'], ['sales', 'По продажам за 30 дн.'],
  ['newest', 'Сначала новые поступления'], ['price_desc', 'Сначала дорогие'], ['price_asc', 'Сначала дешёвые'], ['name', 'По названию'], ['show_off', 'Сначала нет на витрине'],
];
const CT_STATUS = [
  ['', 'В наличии — все'], ['hit', 'Хит продаж'], ['new', 'Новинка (30 дн.)'], ['low', 'Низкий остаток (≤3)'], ['nosale', 'Нет продаж 30 дн.'], ['out', 'Нет в наличии'], ['all', 'Все, включая нулевые'],
];
const CT_ICON = {
  all: '<path d="M4 7h16l-1.5 11h-13z"/><path d="M8 7a4 4 0 0 1 8 0"/>',
  women: '<path d="M4 16c3 0 5-1 7-4l2-3 3 5c1 1.5 2.5 2 4 2v2H4z"/>',
  men: '<path d="M3 15c2 0 4-.5 6-2l3-3h3l2 3c1 1 2.5 1.5 4 1.5V18H3z"/>',
  girls: '<path d="M6 17c2 0 3-1 4-3l1.5-3 3 4c.8 1 2 1.5 3.5 1.5V19H6z"/><circle cx="16" cy="6" r="2"/>',
  boys: '<path d="M5 15.5c2 0 3.5-.6 5-2l2.5-2.5h2.5l1.5 2.5c1 1 2.2 1.3 3.5 1.3V18H5z"/><path d="M10 6l2-2 2 2"/>',
  insoles: '<path d="M9 3c3 0 5 3 5 7s-1 11-4 11-3.5-5-3.5-9S6 3 9 3z"/>',
  braces: '<path d="M8 3v5c0 2 1 3 1 5s-1 3-1 5v3h8v-3c0-2-1-3-1-5s1-3 1-5V3"/><path d="M8 9h8M8 15h8"/>',
  compress: '<path d="M9 3h6v9l3 5a3 3 0 0 1-3 4h-1a4 4 0 0 1-4-3l-1-3z"/>',
  shoes: '<path d="M3 16c3 0 6-1 8-4l1-2 3 3c1.5 1.5 3 2 6 2v3H3z"/>',
  acc: '<rect x="4" y="7" width="16" height="12" rx="2"/><path d="M9 7V5h6v2"/>',
};
const ctSvg = (k, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${CT_ICON[k] || CT_ICON.acc}</svg>`;
const CT_I = {
  search: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>',
  scan: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9v6M11 9v6M14 9v6M17 9v6"/></svg>',
  bc: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6v12M7 6v12M10 6v12M14 6v12M17 6v12M20 6v12"/></svg>',
  box: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>',
  store: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16"/><path d="M10 20v-5h4v5"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>',
  filt: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
  reset: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4h4"/></svg>',
  cal: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
};
const ctNum = (n) => fmtInt(Math.round(Number(n) || 0));
const ctMoney = (n) => `${ctNum(n)} ${CUR}`;
const ctDM = (s) => { if (!s) return '—'; const p = String(s).slice(0, 10).split('-'); return `${p[2]}.${p[1]}.${p[0]}`; };
const ctDT = (iso) => { if (!iso) return '—'; const d = new Date(new Date(iso).getTime() + 5 * 3600e3).toISOString(); return `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)} ${d.slice(11, 16)}`; };
const ctPlace = (pl) => pl ? `${esc(pl.fixture)} → ${esc(pl.row)} → ${esc(pl.pos)}` : '';
const ctPlanoUrl = (pl) => `planogram.html?wh=${encodeURIComponent(pl.wh)}&fid=${encodeURIComponent(pl.fid)}&si=${pl.si}&ki=${pl.ki}`;
function ctPhoto(url, cls) {
  return url ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'${cls} ct-noph',textContent:'Нет фото'}))">`
    : `<div class="${cls} ct-noph">Нет фото</div>`;
}
function ctBadge(b) { return b ? `<span class="ct-badge ${esc(b.id)}">${esc(b.label)}</span>` : ''; }
function ctQS(extra) {
  const f = { ...CT.f, ...(extra || {}) };
  const p = new URLSearchParams({ action: 'catalog', sub: 'board', page: String(CT.page), per: String(CT.per) });
  Object.entries(f).forEach(([k, v]) => { if (v !== '' && v != null) p.set(k, v); });
  return '?' + p.toString();
}

async function renderCatalog(force) {
  const box = $('scBody'); if (!box) return;
  if (!box.querySelector('.ct-wrap')) {
    box.innerHTML = `<div class="ct-wrap">
      <div class="card ct-filters" id="ctFilters"></div>
      <div class="ct-chips" id="ctChips"></div>
      <div class="ct-main">
        <div class="ct-list">
          <div class="ct-bar" id="ctBar"></div>
          <div class="ct-grid" id="ctGrid"><div class="loading">⏳ Загружаю товары…</div></div>
          <div class="ct-pager" id="ctPager"></div>
        </div>
        <aside class="card ct-det" id="ctDet"></aside>
      </div>
    </div>`;
    ctPaintFilters();
  }
  await ctLoad(force);
}

function ctOpts(list, sel, first) {
  return `<option value="">${esc(first)}</option>` + (list || []).map(x => {
    const v = typeof x === 'string' ? x : x.v, n = typeof x === 'string' ? null : x.n;
    return `<option value="${esc(v)}" ${String(sel) === String(v) ? 'selected' : ''}>${esc(v)}${n != null ? ` (${n})` : ''}</option>`;
  }).join('');
}
function ctPaintFilters() {
  const el = $('ctFilters'); if (!el) return;
  const d = CT.data || {}; const fc = d.facets || {}; const f = CT.f;
  const groups = d.groups || [];
  el.innerHTML = `
    <div class="ct-row1">
      <div class="ct-q">${CT_I.search}<input class="finput" id="ctQ" value="${esc(f.q)}" autocomplete="off" placeholder="Поиск по названию, артикулу, штрихкоду, бренду, поставщику, цвету или месту (B-1)…"><button class="ct-scan" id="ctScan" title="Сканировать штрихкод: наведите сканер и нажмите кнопку">${CT_I.scan}</button></div>
      <button class="btn ct-advbtn ${CT.adv ? 'on' : ''}" id="ctAdv">${CT_I.filt} Расширенные фильтры ${CT_I.down}</button>
    </div>
    <div class="ct-grid6">
      <label class="ct-f"><span>Категория</span><select class="fselect" data-f="cat"><option value="">Все категории</option>${groups.map(g => `<option value="${g.id}" ${f.cat === g.id ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}</select></label>
      <label class="ct-f"><span>Бренд</span><select class="fselect" data-f="brand">${ctOpts(fc.brands, f.brand, 'Все бренды')}</select></label>
      <label class="ct-f"><span>Размер</span><select class="fselect" data-f="size">${ctOpts(fc.sizes, f.size, 'Все размеры')}</select></label>
      <label class="ct-f"><span>Поставщик</span><select class="fselect" data-f="supplier">${ctOpts(fc.suppliers, f.supplier, 'Все поставщики')}</select></label>
      <label class="ct-f"><span>Склад</span><select class="fselect" data-f="wh"><option value="">Все склады</option>${(d.warehouses || []).map(w => `<option value="${w.id}" ${f.wh === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label>
      <label class="ct-f"><span>Наличие на витрине</span><select class="fselect" data-f="show"><option value="">Все товары</option><option value="on" ${f.show === 'on' ? 'selected' : ''}>Есть на витрине</option><option value="off" ${f.show === 'off' ? 'selected' : ''}>Нет на витрине</option></select></label>
    </div>
    <div class="ct-adv ${CT.adv ? '' : 'hide'}">
      <label class="ct-f ct-w2"><span>Дата поступления</span><div class="ct-range">${CT_I.cal}<input type="date" class="finput" data-f="from" value="${esc(f.from)}"><i>—</i><input type="date" class="finput" data-f="to" value="${esc(f.to)}"></div></label>
      <label class="ct-f"><span>Цена, ${CUR}</span><div class="ct-range"><input class="finput" inputmode="numeric" data-f="pmin" value="${esc(f.pmin)}" placeholder="От"><i>—</i><input class="finput" inputmode="numeric" data-f="pmax" value="${esc(f.pmax)}" placeholder="До"></div></label>
      <label class="ct-f"><span>Количество, шт.</span><div class="ct-range"><input class="finput" inputmode="numeric" data-f="qmin" value="${esc(f.qmin)}" placeholder="От"><i>—</i><input class="finput" inputmode="numeric" data-f="qmax" value="${esc(f.qmax)}" placeholder="До"></div></label>
      <label class="ct-f"><span>Цвет</span><select class="fselect" data-f="color">${ctOpts(fc.colors, f.color, 'Все цвета')}</select></label>
      <label class="ct-f"><span>Сезон</span><select class="fselect" data-f="season">${ctOpts(fc.seasons, f.season, 'Все сезоны')}</select></label>
      <label class="ct-f"><span>Статус</span><select class="fselect" data-f="status">${CT_STATUS.map(([v, l]) => `<option value="${v}" ${f.status === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label class="ct-f ct-wsort"><span>Сортировка</span><select class="fselect" data-f="sort">${CT_SORTS.map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <div class="ct-acts"><button class="btn btn-primary" id="ctApply">${CT_I.filt} Применить</button><button class="btn" id="ctReset">${CT_I.reset} Сбросить</button></div>
    </div>`;
  const read = () => { el.querySelectorAll('[data-f]').forEach(x => { CT.f[x.dataset.f] = x.value.trim(); }); CT.f.q = $('ctQ').value.trim(); };
  const go = () => { read(); CT.page = 0; ctLoad(); };
  el.querySelectorAll('select[data-f]').forEach(x => x.addEventListener('change', go));
  el.querySelectorAll('input[data-f]').forEach(x => { x.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }); if (x.type === 'date') x.addEventListener('change', go); });
  let tq = null;
  $('ctQ').addEventListener('input', () => { clearTimeout(tq); tq = setTimeout(go, 400); });
  $('ctQ').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(tq); go(); } });
  $('ctScan').addEventListener('click', () => { const i = $('ctQ'); i.value = ''; i.focus(); docToast('Отсканируйте штрихкод — поиск начнётся сам'); });
  $('ctApply').addEventListener('click', go);
  $('ctReset').addEventListener('click', () => { Object.keys(CT.f).forEach(k => { CT.f[k] = ''; }); CT.f.sort = 'qty_desc'; CT.page = 0; ctPaintFilters(); ctLoad(); });
  $('ctAdv').addEventListener('click', () => { CT.adv = !CT.adv; localStorage.setItem('ct_adv', CT.adv ? '1' : '0'); el.querySelector('.ct-adv').classList.toggle('hide', !CT.adv); $('ctAdv').classList.toggle('on', CT.adv); });
}

async function ctLoad(force) {
  const seq = ++CT.seq;
  const grid = $('ctGrid'); if (grid && !CT.data) grid.innerHTML = '<div class="loading">⏳ Загружаю товары… (первый раз до 10 сек)</div>';
  if (grid && CT.data) grid.classList.add('ct-busy');
  try {
    const d = await posApi(ctQS(force ? { fresh: '1' } : null), { method: 'GET' });
    if (seq !== CT.seq) return;
    const first = !CT.data;
    CT.data = d;
    if (first) { const q = $('ctQ'); const v = q ? q.value : ''; const foc = document.activeElement === q; ctPaintFilters(); const q2 = $('ctQ'); if (q2) { q2.value = v; if (foc) q2.focus(); } }
    else ctRefreshFacets();
    ctPaintChips(); ctPaintBar(); ctPaintGrid(); ctPaintPager();
    // точное совпадение штрихкода — сразу открыть товар
    if (d.bcHit && d.bcHit.pid) { CT.hlBc = d.bcHit.bc; CT.detTab = 'show'; ctOpen(d.bcHit.pid, true); }
    else if (CT.pid && !$('ctDet').classList.contains('open')) ctPaintDet();
    if (!CT.pid) ctPaintDet();
    if (typeof bumpSync === 'function') bumpSync();
  } catch (e) {
    if (seq !== CT.seq) return;
    if (grid) grid.innerHTML = errBar('Не удалось загрузить товары: ' + (e.message || e));
  } finally { if (grid) grid.classList.remove('ct-busy'); }
}
// обновить списки фасетов, не трогая поле поиска (фокус и курсор)
function ctRefreshFacets() {
  const d = CT.data || {}; const fc = d.facets || {}; const el = $('ctFilters'); if (!el) return;
  const set = (k, list, first) => { const s = el.querySelector(`select[data-f="${k}"]`); if (s) s.innerHTML = ctOpts(list, CT.f[k], first); };
  set('brand', fc.brands, 'Все бренды'); set('size', fc.sizes, 'Все размеры'); set('supplier', fc.suppliers, 'Все поставщики');
  set('color', fc.colors, 'Все цвета'); set('season', fc.seasons, 'Все сезоны');
}

function ctPaintChips() {
  const el = $('ctChips'); const d = CT.data; if (!el || !d) return;
  const chip = (id, label, n) => `<button class="ct-chip ${CT.f.cat === id ? 'on' : ''}" data-cat="${id}"><span class="ct-chip-ic">${ctSvg(id || 'all', 20)}</span><span><b>${esc(label)}</b><em>${ctNum(n)}</em></span></button>`;
  el.innerHTML = chip('', 'Все товары', d.chipsAll) + (d.chips || []).map(c => chip(c.id, c.label, c.n)).join('');
  el.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => {
    CT.f.cat = b.dataset.cat; CT.page = 0;
    const s = document.querySelector('#ctFilters select[data-f="cat"]'); if (s) s.value = CT.f.cat;
    ctLoad();
  }));
}
function ctPaintBar() {
  const el = $('ctBar'); const d = CT.data; if (!el || !d) return;
  el.innerHTML = `<div class="ct-found">Найдено <b>${ctNum(d.total)}</b> ${plural(d.total, 'товар', 'товара', 'товаров')} · <span>${ctNum(d.totalQty)} шт.</span></div>
    <div class="ct-bar-r"><label>Показывать по <select class="fselect" id="ctPer">${[24, 48, 96].map(n => `<option ${CT.per === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <button class="btn btn-sm" id="ctRefresh" title="Обновить остатки">↻</button></div>`;
  $('ctPer').addEventListener('change', e => { CT.per = Number(e.target.value) || 24; CT.page = 0; ctLoad(); });
  $('ctRefresh').addEventListener('click', () => ctLoad(true));
}
function plural(n, a, b, c) { n = Math.abs(n) % 100; const n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; }

function ctCard(c) {
  const sz = c.sizes || []; const shown = sz.slice(0, 5);
  const showTxt = !c.qty ? '' : (c.show > 0 ? `<span class="ct-show on">На витрине: <b>${ctNum(c.show)} шт.</b></span>`
    : c.model ? `<span class="ct-show part">На витрине: модель</span>`
    : c.scopeHasPlano ? `<span class="ct-show off">Нет на витрине</span>` : `<span class="ct-show na">Витрина не настроена</span>`);
  const whs = c.byWh || []; const isOpen = !!CT.open[c.id];
  const whRows = (isOpen ? whs : whs.slice(0, 4)).map(w => `<div class="ct-wh"><span>${CT_I.store} ${esc(w.name)}</span><b>${ctNum(w.n)}</b></div>`).join('');
  return `<article class="ct-card ${CT.pid === c.id ? 'sel' : ''}" data-pid="${esc(c.id)}">
    <div class="ct-ph">${ctBadge(c.badge)}${ctPhoto(c.photo, 'ct-img')}</div>
    <div class="ct-body">
      <div class="ct-name" title="${esc(c.name)}">${esc(c.name)}</div>
      <div class="ct-sub">${esc(c.sub || '')}${c.brand ? ` · ${esc(c.brand)}` : ''}</div>
      ${c.sku ? `<div class="ct-meta">Арт. ${esc(c.sku)}</div>` : ''}
      ${c.barcode ? `<div class="ct-meta ct-bcl">${CT_I.bc} ${esc(c.barcode)}</div>` : ''}
      <div class="ct-sizes">${shown.map(s => `<span title="${ctNum(s.n)} шт.">${esc(s.s)}</span>`).join('')}${sz.length > 5 ? `<span class="more">+${sz.length - 5}</span>` : ''}${!sz.length ? '<span class="none">нет размеров в наличии</span>' : ''}</div>
      <div class="ct-price">${c.priceMax > c.priceMin && c.priceMin > 0 ? `${ctNum(c.priceMin)}–${ctMoney(c.priceMax)}` : (c.price ? ctMoney(c.price) : '—')}</div>
      <div class="ct-tot"><span>${CT_I.box} Всего: <b>${ctNum(c.qty)} шт.</b></span>${showTxt}</div>
      ${whs.length ? `<div class="ct-whs">${whRows}${whs.length > 4 ? `<button class="ct-more" data-more="${esc(c.id)}">${isOpen ? 'Свернуть' : `Ещё ${whs.length - 4}`} ${CT_I.down}</button>` : ''}</div>` : '<div class="ct-whs ct-empty">Нет на складах</div>'}
    </div>
  </article>`;
}
function ctPaintGrid() {
  const el = $('ctGrid'); const d = CT.data; if (!el || !d) return;
  el.innerHTML = (d.cards || []).length ? d.cards.map(ctCard).join('') : '<div class="ct-nores">Ничего не найдено. Измените запрос или сбросьте фильтры.</div>';
  el.querySelectorAll('.ct-card').forEach(a => a.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) { const id = e.target.closest('[data-more]').dataset.more; CT.open[id] = !CT.open[id]; ctPaintGrid(); return; }
    CT.hlBc = ''; ctOpen(a.dataset.pid);
  }));
}
function ctPaintPager() {
  const el = $('ctPager'); const d = CT.data; if (!el || !d) return;
  if (d.pages <= 1) { el.innerHTML = ''; return; }
  const cur = d.page; const btn = (p, l, dis) => `<button class="btn btn-sm ${p === cur ? 'btn-primary' : ''}" data-pg="${p}" ${dis ? 'disabled' : ''}>${l}</button>`;
  const pages = []; for (let i = Math.max(0, cur - 2); i <= Math.min(d.pages - 1, cur + 2); i++) pages.push(i);
  el.innerHTML = btn(cur - 1, '← Назад', cur <= 0) + (pages[0] > 0 ? btn(0, '1') + (pages[0] > 1 ? '<span>…</span>' : '') : '') + pages.map(p => btn(p, String(p + 1))).join('')
    + (pages[pages.length - 1] < d.pages - 1 ? (pages[pages.length - 1] < d.pages - 2 ? '<span>…</span>' : '') + btn(d.pages - 1, String(d.pages)) : '') + btn(cur + 1, 'Вперёд →', cur >= d.pages - 1);
  el.querySelectorAll('[data-pg]').forEach(b => b.addEventListener('click', () => { CT.page = Number(b.dataset.pg); ctLoad(); const g = $('ctGrid'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
}

// ——— панель товара ———
async function ctOpen(pid, fromScan) {
  CT.pid = pid; CT.det = null;
  document.querySelectorAll('.ct-card').forEach(a => a.classList.toggle('sel', a.dataset.pid === pid));
  const el = $('ctDet'); el.classList.add('open'); document.body.classList.add('ct-det-open');
  el.innerHTML = '<div class="loading">⏳ Загружаю товар…</div>';
  try {
    const d = await posApi(`?action=catalog&sub=detail&id=${encodeURIComponent(pid)}`, { method: 'GET' });
    if (CT.pid !== pid) return;
    CT.det = d;
    // склад для вкладки «Витрина»: по штрихкоду → его склад; иначе выбранный в фильтре; иначе склад со схемой витрины; иначе самый большой остаток
    const hlU = CT.hlBc && d.units.find(u => u.bc === CT.hlBc);
    const ws = d.matrix.whs || [];
    CT.detWh = (hlU && hlU.wh) || (CT.f.wh && ws.some(w => w.id === CT.f.wh) ? CT.f.wh : '') || (ws.find(w => w.plano) || {}).id || (ws[0] || {}).id || CT.f.wh || '';
    if (!fromScan && !['stock', 'show', 'sales', 'recv', 'moves'].includes(CT.detTab)) CT.detTab = 'show';
    ctPaintDet();
  } catch (e) { el.innerHTML = `<div class="ct-det-h"><b>Ошибка</b><button class="ct-x" id="ctX">${CT_I.x}</button></div>` + errBar(e.message || String(e)); const x = $('ctX'); if (x) x.onclick = ctClose; }
}
function ctClose() { CT.pid = ''; CT.det = null; CT.hlBc = ''; const el = $('ctDet'); el.classList.remove('open'); document.body.classList.remove('ct-det-open'); document.querySelectorAll('.ct-card.sel').forEach(a => a.classList.remove('sel')); ctPaintDet(); }
function ctPaintDet() {
  const el = $('ctDet'); if (!el) return;
  const d = CT.det;
  if (!d) {
    if (CT.pid) return;
    el.innerHTML = `<div class="ct-det-empty">${ctSvg('all', 40)}<b>Выберите товар</b><span>Нажмите на карточку — здесь появятся размеры, остатки, места на витрине, продажи, поступления и перемещения.</span><span class="muted">Сканер: отсканируйте штрихкод в поле поиска — товар откроется сам, а пара подсветится.</span></div>`;
    return;
  }
  const p = d.product;
  const photos = p.photos || [];
  const info = [
    ['Артикул', p.sku], ['Штрихкод', p.barcode ? `${esc(p.barcode)} <button class="ct-copy" data-copy="${esc(p.barcode)}" title="Скопировать">${CT_I.copy}</button>` : '', true],
    ['Бренд', p.brand], ['Категория', p.grp || p.category], ['Поставщик', p.supplier], ['Дата поступления', p.lastRecv ? ctDM(p.lastRecv) : ''],
    ['Сезон', p.season], ['Цена продажи', p.price ? `<b>${p.priceMax > p.priceMin && p.priceMin > 0 ? ctNum(p.priceMin) + '–' + ctMoney(p.priceMax) : ctMoney(p.price)}</b>` : '', true],
    ['Себестоимость', p.cost ? `<b>${ctMoney(p.cost)}</b>` : '', true], ['Продано за 30 дн.', p.sold30 ? ctNum(p.sold30) + ' шт.' : '0'],
  ].filter(r => r[1]);
  const TABS = [['stock', 'Остатки'], ['show', 'Витрина'], ['sales', 'Продажи'], ['recv', 'Поступления'], ['moves', 'Перемещения']];
  el.innerHTML = `
    <div class="ct-det-h"><div><div class="ct-det-t">${esc(p.name)} ${ctBadge(p.badge)}</div><div class="ct-det-s">${esc(p.sub || '')}</div></div><button class="ct-x" id="ctX" title="Закрыть">${CT_I.x}</button></div>
    <div class="ct-det-top">
      <div class="ct-gal">${ctPhoto(photos[0], 'ct-gal-main')}${photos.length > 1 ? `<div class="ct-thumbs">${photos.slice(0, 5).map((u, i) => `<button data-ph="${i}" class="${i === 0 ? 'on' : ''}"><img src="${esc(u)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}</div>
      <dl class="ct-info">${info.map(([k, v, raw]) => `<dt>${esc(k)}:</dt><dd>${raw ? v : esc(v)}</dd>`).join('')}</dl>
    </div>
    <div class="ct-sec-t">Размеры в наличии <span class="muted">· всего ${ctNum(d.total)} шт.</span></div>
    <div class="ct-szgrid">${(d.sizes || []).length ? d.sizes.map(s => `<div><b>${esc(s.s)}</b><span>${ctNum(s.n)} шт.</span></div>`).join('') : '<span class="muted">Нет в наличии</span>'}</div>
    <div class="ct-tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${CT.detTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="ct-tab" id="ctTab"></div>`;
  $('ctX').onclick = ctClose;
  el.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { CT.detTab = b.dataset.tab; el.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b)); ctPaintTab(); }));
  el.querySelectorAll('[data-ph]').forEach(b => b.addEventListener('click', () => { const m = el.querySelector('.ct-gal-main'); if (m && m.tagName === 'IMG') m.src = photos[Number(b.dataset.ph)]; el.querySelectorAll('[data-ph]').forEach(x => x.classList.toggle('on', x === b)); }));
  el.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); navigator.clipboard && navigator.clipboard.writeText(b.dataset.copy).then(() => docToast('Штрихкод скопирован')); }));
  ctPaintTab();
}
function ctPaintTab() {
  const el = $('ctTab'); const d = CT.det; if (!el || !d) return;
  const t = CT.detTab;
  if (t === 'stock') {
    const m = d.matrix; const whs = m.whs || [];
    if (!whs.length) { el.innerHTML = '<div class="ct-empty">Нет в наличии ни на одном складе.</div>'; return; }
    el.innerHTML = `<div class="ct-tblw"><table class="ct-tbl ct-mx"><thead><tr><th>Склад</th>${m.sizes.map(s => `<th class="c">${esc(s)}</th>`).join('')}<th class="c">Всего</th></tr></thead><tbody>
      ${whs.map(w => `<tr><td class="strong">${esc(w.name)}</td>${m.sizes.map(s => { const n = m.cells[w.id + '|' + s] || 0; return `<td class="c ${n ? '' : 'z'}">${n || '—'}</td>`; }).join('')}<td class="c strong">${ctNum(w.n)}</td></tr>`).join('')}
      <tr class="tot"><td>Итого</td>${m.sizes.map(s => `<td class="c">${ctNum(whs.reduce((a, w) => a + (m.cells[w.id + '|' + s] || 0), 0))}</td>`).join('')}<td class="c">${ctNum(d.total)}</td></tr></tbody></table></div>
      <div class="ct-sec-t" style="margin-top:14px">Уникальные коды и EAN-13</div>
      <div class="ps-detail" id="psDet_${esc(d.product.id)}"></div>`;
    if (typeof loadProductDetail === 'function') loadProductDetail(d.product.id);
    return;
  }
  if (t === 'show') { ctPaintShow(el, d); return; }
  if (t === 'sales') {
    const s = d.sales;
    el.innerHTML = `<div class="ct-kpis"><div><span>30 дн.</span><b>${ctNum(s.d30)} шт.</b></div><div><span>90 дн.</span><b>${ctNum(s.d90)} шт.</b></div><div><span>Всего</span><b>${ctNum(s.all)} шт.</b></div></div>
      ${s.rows.length ? `<div class="ct-tblw"><table class="ct-tbl"><thead><tr><th>Дата</th><th>Магазин</th><th class="c">Размер</th><th>Штрихкод</th><th>Продавец</th><th>Чек</th></tr></thead><tbody>
      ${s.rows.map(r => `<tr><td class="nw">${ctDT(r.at)}</td><td>${esc(r.shop)}</td><td class="c">${esc(r.size)}</td><td class="mono">${esc(r.bc)}</td><td>${esc(r.seller || '—')}</td><td class="mono">${esc(r.receipt || '—')}</td></tr>`).join('')}
      </tbody></table></div>${s.all > s.rows.length ? `<div class="muted ct-note">Показаны последние ${s.rows.length} продаж.</div>` : ''}` : '<div class="ct-empty">Продаж этого товара пока нет.</div>'}`;
    return;
  }
  if (t === 'recv') {
    el.innerHTML = `${d.receipts.length ? `<div class="ct-sec-t">Документы поступления</div><div class="ct-tblw"><table class="ct-tbl"><thead><tr><th>Дата</th><th>Поставщик</th><th>Склад</th><th class="r">Кол-во</th><th class="r">Закуп</th><th class="r">Цена</th></tr></thead><tbody>
      ${d.receipts.map(r => `<tr><td class="nw">${ctDM(r.date)}</td><td>${esc(r.supplier || '—')}</td><td>${esc(r.wh || '—')}</td><td class="r">${ctNum(r.qty)}</td><td class="r">${r.cost ? ctMoney(r.cost) : '—'}</td><td class="r">${r.price ? ctMoney(r.price) : '—'}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="ct-sec-t">Партии экземпляров по дате</div>
      ${d.batches.length ? `<div class="ct-tblw"><table class="ct-tbl"><thead><tr><th>Дата</th><th>Документ</th><th class="r">Пришло</th><th class="r">Сейчас в наличии</th></tr></thead><tbody>
      ${d.batches.map(b => `<tr><td class="nw">${ctDM(b.date)}</td><td>${esc(b.doc || '—')}</td><td class="r">${ctNum(b.n)}</td><td class="r">${ctNum(b.inStock)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="ct-empty">Нет данных о поступлениях.</div>'}`;
    return;
  }
  if (t === 'moves') {
    el.innerHTML = d.moves.length ? `<div class="ct-tblw"><table class="ct-tbl"><thead><tr><th>Дата</th><th>Документ</th><th>Откуда → Куда</th><th class="r">Пар</th><th>Размеры</th></tr></thead><tbody>
      ${d.moves.map(m => `<tr><td class="nw">${ctDT(m.date)}</td><td class="mono">${esc(m.number || '—')}</td><td>${esc(m.from)} → ${esc(m.to)}${m.status !== 'posted' ? ' <span class="ct-pill amber">в пути</span>' : ''}</td><td class="r">${ctNum(m.n)}</td><td class="sm">${Object.entries(m.sizes).map(([s, n]) => `${esc(s)}×${n}`).join(', ')}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="ct-empty">Перемещений этого товара не было.</div>';
  }
}
function ctPaintShow(el, d) {
  const ws = d.matrix.whs || [];
  const planoSet = new Set(d.planoStores || []);
  const wh = CT.detWh;
  const units = d.units.filter(u => u.wh === wh);
  const placed = units.filter(u => u.place);
  const has = planoSet.has(wh);
  const models = (d.modelPlaces || []).filter(m => m.wh === wh && !m.bound);
  const status = placed.length ? '<span class="ct-pill green">● Есть на витрине</span>' : (models.length ? '<span class="ct-pill amber">● Модель на витрине</span>' : '<span class="ct-pill red">● Нет на витрине</span>');
  const whOpts = ws.map(w => `<option value="${w.id}" ${w.id === wh ? 'selected' : ''}>${esc(w.name)} — ${ctNum(w.n)} шт.</option>`).join('') || `<option>Нет в наличии</option>`;
  // сначала выставленные, потом остальные; подсвеченный штрихкод — первым
  const rows = [...units].sort((a, b) => (b.bc === CT.hlBc) - (a.bc === CT.hlBc) || (!!b.place - !!a.place) || 0);
  const LIM = 150;
  const firstPl = placed[0] && placed[0].place;
  el.innerHTML = `
    <div class="ct-show-h"><div class="ct-sec-t" style="margin:0">Наличие на витрине ${status}</div><label class="ct-whsel">${CT_I.store}<select class="fselect" id="ctShowWh">${whOpts}</select></label></div>
    ${!has && units.length ? `<div class="ct-hint">Для магазина «${esc((ws.find(w => w.id === wh) || {}).name || '')}» схема витрины (адресное хранение) ещё не заведена — все пары здесь числятся как «Нет на витрине».</div>` : ''}
    ${units.length ? `<div class="ct-tblw"><table class="ct-tbl ct-showt"><thead><tr><th class="c">Размер</th><th>Штрихкод</th><th>Место на витрине</th><th class="c">Кол-во</th></tr></thead><tbody>
      ${rows.slice(0, LIM).map(u => `<tr class="${u.bc && u.bc === CT.hlBc ? 'hl' : ''}"><td class="c strong">${esc(u.size)}</td><td class="mono">${esc(u.bc || '—')}</td>
        <td>${u.place ? `<a class="ct-placel" href="${ctPlanoUrl(u.place)}" target="_blank" rel="noopener" title="Открыть на плане витрины">${ctPlace(u.place)}</a>` : `<span class="ct-pill red">Нет на витрине</span>${u.placeElsewhere ? `<div class="muted sm">привязан к витрине «${esc(u.placeElsewhere.whName)}»</div>` : ''}`}</td>
        <td class="c strong">${u.place ? '1 шт.' : '—'}</td></tr>`).join('')}
    </tbody></table></div>${rows.length > LIM ? `<div class="muted ct-note">Показаны ${LIM} из ${ctNum(rows.length)} пар (сначала выставленные на витрину).</div>` : ''}
    <div class="ct-show-sum">На витрине: <b>${ctNum(placed.length)}</b> из ${ctNum(units.length)} шт.</div>` : '<div class="ct-empty">В этом магазине товара нет.</div>'}
    ${models.length ? `<div class="ct-hint">Модель выставлена без привязки штрихкода: ${models.map(m => `<a class="ct-placel" href="${ctPlanoUrl(m)}" target="_blank" rel="noopener">${ctPlace(m)}</a>`).join(', ')}</div>` : ''}
    ${has ? `<a class="btn ct-planbtn" href="${firstPl ? ctPlanoUrl(firstPl) : (models[0] ? ctPlanoUrl(models[0]) : 'planogram.html?wh=' + encodeURIComponent(wh))}" target="_blank" rel="noopener">${CT_I.pin} Показать на плане витрины</a>` : ''}
    ${ws.filter(w => w.id !== wh).length ? `<div class="ct-sec-t" style="margin-top:16px">Витрина в других магазинах</div>
      <div class="ct-others">${ws.filter(w => w.id !== wh).map(w => `<div class="ct-oth"><span>${CT_I.store} <b>${esc(w.name)}</b> — ${ctNum(w.n)} шт.</span>${w.show > 0 ? `<span class="ct-pill green">На витрине: ${ctNum(w.show)} шт.</span>` : `<span class="ct-pill red">Нет на витрине</span>`}<button class="btn btn-sm" data-wh="${w.id}">Открыть</button></div>`).join('')}</div>` : ''}`;
  const s = $('ctShowWh'); if (s) s.addEventListener('change', () => { CT.detWh = s.value; ctPaintShow(el, d); });
  el.querySelectorAll('[data-wh]').forEach(b => b.addEventListener('click', () => { CT.detWh = b.dataset.wh; ctPaintShow(el, d); }));
}
