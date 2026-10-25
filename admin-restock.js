// ═════════════════════════════════════════════════════════════════════
//  ТОВАРЫ ДЛЯ ПЕРЕМЕЩЕНИЯ (v1.5.9) — рекомендации пополнения магазинов.
//  Правило: в магазине размера нет (остаток < 1), а в другом магазине его ≥ 2 шт.
//  или на Основном складе ≥ 2 шт. → предлагаем переместить туда 1 шт.
//  Основной склад — только источник. Донор всегда оставляет себе минимум 1 шт.
//  Экземпляры из непроведённых документов перемещения повторно не предлагаются.
//  Из вкладки создаются обычные документы перемещения (тот же журнал, transfer-doc-create).
//  Backend: /api/pos?action=catalog&sub=restock
// ═════════════════════════════════════════════════════════════════════
const RS = {
  f: { to: '', from: '', grp: '', brand: '', size: '', prio: '', q: '', storeMin: '2', mainMin: '2' },
  per: 40, items: [], data: null, more: false, loading: false, seq: 0, io: null,
  sel: new Map(),        // rowId -> { row, from, bcs:[...] }
  postNow: false, busy: false,
};
const RS_PRIO = [['', 'Все'], ['high', 'Высокий'], ['mid', 'Средний'], ['low', 'Низкий']];
const rsWhName = (id) => { const c = RS.data && RS.data.cols.find(x => x.id === id); return c ? c.name : '—'; };
const rsN = (n) => fmtInt(Math.round(Number(n) || 0));

async function renderRestock(force) {
  const box = $('rsBody'); if (!box) return;
  if (!box.querySelector('.rs-wrap')) {
    box.innerHTML = `<div class="rs-wrap">
      <div class="rs-kpis" id="rsKpis"></div>
      <div class="card rs-filters" id="rsFilters"></div>
      <div class="card rs-list">
        <div class="rs-bar" id="rsBar"></div>
        <div class="rs-tbl-wrap"><table class="rs-tbl" id="rsTbl"></table></div>
        <div class="rs-more" id="rsMore"></div>
      </div>
      <div class="rs-selbar" id="rsSelBar"></div>
    </div>`;
  }
  await rsLoad(true, force);
}

function rsQS(offset, fresh) {
  const p = new URLSearchParams({ action: 'catalog', sub: 'restock', offset: String(offset), limit: String(RS.per) });
  Object.entries(RS.f).forEach(([k, v]) => { if (v) p.set(k, v); });
  if (fresh) p.set('fresh', '1');
  return '?' + p.toString();
}

async function rsLoad(reset, fresh) {
  const seq = ++RS.seq;
  if (reset) {
    RS.items = []; RS.more = false;
    const t = $('rsTbl'); if (t && !RS.data) t.innerHTML = `<tbody><tr><td class="rs-empty"><div class="loading">⏳ Считаю, что куда переместить…</div></td></tr></tbody>`;
  }
  RS.loading = true; rsPaintMore();
  try {
    const d = await posApi(rsQS(RS.items.length, fresh), { method: 'GET' });
    if (seq !== RS.seq) return;
    RS.data = d; RS.items = RS.items.concat(d.items || []); RS.more = !!d.more;
    RS.loading = false;
    if (reset) { rsPaintKpis(); rsPaintFilters(); rsPaintBar(); rsPaintTable(); }
    else rsAppendRows(d.items || []);
    rsPaintMore(); rsPaintSelBar();
  } catch (e) {
    if (seq !== RS.seq) return;
    RS.loading = false;
    const t = $('rsTbl'); if (t && reset) t.innerHTML = `<tbody><tr><td class="rs-empty">${errBar('Не удалось загрузить: ' + e.message)}</td></tr></tbody>`;
    rsPaintMore();
  }
}

