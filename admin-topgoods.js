// ═════════════════════════════════════════════════════════════════════
//  ТОП ТОВАРОВ (v1.5.4) — новое окно «Продажи по товарам» Админ РМК.
//  Лента мини-карточек самых продаваемых товаров → клик → чеки товара,
//  продажи по дням, остатки магазин × размер, прогноз и рекомендация закупки.
//  Backend: /api/pos?action=product-board&sub=board|detail|find
// ═════════════════════════════════════════════════════════════════════
const TG = {
  preset: 30, from: '', to: '', wh: '', tab: 'top', q: '',
  board: null, boardKey: '', pid: '', detail: null, detKey: '',
  page: 0, per: 10, chartMetric: 'qty', horizon: 30, loading: false,
};
const TG_TABS = [
  { id: 'top', label: 'Топ продаж' },
  { id: 'revenue', label: 'По выручке' },
  { id: 'growth', label: 'Рост спроса' },
  { id: 'low', label: 'Мало осталось' },
  { id: 'dead', label: 'Неликвиды' },
  { id: 'all', label: 'Все товары' },
];
const tgM = (n) => `${fmtInt(Math.round(Number(n) || 0))} ${CUR}`;
const tgDay = (iso) => { const d = new Date(new Date(iso).getTime() + 5 * 3600e3); return d.toISOString().slice(0, 10); };
const tgYmdShift = (s, n) => new Date(new Date(s + 'T00:00:00Z').getTime() + n * 86400e3).toISOString().slice(0, 10);
const tgDT = (iso) => { const d = new Date(new Date(iso).getTime() + 5 * 3600e3).toISOString(); return `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)} ${d.slice(11, 16)}`; };
const tgDM = (s) => { const p = String(s).slice(0, 10).split('-'); return `${p[2]}.${p[1]}.${p[0]}`; };
function tgTrend(pct, small) {
  if (pct === null || pct === undefined) return `<span class="tg-tr new">${small ? 'нов.' : 'новый'}</span>`;
  if (!pct) return `<span class="tg-tr flat">0%</span>`;
  return `<span class="tg-tr ${pct > 0 ? 'up' : 'down'}">${pct > 0 ? '+' : ''}${pct}%</span>`;
}
const tgPct = (a, b) => (b > 0 ? Math.round((a - b) / b * 100) : (a > 0 ? null : 0));
function tgPhoto(url, cls) {
  return url ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'${cls} tg-noph',textContent:'📦'}))">`
    : `<div class="${cls} tg-noph">📦</div>`;
}