function rsPaintKpis() {
  const k = (RS.data && RS.data.kpi) || {};
  const card = (ic, cls, label, val, sub) => `<div class="rs-kpi"><div class="rs-kpi-ic ${cls}">${ic}</div><div><div class="rs-kpi-l">${label}</div><div class="rs-kpi-v">${rsN(val)}</div><div class="rs-kpi-s">${sub}</div></div></div>`;
  $('rsKpis').innerHTML =
    card('📦', 'red', 'Требуют перемещения', k.products, 'товаров') +
    card('🚚', 'blue', 'Возможные перемещения', k.rows, 'рекомендаций') +
    card('✅', 'green', 'Будет пополнено', k.units, 'единиц товара') +
    card('🏬', 'amber', 'Задействовано магазинов', k.stores, 'магазина');
}

function rsPaintFilters() {
  const d = RS.data || { cols: [], facets: { brands: [], sizes: [], grps: [] } };
  const stores = d.cols.filter(c => !c.main);
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
  const f = RS.f;
  $('rsFilters').innerHTML = `
    <div class="rs-frow">
      <label class="rs-f"><span>Куда (магазин)</span><select class="fselect" data-f="to">${opt('', 'Все магазины', f.to)}${stores.map(c => opt(c.id, c.name, f.to)).join('')}</select></label>
      <label class="rs-f"><span>Откуда</span><select class="fselect" data-f="from">${opt('', 'Все источники', f.from)}${opt('main', 'Основной склад', f.from)}${opt('stores', 'Другие магазины', f.from)}${stores.map(c => opt(c.id, c.name, f.from)).join('')}</select></label>
      <label class="rs-f"><span>Категория</span><select class="fselect" data-f="grp">${opt('', 'Все категории', f.grp)}${d.facets.grps.map(g => opt(g.v, `${g.label} (${g.n})`, f.grp)).join('')}</select></label>
      <label class="rs-f"><span>Бренд</span><select class="fselect" data-f="brand">${opt('', 'Все бренды', f.brand)}${d.facets.brands.map(b => opt(b.v, `${b.v} (${b.n})`, f.brand)).join('')}</select></label>
      <label class="rs-f"><span>Размер</span><select class="fselect" data-f="size">${opt('', 'Все размеры', f.size)}${d.facets.sizes.map(s => opt(s.v, `${s.v} (${s.n})`, f.size)).join('')}</select></label>
      <label class="rs-f"><span>Приоритет</span><select class="fselect" data-f="prio">${RS_PRIO.map(([v, l]) => opt(v, l, f.prio)).join('')}</select></label>
    </div>
    <div class="rs-frow2">
      <div class="rs-q"><input class="finput" id="rsQ" placeholder="Название, артикул, бренд или штрихкод" value="${esc(f.q)}"></div>
      <label class="rs-f rs-f-sm"><span>Магазин отдаёт от</span><select class="fselect" data-f="storeMin">${[2, 3, 4, 5].map(n => opt(n, n + ' шт.', f.storeMin)).join('')}</select></label>
      <label class="rs-f rs-f-sm"><span>Основной склад отдаёт от</span><select class="fselect" data-f="mainMin">${[2, 3, 4, 5].map(n => opt(n, n + ' шт.', f.mainMin)).join('')}</select></label>
      <button class="btn btn-ghost" id="rsReset">Сбросить</button>
    </div>
    <div class="rs-rule">Правило: если в магазине размера нет, а на Основном складе его от ${esc(f.mainMin)} шт. или в другом магазине от ${esc(f.storeMin)} шт. — предлагаем переместить 1 шт. Источник всегда оставляет себе минимум 1 шт. В Основной склад ничего не перемещается.${d.pending ? ` Уже в непроведённых перемещениях: ${rsN(d.pending)} шт. — они не предлагаются повторно.` : ''}</div>`;
  $('rsFilters').querySelectorAll('select[data-f]').forEach(s => s.onchange = () => { RS.f[s.dataset.f] = s.value; rsLoad(true); });
  let t = null;
  $('rsQ').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { RS.f.q = e.target.value.trim(); rsLoad(true); }, 350); };
  $('rsReset').onclick = () => { RS.f = { to: '', from: '', grp: '', brand: '', size: '', prio: '', q: '', storeMin: '2', mainMin: '2' }; rsLoad(true); };
}

function rsPaintBar() {
  const n = RS.sel.size;
  $('rsBar').innerHTML = `
    <div class="rs-tabs">
      <button class="rs-tab on">Рекомендации перемещений (${rsN(RS.data ? RS.data.total : 0)})</button>
      <button class="rs-tab" id="rsGoJournal">Журнал перемещений</button>
    </div>
    <div class="rs-bar-r">
      <button class="btn btn-ghost" id="rsRefresh" title="Пересчитать по свежим остаткам">↻ Обновить</button>
      <button class="btn btn-ghost" id="rsExport">⤓ Экспорт</button>
      <button class="btn btn-primary" id="rsCreate" ${n ? '' : 'disabled'}>✓ Создать перемещения${n ? ` (выбрано ${n})` : ''}</button>
    </div>`;
  $('rsGoJournal').onclick = () => {
    const b = document.querySelector('.sb-item[data-view="transfer"]');
    if (typeof TR !== 'undefined') { TR.mode = 'journal'; TR.jDoc = null; }
    if (b) b.click();
    setTimeout(() => { if (typeof trLoadJournal === 'function') trLoadJournal(); }, 50);
  };
  $('rsRefresh').onclick = () => rsLoad(true, true);
  $('rsExport').onclick = rsExport;
  $('rsCreate').onclick = rsOpenCreate;
}

function rsHead() {
  const cols = RS.data.cols;
  return `<thead>
    <tr class="rs-h1"><th rowspan="2" class="rs-c-ck"><input type="checkbox" id="rsAll" title="Выбрать загруженные"></th>
      <th rowspan="2">Товар</th><th rowspan="2">Размер</th>
      <th colspan="${cols.length}" class="rs-grp-h">Остатки по складам</th>
      <th colspan="3" class="rs-grp-h">Рекомендация</th><th rowspan="2">Приоритет</th></tr>
    <tr class="rs-h2">${cols.map(c => `<th class="rs-c-st">${esc(c.name)}</th>`).join('')}
      <th>Откуда</th><th>Куда</th><th>Кол-во</th></tr>
  </thead>`;
}

function rsRowHTML(r) {
  const cols = RS.data.cols;
  const s = RS.sel.get(r.id);
  const from = s ? s.from : r.from;
  const donor = r.donors.find(d => d.wh === from) || r.donors[0];
  const maxQ = donor ? Math.max(0, donor.units.length - 1) : 0;
  const q = s ? s.bcs.length : 1;
  const cells = cols.map(c => {
    const n = r.stock[c.id] || 0;
    const cls = c.id === r.to ? 'rs-st to' : c.id === from ? 'rs-st from' : n < 1 ? 'rs-st zero' : 'rs-st';
    return `<td class="rs-c-st"><span class="${cls}">${rsN(n)}</span></td>`;
  }).join('');
  return `<tr data-id="${esc(r.id)}" class="${s ? 'sel' : ''}">
    <td class="rs-c-ck"><input type="checkbox" class="rs-ck" ${s ? 'checked' : ''}></td>
    <td class="rs-c-prod"><button class="rs-prod" data-pid="${esc(r.pid)}">${r.photo ? `<img src="${esc(r.photo)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'">` : '<span class="rs-noph">Нет фото</span>'}
      <span><b>${esc(r.name)}</b><em>${esc(r.sku || r.code || '')}${r.cat ? ' · ' + esc(r.cat) : ''}</em><em class="rs-sold">${r.soldTo30 ? `Продано в ${esc(rsWhName(r.to))} за 30 дн.: ${rsN(r.soldTo30)}` : r.sold30 ? `Продаж за 30 дн. (всего): ${rsN(r.sold30)}` : 'Продаж за 30 дн. нет'}</em></span></button></td>
    <td class="rs-c-sz"><b>${esc(r.size)}</b></td>
    ${cells}
    <td class="rs-c-from"><select class="fselect rs-from">${r.donors.map(d => `<option value="${esc(d.wh)}" ${d.wh === from ? 'selected' : ''}>${esc(d.wh === RS.data.cols[0].id ? 'Основной' : rsWhName(d.wh))} · ${rsN(d.units.length)} шт.</option>`).join('')}</select></td>
    <td class="rs-c-to"><span class="rs-arrow">→</span> <b>${esc(rsWhName(r.to))}</b>${r.incoming ? `<em>уже едет ${rsN(r.incoming)}</em>` : ''}</td>
    <td class="rs-c-q"><div class="rs-qbox"><input type="number" class="finput rs-q" min="1" max="${maxQ}" value="${q}"><button class="rs-units" title="Выбрать экземпляры">☰</button></div><em class="rs-maxq">из ${rsN(maxQ)} доступных</em></td>
    <td class="rs-c-pr"><span class="rs-prio ${esc(r.prio)}">${esc(r.prioLabel)}</span></td>
  </tr>`;
}