// ——— штрихкод EAN-13 → SVG ———
function tgEan13(code) {
  const s = String(code || '');
  if (!/^\d{13}$/.test(s)) return `<div class="tg-bc-txt">${esc(s || '—')}</div>`;
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const R = L.map(p => p.split('').map(b => (b === '1' ? '0' : '1')).join(''));
  const G = R.map(p => p.split('').reverse().join(''));
  const PAR = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const par = PAR[+s[0]];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (par[i - 1] === 'L' ? L : G)[+s[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[+s[i]];
  bits += '101';
  let rects = '';
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') rects += `<rect x="${i + 8}" y="0" width="1" height="${(i < 3 || (i >= 45 && i < 50) || i >= 92) ? 52 : 46}"/>`;
  return `<svg class="tg-bc" viewBox="0 0 111 62" preserveAspectRatio="xMidYMid meet" aria-label="${s}">
    <g fill="#111">${rects}</g>
    <text x="2" y="61" font-size="9" font-family="monospace">${s[0]}</text>
    <text x="12" y="61" font-size="9" font-family="monospace" textLength="40">${s.slice(1, 7)}</text>
    <text x="58" y="61" font-size="9" font-family="monospace" textLength="40">${s.slice(7)}</text></svg>`;
}

function tgPeriod() {
  if (TG.preset) {
    const to = dushToday();
    return { from: tgYmdShift(to, -(TG.preset - 1)), to };
  }
  return { from: TG.from || tgYmdShift(dushToday(), -29), to: TG.to || dushToday() };
}

async function renderTopGoods(force) {
  const box = $('psaBody'); if (!box) return;
  if (!box.querySelector('.tg-wrap')) {
    box.innerHTML = `<div class="tg-wrap">
      <div class="card tg-head">
        <div class="tg-head-top">
          <div class="tg-tools">
            <div class="tg-seg" id="tgPreset">
              ${[7, 30, 90].map(n => `<button data-p="${n}">${n} дн.</button>`).join('')}<button data-p="0">Свой</button>
            </div>
            <div class="tg-dates" id="tgDates"><input type="date" id="tgFrom" class="finput"><span>—</span><input type="date" id="tgTo" class="finput"></div>
            <select id="tgWh" class="fselect tg-wh"><option value="">Все магазины</option></select>
            <button class="btn btn-outline tg-exp" id="tgExport" title="Скачать список товаров (CSV для Excel)">⬇ Экспорт</button>
          </div>
        </div>
        <div class="tg-bar">
          <div class="tg-tabs" id="tgTabs">${TG_TABS.map(t => `<button data-t="${t.id}">${t.label}</button>`).join('')}</div>
          <div class="tg-search"><span>🔍</span><input id="tgQ" class="finput" autocomplete="off" placeholder="Поиск: название, артикул или штрихкод…"></div>
        </div>
        <div class="tg-sum" id="tgSum"></div>
        <div class="tg-strip-wrap">
          <button class="tg-arr l" id="tgArrL" aria-label="Назад">‹</button>
          <div class="tg-strip" id="tgStrip"><div class="loading">⏳ Считаю продажи…</div></div>
          <button class="tg-arr r" id="tgArrR" aria-label="Вперёд">›</button>
        </div>
      </div>
      <div class="tg-grid">
        <div class="tg-left">
          <div class="card tg-card" id="tgLines"></div>
          <div class="card tg-card" id="tgReco"></div>
        </div>
        <div class="card tg-card tg-right" id="tgSide"></div>
      </div>
    </div>`;
    tgWire();
  }
  tgSyncTools();
  await tgLoadBoard(force);
}

function tgWire() {
  $('tgPreset').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const p = +b.dataset.p;
    if (p) { TG.preset = p; } else { const cur = tgPeriod(); TG.preset = 0; TG.from = cur.from; TG.to = cur.to; }
    tgSyncTools(); if (p) tgLoadBoard();
  });
  const onDate = () => { TG.preset = 0; TG.from = $('tgFrom').value; TG.to = $('tgTo').value; if (TG.from && TG.to && TG.from <= TG.to) { tgSyncTools(); tgLoadBoard(); } };
  $('tgFrom').addEventListener('change', onDate); $('tgTo').addEventListener('change', onDate);
  $('tgWh').addEventListener('change', () => { TG.wh = $('tgWh').value; tgLoadBoard(); });
  $('tgTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; TG.tab = b.dataset.t; tgSyncTools(); tgRenderStrip(); });
  let qt = null;
  $('tgQ').addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { TG.q = $('tgQ').value.trim(); tgRenderStrip(); }, 200); });
  $('tgQ').addEventListener('keydown', e => { if (e.key === 'Enter') { TG.q = $('tgQ').value.trim(); tgFindCode(); } });
  const sc = (d) => { const s = $('tgStrip'); s.scrollBy({ left: d * Math.max(260, s.clientWidth * 0.8), behavior: 'smooth' }); };
  $('tgArrL').addEventListener('click', () => sc(-1)); $('tgArrR').addEventListener('click', () => sc(1));
  $('tgExport').addEventListener('click', tgExport);
}