function rsPaintTable() {
  const t = $('rsTbl');
  if (!RS.items.length) {
    t.innerHTML = `<tbody><tr><td class="rs-empty"><div class="rs-empty-in">✅ По выбранным фильтрам перемещать нечего — во всех магазинах товар есть или взять его неоткуда.</div></td></tr></tbody>`;
    return;
  }
  t.innerHTML = rsHead() + `<tbody id="rsTb">${RS.items.map(rsRowHTML).join('')}</tbody>`;
  $('rsAll').onchange = (e) => {
    RS.items.forEach(r => { if (e.target.checked) { if (!RS.sel.has(r.id)) rsSelect(r, r.from, 1); } else RS.sel.delete(r.id); });
    rsRepaintRows(); rsPaintBar(); rsPaintSelBar();
  };
  rsBindRows(t);
}

function rsAppendRows(list) {
  const tb = $('rsTb'); if (!tb) { rsPaintTable(); return; }
  const tmp = document.createElement('tbody'); tmp.innerHTML = list.map(rsRowHTML).join('');
  const rows = [...tmp.children]; rows.forEach(tr => tb.appendChild(tr));
  rsBindRows(tb, rows);
}

function rsRow(id) { return RS.items.find(r => r.id === id); }
// штрихкоды, уже выбранные в других строках (чтобы один экземпляр не ушёл дважды)
function rsUsedBcs(exceptId) {
  const u = new Set(); RS.sel.forEach((s, id) => { if (id !== exceptId) s.bcs.forEach(b => u.add(b)); }); return u;
}
function rsSelect(r, from, qty, bcs) {
  const donor = r.donors.find(d => d.wh === from); if (!donor) return false;
  const maxQ = Math.max(0, donor.units.length - 1);
  const used = rsUsedBcs(r.id);
  let pick = bcs ? bcs.filter(b => !used.has(b)) : donor.units.filter(u => !used.has(u.bc)).slice(0, Math.min(qty, maxQ)).map(u => u.bc);
  pick = pick.slice(0, maxQ);
  if (!pick.length) { toastMsg('Свободных экземпляров у ' + rsWhName(from) + ' не осталось'); return false; }
  RS.sel.set(r.id, { row: r, from, bcs: pick });
  return true;
}
function rsRepaintRows() {
  document.querySelectorAll('#rsTb tr[data-id]').forEach(tr => { const r = rsRow(tr.dataset.id); if (!r) return; const tmp = document.createElement('tbody'); tmp.innerHTML = rsRowHTML(r); const n = tmp.firstElementChild; tr.replaceWith(n); rsBindRows(null, [n]); });
}
function rsRepaintRow(id) {
  const tr = document.querySelector(`#rsTb tr[data-id="${CSS.escape(id)}"]`); const r = rsRow(id); if (!tr || !r) return;
  const tmp = document.createElement('tbody'); tmp.innerHTML = rsRowHTML(r); const n = tmp.firstElementChild; tr.replaceWith(n); rsBindRows(null, [n]);
}

function rsBindRows(root, rows) {
  (rows || [...root.querySelectorAll('tr[data-id]')]).forEach(tr => {
    const id = tr.dataset.id, r = rsRow(id); if (!r) return;
    tr.querySelector('.rs-ck').onchange = (e) => {
      if (e.target.checked) { if (!rsSelect(r, (RS.sel.get(id) || {}).from || r.from, 1)) e.target.checked = false; } else RS.sel.delete(id);
      rsRepaintRow(id); rsPaintBar(); rsPaintSelBar();
    };
    tr.querySelector('.rs-from').onchange = (e) => {
      const s = RS.sel.get(id);
      if (s) rsSelect(r, e.target.value, s.bcs.length); else { r.from = e.target.value; }
      rsRepaintRow(id); rsPaintSelBar();
    };
    tr.querySelector('.rs-q').onchange = (e) => {
      const s = RS.sel.get(id); const from = s ? s.from : r.from;
      const v = Math.max(1, parseInt(e.target.value, 10) || 1);
      rsSelect(r, from, v); rsRepaintRow(id); rsPaintBar(); rsPaintSelBar();
    };
    tr.querySelector('.rs-units').onclick = () => rsOpenUnits(id);
    tr.querySelector('.rs-prod').onclick = () => { if (typeof ctOpen === 'function') ctOpen(r.pid); };
  });
}

function rsPaintMore() {
  const el = $('rsMore'); if (!el) return;
  if (RS.loading && RS.items.length) el.innerHTML = '<div class="loading">⏳ Загружаю ещё…</div>';
  else if (RS.more) el.innerHTML = `<button class="btn btn-ghost" id="rsMoreBtn">Показать ещё</button><div class="rs-cnt">Показано ${rsN(RS.items.length)} из ${rsN(RS.data.total)}</div>`;
  else if (RS.items.length) el.innerHTML = `<div class="rs-cnt">Показаны все ${rsN(RS.items.length)} рекомендаций</div>`;
  else el.innerHTML = '';
  const b = $('rsMoreBtn'); if (b) b.onclick = () => rsLoad(false);
  if (!RS.io && 'IntersectionObserver' in window) {
    RS.io = new IntersectionObserver((es) => { if (es.some(x => x.isIntersecting) && RS.more && !RS.loading && state.view === 'restock') rsLoad(false); }, { rootMargin: '600px' });
  }
  if (RS.io) { RS.io.disconnect(); if (RS.more) RS.io.observe(el); }
}

function rsGroups() {
  const g = new Map();
  RS.sel.forEach((s) => {
    const k = s.from + '>' + s.row.to;
    if (!g.has(k)) g.set(k, { from: s.from, to: s.row.to, rows: [], bcs: [] });
    const x = g.get(k); x.rows.push(s); x.bcs.push(...s.bcs.map(bc => ({ barcode: bc, price: s.row.price || 0, product_name: s.row.name, size_label: s.row.size })));
  });
  return [...g.values()];
}

function rsPaintSelBar() {
  const el = $('rsSelBar'); if (!el) return;
  if (!RS.sel.size) { el.classList.remove('on'); el.innerHTML = ''; return; }
  const gs = rsGroups(); const units = gs.reduce((a, g) => a + g.bcs.length, 0);
  el.classList.add('on');
  el.innerHTML = `<div>Выбрано <b>${rsN(RS.sel.size)}</b> строк · <b>${rsN(units)}</b> шт. · документов: <b>${gs.length}</b></div>
    <div class="rs-selbar-r"><button class="btn btn-ghost" id="rsClear">Снять выбор</button><button class="btn btn-primary" id="rsCreate2">✓ Создать перемещения</button></div>`;
  $('rsClear').onclick = () => { RS.sel.clear(); rsRepaintRows(); rsPaintBar(); rsPaintSelBar(); };
  $('rsCreate2').onclick = rsOpenCreate;
}

// ——— окно выбора экземпляров ———
function rsModal(html) {
  let m = $('rsModal');
  if (!m) { m = document.createElement('div'); m.id = 'rsModal'; m.className = 'rs-modal'; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target === m) rsCloseModal(); }); document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('rsModal') && $('rsModal').classList.contains('open')) rsCloseModal(); }); }
  m.innerHTML = `<div class="rs-dlg">${html}</div>`; m.classList.add('open');
}
function rsCloseModal() { const m = $('rsModal'); if (m) m.classList.remove('open'); }