function tgSyncTools() {
  const per = tgPeriod();
  document.querySelectorAll('#tgPreset button').forEach(b => b.classList.toggle('on', +b.dataset.p === TG.preset));
  $('tgDates').classList.toggle('show', !TG.preset);
  $('tgFrom').value = per.from; $('tgTo').value = per.to;
  document.querySelectorAll('#tgTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === TG.tab));
  $('tgArrL').style.display = $('tgArrR').style.display = TG.tab === 'all' ? 'none' : '';
  $('tgStrip').classList.toggle('wrap', TG.tab === 'all');
}

async function tgLoadBoard(force) {
  const per = tgPeriod();
  const key = `${per.from}|${per.to}|${TG.wh}`;
  if (!force && TG.board && TG.boardKey === key) { tgRenderStrip(); tgAfterBoard(); return; }
  TG.boardKey = key;
  $('tgStrip').innerHTML = `<div class="tg-skel">${'<div class="tg-mc sk"></div>'.repeat(8)}</div>`;
  $('tgSum').innerHTML = `<span class="muted">⏳ Считаю продажи за ${tgDM(per.from)} — ${tgDM(per.to)}…</span>`;
  try {
    const d = await posApi(`?action=product-board&sub=board&from=${per.from}&to=${per.to}${TG.wh ? '&wh=' + TG.wh : ''}`, { method: 'GET' });
    if (TG.boardKey !== key) return;
    TG.board = d;
    const sel = $('tgWh');
    if (sel.options.length <= 1 && d.warehouses) sel.innerHTML = `<option value="">Все магазины</option>` + d.warehouses.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
    sel.value = TG.wh;
    tgRenderStrip();
    tgAfterBoard();
    bumpSync && bumpSync();
  } catch (e) {
    $('tgStrip').innerHTML = errBar('Не удалось загрузить продажи: ' + (e.message || e));
    $('tgSum').innerHTML = '';
  }
}
function tgAfterBoard() {
  const list = tgList();
  if (!TG.pid || !(TG.board.items.concat(TG.board.dead)).some(x => x.pid === TG.pid)) {
    if (list[0]) tgSelect(list[0].pid); else { TG.pid = ''; tgRenderEmpty(); }
  } else tgSelect(TG.pid, true);
}

function tgList() {
  const b = TG.board; if (!b) return [];
  let L = TG.tab === 'dead' ? b.dead.slice() : b.items.slice();
  if (TG.tab === 'revenue') L.sort((a, c) => c.revenue - a.revenue);
  else if (TG.tab === 'growth') L = L.filter(x => x.qty >= 3 && (x.trend === null || x.trend > 0)).sort((a, c) => (c.qty - c.prevQty) - (a.qty - a.prevQty));
  else if (TG.tab === 'low') L = L.filter(x => x.qty >= 2 && x.cover !== null && x.cover <= 21).sort((a, c) => a.cover - c.cover);
  if (TG.q && !/^\d{4,}$/.test(TG.q)) {
    const q = TG.q.toLowerCase();
    L = L.filter(x => (x.name + ' ' + x.code + ' ' + x.category).toLowerCase().includes(q));
  }
  return L;
}

function tgCard(x, i) {
  const isDead = TG.tab === 'dead';
  const main = isDead ? `${fmtInt(x.stock)} <small>шт</small>`
    : TG.tab === 'revenue' ? `${fmtInt(Math.round(x.revenue))} <small>${CUR}</small>`
    : TG.tab === 'low' ? (x.stock ? `${fmtInt(x.stock)} <small>шт · ${x.cover} дн.</small>` : `0 <small>шт</small>`)
    : `${fmtInt(x.qty)} <small>прод.</small>`;
  const chip = isDead ? `<span class="tg-tr down">0 прод.</span>` : TG.tab === 'low' ? (x.stock ? `<span class="tg-tr ${x.cover <= 7 ? 'down' : 'warn'}">мало</span>` : `<span class="tg-tr down">нет</span>`) : tgTrend(x.trend, true);
  const rk = i < 3 && !isDead && TG.tab !== 'low' ? ` r${i + 1}` : '';
  return `<button class="tg-mc${x.pid === TG.pid ? ' on' : ''}" data-pid="${esc(x.pid)}" title="${esc(x.name)}">
    <span class="tg-rk${rk}">${i + 1}</span>
    ${tgPhoto(x.photo, 'tg-mc-ph')}
    <span class="tg-mc-n">${esc(x.name)}</span>
    <span class="tg-mc-c">${esc(x.category && x.category !== 'Товар' ? x.category : (x.code || ''))}</span>
    <span class="tg-mc-f"><b>${main}</b>${chip}</span>
  </button>`;
}

function tgRenderStrip() {
  const b = TG.board; if (!b) return;
  const L = tgList();
  const max = TG.tab === 'all' ? 400 : 60;
  const strip = $('tgStrip');
  strip.innerHTML = L.length ? L.slice(0, max).map(tgCard).join('') + (L.length > max ? `<div class="tg-more muted">ещё ${fmtInt(L.length - max)} — уточните поиск</div>` : '')
    : `<div class="tg-empty">${TG.tab === 'low' ? 'Нет товаров, которые скоро закончатся' : TG.tab === 'growth' ? 'Нет товаров с ростом продаж' : TG.q ? 'Ничего не найдено. Для поиска по штрихкоду нажмите Enter' : 'Нет продаж за период'}</div>`;
  strip.querySelectorAll('.tg-mc').forEach(el => el.addEventListener('click', () => tgSelect(el.dataset.pid)));
  const t = b.totals; const dq = tgPct(t.qty, t.prevQty), dr = tgPct(t.revenue, t.prevRevenue);
  $('tgSum').innerHTML = `<span><b>${fmtInt(t.products)}</b> товаров продавалось</span>
    <span><b>${fmtInt(t.qty)}</b> шт ${tgTrend(dq)}</span>
    <span><b>${tgM(t.revenue)}</b> ${tgTrend(dr)}</span>
    <span><b>${fmtInt(t.receipts)}</b> чеков</span>
    <span class="muted">сравнение с ${tgDM(b.prevFrom)} — ${tgDM(b.prevTo)}</span>`;
}

async function tgFindCode() {
  const code = TG.q.replace(/\D/g, '');
  if (code.length < 4) return;
  try {
    const d = await posApi(`?action=product-board&sub=find&code=${code}`, { method: 'GET' });
    if (d.items && d.items[0]) { tgSelect(d.items[0].pid); $('tgSide').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else alert('Товар по штрихкоду не найден');
  } catch (e) { alert('Ошибка поиска: ' + (e.message || e)); }
}

function tgRenderEmpty() {
  $('tgLines').innerHTML = `<div class="tg-ph">Выберите товар в ленте сверху</div>`;
  $('tgReco').innerHTML = ''; $('tgSide').innerHTML = '';
}

async function tgSelect(pid, keepPage) {
  TG.pid = pid; if (!keepPage) TG.page = 0;
  document.querySelectorAll('#tgStrip .tg-mc').forEach(el => el.classList.toggle('on', el.dataset.pid === pid));
  const per = tgPeriod();
  const key = `${pid}|${per.from}|${per.to}|${TG.wh}|${TG.horizon}`;
  if (TG.detail && TG.detKey === key) { tgRenderDetail(); return; }
  TG.detKey = key;
  $('tgSide').innerHTML = `<div class="loading">⏳ Загружаю товар…</div>`;
  $('tgLines').innerHTML = `<div class="loading">⏳ Загружаю чеки…</div>`;
  $('tgReco').innerHTML = '';
  try {
    const d = await posApi(`?action=product-board&sub=detail&pid=${encodeURIComponent(pid)}&from=${per.from}&to=${per.to}&horizon=${TG.horizon}${TG.wh ? '&wh=' + TG.wh : ''}`, { method: 'GET' });
    if (TG.detKey !== key) return;
    TG.detail = d;
    tgRenderDetail();
  } catch (e) {
    if (TG.detKey !== key) return;
    $('tgSide').innerHTML = errBar('Не удалось загрузить товар: ' + (e.message || e));
    $('tgLines').innerHTML = '';
  }
}

function tgRenderDetail() {
  const d = TG.detail; if (!d) return;
  tgRenderLines(); tgRenderReco(); tgRenderSide();
}

// ——— таблица чеков ———
function tgRenderLines() {
  const d = TG.detail; const L = d.lines || [];
  const pages = Math.max(1, Math.ceil(L.length / TG.per));
  if (TG.page >= pages) TG.page = pages - 1;
  const sl = L.slice(TG.page * TG.per, TG.page * TG.per + TG.per);
  const hasDoc = L.some(r => r.doctor), hasCli = L.some(r => r.client); // пустые колонки не показываем
  const pg = [];
  const add = (i) => pg.push(`<button class="tg-pg${i === TG.page ? ' on' : ''}" data-pg="${i}">${i + 1}</button>`);
  if (pages <= 7) for (let i = 0; i < pages; i++) add(i);
  else { add(0); if (TG.page > 2) pg.push('<span class="tg-pg-dots">…</span>'); for (let i = Math.max(1, TG.page - 1); i <= Math.min(pages - 2, TG.page + 1); i++) add(i); if (TG.page < pages - 3) pg.push('<span class="tg-pg-dots">…</span>'); add(pages - 1); }
  $('tgLines').innerHTML = `
    <div class="tg-h"><div><h3>Продажи товара</h3><div class="tg-hs">Чеки с этим товаром за ${tgDM(d.from)} — ${tgDM(d.to)}${TG.wh ? ' · ' + esc(($('tgWh').selectedOptions[0] || {}).text || '') : ''}</div></div></div>
    <div class="tbl-wrap tg-tw">
      <table class="tbl tg-tbl">
        <thead><tr><th>№ чека</th><th>Дата и время</th><th>Магазин</th><th class="c">Размер</th><th class="c">Кол.</th><th class="r">Сумма</th><th>Продавец</th>${hasDoc ? '<th>Врач</th>' : ''}${hasCli ? '<th>Клиент</th>' : ''}<th></th></tr></thead>
        <tbody>${sl.length ? sl.map(r => `<tr class="tg-lr${r.op === 'return' ? ' tg-ret' : ''}" data-ref="${esc(r.ref)}" data-num="${esc(r.number)}">
          <td class="strong">${esc(r.number)}${r.op === 'return' ? ' <span class="badge r">возврат</span>' : ''}</td>
          <td class="nw">${tgDT(r.at)}</td>
          <td>${esc(r.shop)}</td>
          <td class="c">${esc(r.size)}</td>
          <td class="c">${fmtInt(r.qty)}</td>
          <td class="r nw"><b>${tgM(r.sum)}</b><div class="tg-sub2">${tgM(r.price)}${r.discount ? ` · −${r.discount}%` : ''}</div></td>
          <td class="tg-nm">${esc(r.seller || '—')}</td>
          ${hasDoc ? `<td class="tg-nm">${esc(r.doctor || '—')}</td>` : ''}
          ${hasCli ? `<td class="tg-nm">${esc(r.client || '—')}</td>` : ''}
          <td class="c"><button class="tg-open" data-ref="${esc(r.ref)}" data-num="${esc(r.number)}" title="Открыть чек">↗</button></td>
        </tr>`).join('') : `<tr><td colspan="${8 + hasDoc + hasCli}" class="tbl-empty">Нет продаж за период</td></tr>`}</tbody>
      </table>
    </div>
    <div class="tg-foot">
      <span class="muted">Показано ${L.length ? TG.page * TG.per + 1 : 0}–${Math.min(L.length, (TG.page + 1) * TG.per)} из ${fmtInt(L.length)}</span>
      ${pages > 1 ? `<div class="tg-pager"><button class="tg-pg" data-pg="${TG.page - 1}" ${TG.page <= 0 ? 'disabled' : ''}>‹</button>${pg.join('')}<button class="tg-pg" data-pg="${TG.page + 1}" ${TG.page >= pages - 1 ? 'disabled' : ''}>›</button></div>` : '<span></span>'}
      <label class="tg-per muted">Показывать по <select id="tgPer" class="fselect">${[10, 20, 50, 100].map(n => `<option ${n === TG.per ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    </div>`;
  $('tgLines').querySelectorAll('.tg-pg[data-pg]').forEach(b => b.addEventListener('click', () => { const p = +b.dataset.pg; if (p >= 0 && p < pages) { TG.page = p; tgRenderLines(); } }));
  $('tgPer').addEventListener('change', () => { TG.per = +$('tgPer').value; TG.page = 0; tgRenderLines(); });
  $('tgLines').querySelectorAll('tr.tg-lr').forEach(tr => tr.addEventListener('click', () => tgOpenReceipt(tr.dataset.ref, tr.dataset.num)));
}

async function tgOpenReceipt(ref, num) {
  const ov = document.createElement('div');
  ov.className = 'rcedit-overlay';
  ov.innerHTML = `<div class="rcedit-modal tg-rmodal" role="dialog"><div class="tg-rm-h"><b>Чек ${esc(num)}</b><button class="tg-x" aria-label="Закрыть">✕</button></div><div class="tg-rm-b"><div class="loading">⏳ Загружаю чек…</div></div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelector('.tg-x').addEventListener('click', close);
  try {
    const d = rcItemsCache[ref] || await posApi(`?action=receipt-items&ref=${encodeURIComponent(ref)}`, { method: 'GET' });
    rcItemsCache[ref] = d;
    const body = ov.querySelector('.tg-rm-b');
    body.innerHTML = renderReceiptItems(d, num, {});
    wireReceiptDetail(body);
  } catch (e) { ov.querySelector('.tg-rm-b').innerHTML = errBar('Не удалось загрузить чек: ' + (e.message || e)); }
}

// ——— рекомендации к закупке ———
function tgRenderReco() {
  const d = TG.detail, f = d.forecast;
  const dem = { 'Рост': ['up', '📈'], 'Стабильно': ['flat', '➡️'], 'Снижение': ['down', '📉'], 'Новый спрос': ['up', '✨'], 'Нет продаж': ['down', '⏸'] }[f.demand] || ['flat', '➡️'];
  const cov = f.cover === null ? 'flat' : f.cover <= 14 ? 'down' : f.cover <= 45 ? 'up' : 'warn';
  const so = (f.sizeOrder || []);
  $('tgReco').innerHTML = `
    <div class="tg-h">
      <div class="tg-h-ai"><span class="tg-ai">ИИ</span><div><h3>Рекомендации к закупке</h3><div class="tg-hs">На основе продаж за ${d.days} дн., остатков во всех магазинах и тренда спроса</div></div></div>
      <label class="tg-hz muted">Прогноз на <select id="tgHz" class="fselect">${[[30, '1 месяц'], [60, '2 месяца'], [90, '3 месяца']].map(([v, l]) => `<option value="${v}" ${v === TG.horizon ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div class="tg-rk4">
      <div class="tg-rt hl"><div class="tg-rt-l">Рекомендуем заказать</div><div class="tg-rt-v">${f.orderHi > f.orderLo ? `${fmtInt(f.orderLo)}–${fmtInt(f.orderHi)}` : fmtInt(f.orderLo)} шт.</div><div class="tg-rt-s">${f.orderHi === 0 ? 'запаса хватит, заказ не нужен' : 'на ' + (TG.horizon === 30 ? '1 месяц' : TG.horizon === 60 ? '2 месяца' : '3 месяца') + ', по размерам ниже'}</div></div>
      <div class="tg-rt"><div class="tg-rt-l">Ожидаемая выручка</div><div class="tg-rt-v">${fmtInt(f.revLo)} – ${fmtInt(f.revHi)} ${CUR}</div><div class="tg-rt-s">≈ ${fmtInt(f.sales)} шт по средней цене</div></div>
      <div class="tg-rt"><div class="tg-rt-l">Прогноз спроса</div><div class="tg-rt-v tg-${dem[0]}">${dem[1]} ${esc(f.demand)}</div><div class="tg-rt-s">${f.trendPct === null ? 'в прошлом периоде продаж не было' : (f.trendPct > 0 ? '+' : '') + f.trendPct + '% к прошлому периоду'} · ${fmtNum(f.rate)} шт/день</div></div>
      <div class="tg-rt"><div class="tg-rt-l">Запаса хватит на</div><div class="tg-rt-v">${f.cover === null ? '—' : fmtInt(f.cover) + ' дн.'}</div><div class="tg-rt-s tg-${cov}">${esc(f.coverLabel)}</div></div>
    </div>
    ${so.length > 1 || (so[0] && so[0].size !== '—') ? `<div class="tbl-wrap tg-tw"><table class="tbl tg-tbl tg-so">
      <thead><tr><th>Размер</th>${so.map(x => `<th class="c">${esc(x.size)}</th>`).join('')}<th class="c">Итого</th></tr></thead>
      <tbody>
        <tr><td class="muted">Продано</td>${so.map(x => `<td class="c">${fmtInt(x.sold)}</td>`).join('')}<td class="c strong">${fmtInt(so.reduce((a, x) => a + x.sold, 0))}</td></tr>
        <tr><td class="muted">Остаток</td>${so.map(x => `<td class="c">${fmtInt(x.stock)}</td>`).join('')}<td class="c strong">${fmtInt(so.reduce((a, x) => a + x.stock, 0))}</td></tr>
        <tr><td class="muted">Прогноз продаж</td>${so.map(x => `<td class="c">${fmtInt(x.forecast)}</td>`).join('')}<td class="c strong">${fmtInt(so.reduce((a, x) => a + x.forecast, 0))}</td></tr>
        <tr class="tg-so-o"><td class="strong">Заказать</td>${so.map(x => `<td class="c">${x.orderHi ? (x.orderHi > x.order ? `${x.order}–${x.orderHi}` : x.order) : '—'}</td>`).join('')}<td class="c strong">${f.orderHi > f.orderLo ? `${f.orderLo}–${f.orderHi}` : f.orderLo}</td></tr>
      </tbody></table></div>` : ''}
    <div class="tg-note muted">Расчёт: продажи в день × ${TG.horizon} дн. с поправкой на тренд, минус остаток этого размера во всех магазинах и на складе. Это ориентир — учитывайте сезон и сроки поставки.</div>`;
  $('tgHz').addEventListener('change', () => { TG.horizon = +$('tgHz').value; tgSelect(TG.pid, true); });
}

// ——— правая панель: товар, KPI, график, остатки ———
function tgRenderSide() {
  const d = TG.detail, p = d.product, k = d.kpi, st = d.stock;
  const isDead = !k.qty;
  $('tgSide').innerHTML = `
    <div class="tg-pr">
      ${tgPhoto(p.photo, 'tg-pr-ph')}
      <div class="tg-pr-i">
        <div class="tg-pr-n">${esc(p.name)}</div>
        <div class="tg-pr-c">${esc(p.category && p.category !== 'Товар' ? p.category : '')}</div>
        <dl class="tg-pr-dl">
          ${p.code ? `<dt>Артикул:</dt><dd>${esc(p.code)}</dd>` : ''}
          ${p.brand ? `<dt>Бренд:</dt><dd>${esc(p.brand)}</dd>` : ''}
          ${p.price ? `<dt>Цена:</dt><dd>${tgM(p.price)}</dd>` : ''}
          <dt>Размеры:</dt><dd>${esc((p.sizes || []).filter(s => s !== '—').join(', ') || '—')}</dd>
        </dl>
      </div>
      <button class="tg-x" id="tgClose" title="Скрыть" aria-label="Закрыть">✕</button>
    </div>
    ${p.barcode ? `<div class="tg-bcw">${tgEan13(p.barcode)}</div>` : ''}
    <div class="tg-k3">
      <div class="tg-k"><div class="tg-k-l">Всего продано</div><div class="tg-k-v">${fmtInt(k.qty)} <small>шт.</small> ${tgTrend(tgPct(k.qty, k.prevQty))}</div><div class="tg-k-s">к прошлому периоду${k.returns ? ` · возвратов ${fmtInt(k.returns)}` : ''}</div></div>
      <div class="tg-k"><div class="tg-k-l">Выручка</div><div class="tg-k-v">${fmtInt(Math.round(k.revenue))} <small>${CUR}</small> ${tgTrend(tgPct(k.revenue, k.prevRevenue))}</div><div class="tg-k-s">${fmtInt(k.receipts)} чеков</div></div>
      <div class="tg-k"><div class="tg-k-l">Средняя цена</div><div class="tg-k-v">${fmtInt(Math.round(k.avgPrice))} <small>${CUR}</small> ${k.prevAvg ? tgTrend(tgPct(k.avgPrice, k.prevAvg)) : ''}</div><div class="tg-k-s">${k.lastSale ? 'посл. продажа ' + tgDM(tgDay(k.lastSale)) : 'продаж нет'}</div></div>
    </div>
    <div class="tg-h tg-h2"><h3>Продажи по дням</h3>
      <select id="tgChM" class="fselect tg-chm"><option value="qty" ${TG.chartMetric === 'qty' ? 'selected' : ''}>По количеству</option><option value="revenue" ${TG.chartMetric === 'revenue' ? 'selected' : ''}>По выручке</option></select></div>
    <div class="tg-chart">${isDead ? '<div class="tg-ph">За период продаж не было</div>' : '<canvas id="tgDayChart"></canvas>'}</div>
    <div class="tg-h tg-h2"><h3>Остатки по магазинам</h3><span class="muted">всего ${fmtInt(st.total)} шт</span></div>
    <div class="tbl-wrap tg-tw">${tgStockTable(st)}</div>`;
  $('tgClose').addEventListener('click', () => { TG.pid = ''; TG.detail = null; TG.detKey = ''; document.querySelectorAll('#tgStrip .tg-mc').forEach(el => el.classList.remove('on')); tgRenderEmpty(); });
  $('tgChM').addEventListener('change', () => { TG.chartMetric = $('tgChM').value; tgPaintChart(); });
  tgPaintChart();
}

// остатки: магазины × размеры; если размеров больше, чем магазинов — поворачиваем таблицу
function tgStockTable(st) {
  const cell = (c) => `<td class="c${c ? '' : ' z'}">${c || '0'}</td>`;
  const short = (n) => ({ 'Основной склад': 'Склад', 'Интернет магазин': 'Интернет', 'Сити-Молл': 'Сити', 'Худжанд': 'Худж.' }[n] || n);
  if (st.sizes.length > 6) {
    return `<table class="tbl tg-tbl tg-st">
      <thead><tr><th>Размер</th>${st.rows.map(r => `<th class="c">${esc(short(r.name))}</th>`).join('')}<th class="c">Итого</th></tr></thead>
      <tbody>${st.sizes.map((s, i) => `<tr><td class="strong">${esc(s)}</td>${st.rows.map(r => cell(r.cells[i])).join('')}<td class="c strong">${fmtInt(st.totals[i])}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td class="strong">Итого</td>${st.rows.map(r => `<td class="c strong">${fmtInt(r.total)}</td>`).join('')}<td class="c strong">${fmtInt(st.total)}</td></tr></tfoot></table>`;
  }
  return `<table class="tbl tg-tbl tg-st">
    <thead><tr><th>Магазин</th>${st.sizes.map(s => `<th class="c">${esc(s === '—' ? 'шт' : s)}</th>`).join('')}<th class="c">Итого</th></tr></thead>
    <tbody>${st.rows.map(r => `<tr><td>${esc(r.name)}</td>${r.cells.map(cell).join('')}<td class="c strong">${fmtInt(r.total)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td class="strong">Итого</td>${st.totals.map(c => `<td class="c strong">${fmtInt(c)}</td>`).join('')}<td class="c strong">${fmtInt(st.total)}</td></tr></tfoot></table>`;
}

function tgPaintChart() {
  destroyChart('tgDayChart');
  const el = $('tgDayChart'); if (!el || !TG.detail) return;
  const days = TG.detail.byDay || [];
  const m = TG.chartMetric;
  state.charts['tgDayChart'] = new Chart(el, {
    type: 'bar',
    data: { labels: days.map(x => tgDM(x.day).slice(0, 5)), datasets: [{ data: days.map(x => m === 'qty' ? x.qty : Math.round(x.revenue)), backgroundColor: '#34d399', hoverBackgroundColor: '#059669', borderRadius: 3, maxBarThickness: 18 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: it => tgDM(days[it[0].dataIndex].day), label: c => m === 'qty' ? `${c.parsed.y} шт` : `${fmtInt(c.parsed.y)} ${CUR}` } } },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 11 } } },
        y: { beginAtZero: true, ticks: { precision: 0, font: { size: 11 }, callback: v => v >= 1000 ? (v / 1000) + 'K' : v }, grid: { color: '#eef2f1' } } } },
  });
}

function tgExport() {
  const b = TG.board; if (!b) return;
  const L = tgList();
  const rows = [['№', 'Товар', 'Артикул', 'Категория', 'Продано, шт', 'Прошлый период, шт', 'Изменение, %', 'Выручка, с.', 'Средняя цена, с.', 'Чеков', 'Возвраты, шт', 'Остаток, шт', 'Хватит на, дн.']];
  L.forEach((x, i) => rows.push([i + 1, x.name, x.code, x.category, x.qty, x.prevQty, x.trend === null ? 'новый' : x.trend, Math.round(x.revenue), Math.round(x.avgPrice), x.receipts, x.returns, x.stock, x.cover === null ? '' : x.cover]));
  const csv = '\ufeff' + rows.map(r => r.map(v => { const s = String(v == null ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `top-tovarov_${b.from}_${b.to}_${(TG_TABS.find(t => t.id === TG.tab) || {}).id}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