function rsOpenUnits(id) {
  const r = rsRow(id); if (!r) return;
  const s = RS.sel.get(id); const from = s ? s.from : r.from;
  const donor = r.donors.find(d => d.wh === from); if (!donor) return;
  const maxQ = Math.max(0, donor.units.length - 1);
  const used = rsUsedBcs(id); const cur = new Set(s ? s.bcs : []);
  rsModal(`<div class="rs-dlg-h"><div><b>Выберите экземпляры</b><em>${esc(r.name)} · размер ${esc(r.size)} · ${esc(rsWhName(from))} → ${esc(rsWhName(r.to))}</em></div><button class="rs-x" id="rsX">✕</button></div>
    <div class="rs-dlg-note">У источника ${rsN(donor.units.length)} шт. Можно взять до ${rsN(maxQ)} шт. — 1 шт. остаётся на месте. Сначала показаны экземпляры не с витрины.</div>
    <div class="rs-ulist">${donor.units.map(u => {
      const dis = used.has(u.bc);
      return `<label class="rs-u ${dis ? 'dis' : ''}"><input type="checkbox" value="${esc(u.bc)}" ${cur.has(u.bc) ? 'checked' : ''} ${dis ? 'disabled' : ''}>
        <span class="rs-u-bc">${esc(u.bc)}</span><span class="rs-u-d">поступил ${u.recv ? esc(u.recv.split('-').reverse().join('.')) : '—'}</span>
        <span class="rs-u-pl ${u.place ? 'show' : ''}">${dis ? 'выбран в другой строке' : u.place ? 'На витрине: ' + esc(u.place) : 'Не на витрине'}</span></label>`;
    }).join('')}</div>
    <div class="rs-dlg-f"><span id="rsUCnt"></span><div><button class="btn btn-ghost" id="rsUCancel">Отмена</button> <button class="btn btn-primary" id="rsUOk">Готово</button></div></div>`);
  const upd = () => { const n = [...document.querySelectorAll('#rsModal .rs-u input:checked')].length; $('rsUCnt').innerHTML = `Выбрано ${n} из ${maxQ}` + (n > maxQ ? ' — <b class="rs-err">слишком много</b>' : ''); $('rsUOk').disabled = n > maxQ; };
  document.querySelectorAll('#rsModal .rs-u input').forEach(i => i.onchange = upd); upd();
  $('rsX').onclick = rsCloseModal; $('rsUCancel').onclick = rsCloseModal;
  $('rsUOk').onclick = () => {
    const bcs = [...document.querySelectorAll('#rsModal .rs-u input:checked')].map(i => i.value);
    if (!bcs.length) RS.sel.delete(id); else RS.sel.set(id, { row: r, from, bcs });
    rsCloseModal(); rsRepaintRow(id); rsPaintBar(); rsPaintSelBar();
  };
}

// ——— создание документов ———
function rsOpenCreate() {
  if (!RS.sel.size || RS.busy) return;
  const gs = rsGroups();
  rsModal(`<div class="rs-dlg-h"><div><b>Создать перемещения</b><em>Будет создано документов: ${gs.length}. Они появятся в журнале «Перемещение».</em></div><button class="rs-x" id="rsX">✕</button></div>
    <div class="rs-docs">${gs.map(g => `<div class="rs-doc"><div class="rs-doc-h"><b>${esc(rsWhName(g.from))}</b> <span>→</span> <b>${esc(rsWhName(g.to))}</b><em>${rsN(g.bcs.length)} шт.</em></div>
      <div class="rs-doc-l">${g.rows.map(s => `${esc(s.row.name)} · р. ${esc(s.row.size)} × ${s.bcs.length}`).join('<br>')}</div></div>`).join('')}</div>
    <label class="rs-post"><input type="checkbox" id="rsPostNow" ${RS.postNow ? 'checked' : ''}> <span><b>Сразу провести</b> — товар уже передан, сразу переместить остатки. Без галочки документ создаётся черновиком: его проводят в журнале, когда товар приехал.</span></label>
    <div class="rs-dlg-f"><span id="rsCErr"></span><div><button class="btn btn-ghost" id="rsCCancel">Отмена</button> <button class="btn btn-primary" id="rsCOk">Создать (${gs.length})</button></div></div>`);
  $('rsX').onclick = rsCloseModal; $('rsCCancel').onclick = rsCloseModal;
  $('rsPostNow').onchange = (e) => { RS.postNow = e.target.checked; };
  $('rsCOk').onclick = () => rsDoCreate(gs);
}

async function rsDoCreate(gs) {
  if (RS.busy) return; RS.busy = true;
  const btn = $('rsCOk'); btn.disabled = true; btn.textContent = '⏳ Создаю…';
  const res = [];
  for (const g of gs) {
    try {
      const d = await posApi('?action=transfer-doc-create', { method: 'POST', body: JSON.stringify({
        fromWarehouseId: g.from, toWarehouseId: g.to, senderName: state.user || '', receiverName: '',
        comment: 'Товары для перемещения (рекомендация РМК)', items: g.bcs, post: RS.postNow === true,
      }) });
      const doc = d.doc || {};
      res.push({ ok: true, g, num: doc.doc_number || '—', status: doc.status, dup: !!d.duplicate, notMoved: (d.notMoved || []).length });
    } catch (e) { res.push({ ok: false, g, err: e.message }); }
  }
  RS.busy = false;
  const okKeys = new Set(res.filter(x => x.ok).map(x => x.g.from + '>' + x.g.to));
  [...RS.sel.entries()].forEach(([id, s]) => { if (okKeys.has(s.from + '>' + s.row.to)) RS.sel.delete(id); });
  rsModal(`<div class="rs-dlg-h"><div><b>Готово</b><em>Документы сохранены в журнале «Перемещение».</em></div><button class="rs-x" id="rsX">✕</button></div>
    <div class="rs-docs">${res.map(x => x.ok
      ? `<div class="rs-doc ok"><div class="rs-doc-h"><b>№ ${esc(x.num)}</b> ${esc(rsWhName(x.g.from))} → ${esc(rsWhName(x.g.to))}<em>${rsN(x.g.bcs.length)} шт. · ${x.status === 'posted' ? 'проведён' : 'черновик'}${x.dup ? ' · такой уже был создан' : ''}${x.notMoved ? ` · не перемещено: ${x.notMoved}` : ''}</em></div></div>`
      : `<div class="rs-doc bad"><div class="rs-doc-h"><b>Ошибка</b> ${esc(rsWhName(x.g.from))} → ${esc(rsWhName(x.g.to))}<em>${esc(x.err)}</em></div></div>`).join('')}</div>
    <div class="rs-dlg-f"><span></span><div><button class="btn btn-ghost" id="rsGoJ">Открыть журнал</button> <button class="btn btn-primary" id="rsDone">Закрыть</button></div></div>`);
  $('rsX').onclick = rsCloseModal; $('rsDone').onclick = rsCloseModal;
  $('rsGoJ').onclick = () => { rsCloseModal(); const b = $('rsGoJournal'); if (b) b.click(); };
  rsLoad(true, true);
}

// ——— экспорт CSV (все рекомендации по текущим фильтрам) ———
async function rsExport() {
  const b = $('rsExport'); b.disabled = true; b.textContent = '⏳ Готовлю…';
  try {
    const p = new URLSearchParams(rsQS(0).slice(1)); p.set('limit', '5000');
    const d = await posApi('?' + p.toString(), { method: 'GET' });
    const cols = d.cols; const nm = (id) => (cols.find(c => c.id === id) || {}).name || '';
    const head = ['Товар', 'Бренд', 'Артикул', 'Размер', 'Категория', ...cols.map(c => c.name), 'Откуда', 'Куда', 'Кол-во', 'Приоритет', 'Продаж за 30 дн. в магазине'];
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [head.map(q).join(';')].concat(d.items.map(r => [r.name, r.brand, r.sku || r.code, r.size, r.cat, ...cols.map(c => r.stock[c.id] || 0), nm(r.from), nm(r.to), 1, r.prioLabel, r.soldTo30].map(q).join(';')));
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `Товары_для_перемещения_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) { toastMsg('Не удалось выгрузить: ' + e.message); }
  b.disabled = false; b.textContent = '⤓ Экспорт';
}
