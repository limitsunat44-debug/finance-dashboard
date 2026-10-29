// ══════════════════════════════════════════════════════════
//  БОНУСЫ СОТРУДНИКАМ (v1.6.6) — backend /api/pos
//    staff-pay-list   — свод: продажи, возвраты, % бонуса, бонус, оклад, выплачено, остаток
//    staff-salary-set — оклад в месяц (редактируется в таблице)
//    bonus-rate-set   — % бонуса (новые чеки; старые начисления не меняются)
//    staff-payout / staff-payout-delete / staff-paid-set — выплаты, каждая = расход «Зарплаты»
//    staff-profile    — карточка: продажи, возвраты, группы товаров, топ товаров, задачи кассы
//  Хелперы admin-rmk.js: $, esc, state, posApi, fmtNum, fmtInt, money, kpi, dushToday, docFmtDate, toastMsg, bumpSync.
// ══════════════════════════════════════════════════════════
const SPAY = {
  from: null, to: null, shop: '', status: '', q: '', tab: 'report',
  data: null, prof: null, profTab: 'overview', chart: null,
};
const SPAY_ST = { due: ['К выплате', 'due'], partial: ['Частично', 'partial'], paid: ['Выплачено', 'paid'], none: ['Нет начислений', 'none'] };
const spayBy = () => (typeof state !== 'undefined' && state.user) || 'admin';
const spayToast = (t) => (typeof toastMsg === 'function' ? toastMsg(t) : alert(t));
const spayN = (v) => fmtNum(v || 0);
const spayDT = (iso) => iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const spayInit = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
const SPAY_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#64748b'];
const spayColor = (s) => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return SPAY_COLORS[h % SPAY_COLORS.length]; };
const spayShop = (n) => String(n || '').replace(/^Ортосалон\s*/i, '').replace(/["«»]/g, '').trim();

async function renderBonuses(force) {
  const box = $('bonBody'); if (!box) return;
  if (!SPAY.from) { SPAY.to = dushToday(); SPAY.from = SPAY.to.slice(0, 8) + '01'; }
  if (!SPAY.data || force) {
    box.innerHTML = `<div class="loading">⏳ Считаю бонусы и выплаты…</div>`;
    try {
      const qs = `?action=staff-pay-list&from=${encodeURIComponent(SPAY.from)}&to=${encodeURIComponent(SPAY.to)}`
        + (SPAY.shop ? `&shop=${encodeURIComponent(SPAY.shop)}` : '');
      SPAY.data = await posApi(qs, { method: 'GET' });
      if (!SPAY.salons) { try { SPAY.salons = (await posApi('?action=fin-salons', { method: 'GET' })).salons || []; } catch (_) { SPAY.salons = []; } }
      if (typeof bumpSync === 'function') bumpSync();
    } catch (e) { box.innerHTML = errBar('Не удалось загрузить бонусы: ' + (e.message || e)); return; }
  }
  spayRender();
}

function spayRows() {
  const d = SPAY.data || { sellers: [] };
  let list = (d.sellers || []).slice();
  if (SPAY.status) list = list.filter(x => SPAY.status === 'due' ? (x.status === 'due' || x.status === 'partial') : x.status === SPAY.status);
  if (SPAY.q) { const s = SPAY.q.toLowerCase(); list = list.filter(x => String(x.sellerName || '').toLowerCase().includes(s) || String(x.shopName || '').toLowerCase().includes(s)); }
  return list;
}

function spayRender() {
  const box = $('bonBody');
  const d = SPAY.data || { sellers: [], totals: {} };
  const t = d.totals || {};
  const shopOpts = `<option value="">Все магазины</option>` + (state.kassas || []).map(s => `<option value="${esc(s.ref)}" ${SPAY.shop === s.ref ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  const stOpts = [['', 'Все статусы'], ['due', 'К выплате'], ['paid', 'Выплачено'], ['none', 'Нет начислений']].map(([v, l]) => `<option value="${v}" ${SPAY.status === v ? 'selected' : ''}>${l}</option>`).join('');
  const net = (t.sales || 0) - (t.returns || 0);
  const card = (ic, tone, label, val, sub, big) => `<div class="spay-kpi${big ? ' big' : ''}"><div class="spay-kpi-h"><span class="spay-ic ${tone}">${ic}</span><span>${label}</span></div><div class="spay-kpi-v tnum">${val}</div>${sub ? `<div class="spay-kpi-s">${sub}</div>` : ''}</div>`;
  box.innerHTML = `
  <div class="spay">
    <div class="spay-tabs">
      <button class="spay-tab ${SPAY.tab === 'report' ? 'on' : ''}" data-tab="report">Общий отчёт</button>
      <button class="spay-tab ${SPAY.tab === 'payouts' ? 'on' : ''}" data-tab="payouts">Выплаты</button>
      <div class="spay-tabs-r"><button class="btn btn-ghost btn-sm" id="spayRates">⚙ Ставки</button> <button class="btn btn-ghost btn-sm" id="spayAdd">＋ Сотрудник</button> <button class="btn btn-ghost btn-sm" id="spayCsv">⇩ Экспорт CSV</button></div>
    </div>
    <div class="spay-kpis">
      ${card('🧾', 'g', 'Продажи', `${spayN(t.sales)} <small>с.</small>`, `${fmtInt(t.receipts || 0)} чеков`)}
      ${card('↩', 'r', 'Возвраты', `${spayN(t.returns)} <small>с.</small>`, `${fmtInt(t.retReceipts || 0)} чеков`)}
      ${card('🛒', 'b', 'Чистые продажи', `${spayN(net)} <small>с.</small>`, '')}
      ${card('%', 'v', 'Бонусы от продаж', `${spayN(t.bonus)} <small>с.</small>`, net > 0 ? `в среднем ${(t.bonus / net * 100).toFixed(1)}%` : '')}
      ${card('🩺', 'a', `Диагностика <small>(${spayN(d.rates && d.rates.diag)} с.)</small>`, `${spayN(t.diagBonus)} <small>с.</small>`, d.dsError ? '⚠ ОртоCRM недоступна' : `${fmtInt(t.diagCount || 0)} диагностик`)}
      ${card('💼', 'a', 'Оклады', `${spayN(t.salary)} <small>с.</small>`, d.months > 1 ? `за ${d.months} мес.` : 'за месяц')}
      ${card('✓', 'gr', 'Выплачено', `${spayN(t.paidOut)} <small>с.</small>`, 'попадает в расходы')}
      ${card('≡', 'g', 'Всего к выплате', `${spayN(t.rest)} <small>с.</small>`, `начислено ${spayN(t.total)} с.`, true)}
    </div>
    <div class="spay-card">
      <div class="spay-filters">
        <div class="spay-fld"><label>Период</label><div class="spay-dr"><input type="date" class="finput" id="spFrom" value="${esc(SPAY.from)}"><span>—</span><input type="date" class="finput" id="spTo" value="${esc(SPAY.to)}"></div></div>
        <div class="spay-fld"><label>Магазин</label><select class="fselect" id="spShop">${shopOpts}</select></div>
        <div class="spay-fld"><label>Статус</label><select class="fselect" id="spStatus">${stOpts}</select></div>
        <div class="spay-fld grow"><label>&nbsp;</label><input class="finput" id="spQ" placeholder="🔍 Поиск сотрудника…" value="${esc(SPAY.q)}"></div>
        <div class="spay-fld"><label>&nbsp;</label><div style="display:flex;gap:8px"><button class="btn btn-ghost" id="spReset">↻ Сбросить</button><button class="btn btn-primary" id="spApply">Применить</button></div></div>
      </div>
      <div id="spBody">${SPAY.tab === 'payouts' ? spayPayoutsHtml() : spayTableHtml()}</div>
    </div>
  </div>`;
  spayBind();
}

function spayTableHtml() {
  const rows = spayRows();
  const d = SPAY.data || {};
  const sum = (k) => rows.reduce((s, x) => s + (Number(x[k]) || 0), 0);
  const tr = rows.map((x, i) => {
    const st = SPAY_ST[x.status] || SPAY_ST.none;
    const net = (x.sales || 0) - (x.returns || 0);
    const r = esc(x.sellerRef);
    return `<tr data-ref="${r}">
      <td class="c muted">${i + 1}</td>
      <td><button class="spay-who" data-open="${r}" title="Открыть карточку сотрудника">
        <span class="spay-ava" style="background:${spayColor(x.sellerName)}">${esc(spayInit(x.sellerName))}</span>
        <span><b>${esc(x.sellerName || 'Без имени')}</b><small>${esc([x.position, spayShop(x.shopName)].filter(Boolean).join(' · ') || '—')}</small></span></button></td>
      <td class="r tnum strong">${spayN(x.sales)}</td>
      <td class="c tnum">${fmtInt(x.receipts || 0)}</td>
      <td class="r tnum neg">${x.returns ? '−' + spayN(x.returns) : '—'}</td>
      <td class="r tnum">${spayN(net)}</td>
      <td class="c">${x.manual ? '<span class="muted">—</span>' : `<input class="spay-inp pct" type="number" min="0" max="100" step="0.1" data-k="rate" data-ref="${r}" value="${x.ratePct}" title="% бонуса — для новых чеков"><span class="spay-u">%</span>`}</td>
      <td class="r tnum">${spayN(x.bonus)}</td>
      <td class="r tnum" title="${x.dsProfileName ? 'ОртоCRM: ' + esc(x.dsProfileName) : 'нет привязки к ОртоCRM'}">${x.diagCount ? `${spayN(x.diagBonus)}<div class="spay-hint">${fmtInt(x.diagCount)} шт</div>` : (x.dsProfileId ? '0' : '<span class="muted">—</span>')}</td>
      <td class="r"><input class="spay-inp" type="number" min="0" step="50" data-k="salary" data-ref="${r}" value="${x.salaryMonthly || 0}" title="Оклад в месяц">${d.months > 1 ? `<div class="spay-hint">×${d.months} = ${spayN(x.salary)}</div>` : ''}</td>
      <td class="r tnum strong">${spayN(x.total)}</td>
      <td class="r"><input class="spay-inp" type="number" min="0" step="1" data-k="paid" data-ref="${r}" value="${x.paidOut || 0}" title="Выплачено за период — изменение создаёт/правит расход"></td>
      <td class="r tnum strong ${x.rest > 0.005 ? 'pos' : 'muted'}">${spayN(x.rest)}</td>
      <td class="c"><span class="spay-st ${st[1]}">${st[0]}</span></td>
      <td class="c"><div class="spay-act">
        ${x.rest > 0.005 ? `<button class="btn btn-primary btn-sm" data-pay="${r}">Выплатить</button>` : ''}
        <button class="spay-dots" data-open="${r}" title="Карточка сотрудника">⋯</button></div></td>
    </tr>`;
  }).join('');
  return `<div class="tbl-wrap spay-wrap"><table class="tbl spay-tbl">
    <thead>
      <tr><th rowspan="2" class="c">#</th><th rowspan="2">Сотрудник</th><th rowspan="2" class="r">Продажи<br><small>с учётом скидки</small></th><th rowspan="2" class="c">Чеки</th><th rowspan="2" class="r">Возвраты</th><th rowspan="2" class="r">Чистые<br>продажи</th>
        <th colspan="3" class="c grp">Бонусы</th><th rowspan="2" class="r">Оклад<br><small>в месяц</small></th><th rowspan="2" class="r">Всего<br>начислено</th><th rowspan="2" class="r">Выплачено</th><th rowspan="2" class="r">Остаток<br>к выплате</th><th rowspan="2" class="c">Статус</th><th rowspan="2" class="c">Действия</th></tr>
      <tr><th class="c grp">%</th><th class="r grp">От продаж</th><th class="r grp">Диагностика<br><small>${spayN(d.rates && d.rates.diag)} с./шт</small></th></tr>
    </thead>
    <tbody>${tr || `<tr><td colspan="15" class="tbl-empty">Нет данных за период</td></tr>`}</tbody>
    <tfoot><tr class="spay-total"><td></td><td>Итого</td><td class="r tnum">${spayN(sum('sales'))}</td><td class="c tnum">${fmtInt(sum('receipts'))}</td><td class="r tnum neg">${spayN(sum('returns'))}</td><td class="r tnum">${spayN(sum('sales') - sum('returns'))}</td><td></td><td class="r tnum">${spayN(sum('bonus'))}</td><td class="r tnum">${spayN(sum('diagBonus'))}</td><td class="r tnum">${spayN(sum('salary'))}</td><td class="r tnum">${spayN(sum('total'))}</td><td class="r tnum">${spayN(sum('paidOut'))}</td><td class="r tnum pos">${spayN(sum('rest'))}</td><td></td><td></td></tr></tfoot>
  </table></div>
  ${d.dsError ? `<div class="spay-warn">Диагностики из ОртоCRM не загрузились: ${esc(d.dsError)}</div>` : ''}<div class="spay-note">Диагностика — завершённые визиты в ОртоCRM (docsales2), сотрудник сопоставляется по имени (привязку можно изменить в карточке). % бонуса — для новых чеков (уже начисленные не пересчитываются). Оклад — сумма в месяц. «Выплачено» можно исправить вручную: разница сама добавится или уберётся из расходов. Каждая выплата попадает в «Финансы → Расходы», категория «Зарплаты».</div>`;
}

function spayPayoutsHtml() {
  const list = [];
  for (const x of spayRows()) for (const p of (x.payouts || [])) list.push({ ...p, name: x.sellerName, shop: x.shopName, ref: x.sellerRef });
  list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  if (!list.length) return `<div class="tbl-empty" style="padding:28px">Выплат за период нет</div>`;
  return `<div class="tbl-wrap"><table class="tbl spay-tbl"><thead><tr><th>Дата</th><th>Сотрудник</th><th>Магазин</th><th class="r">Сумма</th><th>Комментарий</th><th>Кто</th><th class="c">Расход</th><th></th></tr></thead><tbody>
    ${list.map(p => `<tr><td>${spayDT(p.at)}</td><td><button class="spay-link" data-open="${esc(p.ref)}">${esc(p.name || '')}</button></td><td>${esc(spayShop(p.shop))}</td><td class="r tnum strong">${spayN(p.amount)}</td><td class="muted">${esc(p.note || '—')}</td><td class="muted">${esc(p.by || '—')}</td><td class="c">${p.expenseId ? '<span class="spay-st paid">в расходах</span>' : '—'}</td><td class="c"><button class="btn btn-ghost btn-sm" data-delpay="${esc(p.id)}" title="Удалить выплату и расход">✕</button></td></tr>`).join('')}
  </tbody></table></div>`;
}

function spayFind(ref) { return ((SPAY.data && SPAY.data.sellers) || []).find(x => x.sellerRef === ref); }

function spayBind() {
  const box = $('bonBody');
  const q = (s) => box.querySelector(s);
  const apply = () => {
    SPAY.from = q('#spFrom').value || SPAY.from; SPAY.to = q('#spTo').value || SPAY.to;
    if (SPAY.to < SPAY.from) { const tt = SPAY.from; SPAY.from = SPAY.to; SPAY.to = tt; }
    SPAY.shop = q('#spShop').value; SPAY.status = q('#spStatus').value; SPAY.q = q('#spQ').value.trim();
    renderBonuses(true);
  };
  q('#spApply').onclick = apply;
  q('#spShop').onchange = apply;
  q('#spStatus').onchange = () => { SPAY.status = q('#spStatus').value; spayRender(); };
  q('#spQ').oninput = (e) => { SPAY.q = e.target.value.trim(); const b = $('spBody'); b.innerHTML = SPAY.tab === 'payouts' ? spayPayoutsHtml() : spayTableHtml(); spayBindBody(); };
  q('#spReset').onclick = () => { SPAY.to = dushToday(); SPAY.from = SPAY.to.slice(0, 8) + '01'; SPAY.shop = ''; SPAY.status = ''; SPAY.q = ''; renderBonuses(true); };
  box.querySelectorAll('.spay-tab').forEach(b => b.onclick = () => { SPAY.tab = b.dataset.tab; spayRender(); });
  q('#spayCsv').onclick = spayCsv;
  q('#spayRates').onclick = spayRatesModal;
  q('#spayAdd').onclick = spayAddModal;
  spayBindBody();
}

function spayBindBody() {
  const body = $('spBody'); if (!body) return;
  body.querySelectorAll('[data-open]').forEach(b => b.onclick = () => spayOpenProfile(b.dataset.open));
  body.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => spayPayModal(b.dataset.pay));
  body.querySelectorAll('[data-delpay]').forEach(b => b.onclick = () => spayDeletePayout(b.dataset.delpay));
  body.querySelectorAll('.spay-inp').forEach(inp => {
    inp.dataset.orig = inp.value;
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } if (e.key === 'Escape') { inp.value = inp.dataset.orig; inp.blur(); } };
    inp.onchange = () => spaySaveField(inp);
  });
}

async function spaySaveField(inp) {
  const x = spayFind(inp.dataset.ref); if (!x) return;
  const v = Number(inp.value);
  const k = inp.dataset.k;
  if (!Number.isFinite(v) || v < 0 || (k === 'rate' && v > 100)) { spayToast('Некорректное значение'); inp.value = inp.dataset.orig; return; }
  if (k === 'paid') {
    const delta = Math.round((v - (x.paidOut || 0)) * 100) / 100;
    if (Math.abs(delta) < 0.005) return;
    const msg = delta > 0
      ? `«${x.sellerName}»: выплачено ${spayN(v)} с. вместо ${spayN(x.paidOut)} с.\n\nВ расходы («Зарплаты») добавится ${spayN(delta)} с.`
      : `«${x.sellerName}»: выплачено ${spayN(v)} с. вместо ${spayN(x.paidOut)} с.\n\nИз расходов будет убрано ${spayN(-delta)} с.`;
    if (!confirm(msg)) { inp.value = inp.dataset.orig; return; }
  }
  inp.disabled = true; inp.classList.add('saving');
  try {
    if (k === 'rate') await posApi('?action=bonus-rate-set', { method: 'POST', body: JSON.stringify({ sellerRef: x.sellerRef, sellerName: x.sellerName, ratePct: v, by: spayBy() }) });
    else if (k === 'salary') await posApi('?action=staff-salary-set', { method: 'POST', body: JSON.stringify({ sellerRef: x.sellerRef, sellerName: x.sellerName, salary: v, by: spayBy() }) });
    else await posApi('?action=staff-paid-set', { method: 'POST', body: JSON.stringify({ sellerRef: x.sellerRef, sellerName: x.sellerName, from: SPAY.from, to: SPAY.to, paid: v, by: spayBy() }) });
    spayToast(k === 'rate' ? `% бонуса сохранён: ${v}% (для новых чеков)` : k === 'salary' ? `Оклад сохранён: ${spayN(v)} с.` : 'Выплачено обновлено, расходы исправлены');
    await renderBonuses(true);
  } catch (e) { spayToast('Ошибка: ' + (e.message || e)); inp.value = inp.dataset.orig; inp.disabled = false; inp.classList.remove('saving'); }
}

function spayModal(html, cls) {
  const ov = document.createElement('div');
  ov.className = 'spay-ov';
  ov.innerHTML = `<div class="spay-modal ${cls || ''}">${html}</div>`;
  document.body.appendChild(ov);
  const close = () => { if (SPAY.chart) { try { SPAY.chart.destroy(); } catch (_) {} SPAY.chart = null; } ov.remove(); document.removeEventListener('keydown', esc_); };
  const esc_ = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc_);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  ov.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  return { ov, close };
}

function spayPayModal(ref) {
  const x = spayFind(ref); if (!x) return;
  const per = `${docFmtDate(SPAY.from)} — ${docFmtDate(SPAY.to)}`;
  const m = spayModal(`
    <div class="spay-mh"><div><h3>Выплата сотруднику</h3><div class="muted">${esc(x.sellerName)} · ${esc(spayShop(x.shopName))} · ${per}</div></div><button class="spay-x" data-close>✕</button></div>
    <div class="spay-paygrid">
      <div><span>Бонус от продаж</span><b>${spayN(x.bonus)} с.</b></div>
      <div><span>Диагностика</span><b>${spayN(x.diagBonus || 0)} с.</b></div>
      <div><span>Оклад</span><b>${spayN(x.salary)} с.</b></div>
      <div><span>Уже выплачено</span><b>${spayN(x.paidOut)} с.</b></div>
      <div class="hl"><span>Остаток</span><b>${spayN(x.rest)} с.</b></div>
    </div>
    <label class="spay-lbl">Сумма выплаты, с.</label>
    <input class="finput" id="spPayAmt" type="number" min="0" step="1" value="${Math.max(0, x.rest)}">
    <label class="spay-lbl">Комментарий (необязательно)</label>
    <input class="finput" id="spPayNote" placeholder="например: наличными / на карту Алиф">
    <div class="spay-warn">Сумма попадёт в расходы: «Финансы → Расходы», категория «Зарплаты», магазин сотрудника.</div>
    <div class="spay-mf"><button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" id="spPayGo">Выплатить</button></div>`, 'sm');
  const go = m.ov.querySelector('#spPayGo');
  go.onclick = async () => {
    const amt = Number(m.ov.querySelector('#spPayAmt').value);
    if (!(amt > 0)) { spayToast('Укажите сумму'); return; }
    go.disabled = true; go.textContent = 'Сохраняю…';
    try {
      await posApi('?action=staff-payout', { method: 'POST', body: JSON.stringify({ sellerRef: x.sellerRef, sellerName: x.sellerName, from: SPAY.from, to: SPAY.to, amount: amt, note: m.ov.querySelector('#spPayNote').value.trim(), by: spayBy() }) });
      m.close(); spayToast(`Выплачено ${spayN(amt)} с. — добавлено в расходы`); await renderBonuses(true);
    } catch (e) { spayToast('Ошибка: ' + (e.message || e)); go.disabled = false; go.textContent = 'Выплатить'; }
  };
}

async function spayDeletePayout(id) {
  if (!confirm('Удалить выплату? Связанный расход в «Зарплатах» тоже будет удалён.')) return;
  try { await posApi('?action=staff-payout-delete', { method: 'POST', body: JSON.stringify({ id, by: spayBy() }) }); spayToast('Выплата удалена'); await renderBonuses(true); }
  catch (e) { spayToast('Ошибка: ' + (e.message || e)); }
}

// ───────── карточка сотрудника ─────────
async function spayOpenProfile(ref) {
  const x = spayFind(ref) || { sellerRef: ref, sellerName: '' };
  SPAY.profTab = 'overview';
  const m = spayModal(`<div class="spay-mh"><div class="spay-who big"><span class="spay-ava" style="background:${spayColor(x.sellerName)}">${esc(spayInit(x.sellerName))}</span><span><b>${esc(x.sellerName || 'Сотрудник')}</b><small>${esc(spayShop(x.shopName))} · ${docFmtDate(SPAY.from)} — ${docFmtDate(SPAY.to)}</small></span></div><button class="spay-x" data-close>✕</button></div><div id="spProf"><div class="loading">⏳ Загружаю продажи, возвраты и задачи…</div></div>`, 'lg');
  try {
    const p = await posApi(`?action=staff-profile&sellerRef=${encodeURIComponent(ref)}&sellerName=${encodeURIComponent(x.sellerName || '')}&from=${SPAY.from}&to=${SPAY.to}`, { method: 'GET' });
    SPAY.prof = { p, x, m };
    spayProfRender();
  } catch (e) { const b = m.ov.querySelector('#spProf'); if (b) b.innerHTML = errBar('Не удалось загрузить: ' + (e.message || e)); }
}

function spayProfRender() {
  const { p, x, m } = SPAY.prof; const box = m.ov.querySelector('#spProf'); if (!box) return;
  const s = p.summary || {};
  const tabs = [['overview', 'Обзор'], ['settings', 'Настройки'], ['receipts', `Чеки (${s.receipts || 0})`], ['returns', `Возвраты (${s.retReceipts || 0})`], ['tasks', `Задачи (${(p.tasks && p.tasks.done) || 0})`]];
  const mini = (l, v, cls) => `<div class="spay-mini ${cls || ''}"><span>${l}</span><b class="tnum">${v}</b></div>`;
  let body = '';
  if (SPAY.profTab === 'overview') {
    const gTot = (p.groups || []).reduce((a, g) => a + Math.max(0, g.sum), 0) || 1;
    body = `
      <div class="spay-chartbox"><canvas id="spChart" height="150"></canvas></div>
      <div class="spay-2col">
        <div><h4>Что продаёт чаще всего</h4>${(p.groups || []).length ? (p.groups || []).map((g, i) => `<div class="spay-bar"><div class="spay-bar-h"><span>${esc(g.group)}</span><span class="tnum">${spayN(g.sum)} с. · ${fmtInt(g.qty)} шт · <b>${Math.round(Math.max(0, g.sum) / gTot * 100)}%</b></span></div><div class="spay-bar-t"><i style="width:${Math.max(2, Math.round(Math.max(0, g.sum) / gTot * 100))}%;background:${SPAY_COLORS[i % SPAY_COLORS.length]}"></i></div></div>`).join('') : '<div class="muted">Нет продаж</div>'}</div>
        <div><h4>Топ товаров</h4><table class="tbl spay-mt"><thead><tr><th>#</th><th>Товар</th><th class="c">Шт</th><th class="r">Сумма</th></tr></thead><tbody>${(p.topProducts || []).map((t, i) => `<tr><td class="muted">${i + 1}</td><td>${esc(t.name)}<div class="muted" style="font-size:11px">${esc(t.group)}</div></td><td class="c tnum">${fmtInt(t.qty)}</td><td class="r tnum">${spayN(t.sum)}</td></tr>`).join('') || '<tr><td colspan="4" class="tbl-empty">—</td></tr>'}</tbody></table></div>
      </div>`;
  } else if (SPAY.profTab === 'receipts') {
    body = `<table class="tbl spay-mt"><thead><tr><th>Дата</th><th>Чек</th><th>Магазин</th><th class="c">Товаров</th><th class="r">Сумма</th></tr></thead><tbody>${(p.receiptsList || []).map(r => `<tr><td>${spayDT(r.at)}</td><td>${esc(r.number || '—')}</td><td>${esc(spayShop(r.shop))}</td><td class="c">${fmtInt(r.items || 0)}</td><td class="r tnum strong">${spayN(r.total)}</td></tr>`).join('') || '<tr><td colspan="5" class="tbl-empty">Нет чеков</td></tr>'}</tbody></table>${(s.receipts || 0) > 50 ? '<div class="spay-note">Показаны последние 50 чеков.</div>' : ''}`;
  } else if (SPAY.profTab === 'returns') {
    body = `<table class="tbl spay-mt"><thead><tr><th>Дата</th><th>Чек возврата</th><th>Магазин</th><th class="r">Сумма</th></tr></thead><tbody>${(p.returnsList || []).map(r => `<tr><td>${spayDT(r.at)}</td><td>${esc(r.number || '—')}</td><td>${esc(spayShop(r.shop))}</td><td class="r tnum neg">−${spayN(r.total)}</td></tr>`).join('') || '<tr><td colspan="4" class="tbl-empty">Возвратов нет</td></tr>'}</tbody></table>`;
  } else if (SPAY.profTab === 'settings') {
    const D = SPAY.data || {};
    const shopOpts = `<option value="">— не выбран —</option>` + (SPAY.salons || []).map(k => `<option value="${esc(k.warehouse_id)}" data-name="${esc(k.name)}" ${x.shopName === k.name ? 'selected' : ''}>${esc(k.name)}</option>`).join('');
    const dsOpts = `<option value="" ${!x.dsLink ? 'selected' : ''}>Авто по имени${x.dsProfileName && !x.dsLink ? ' (' + esc(x.dsProfileName) + ')' : ''}</option><option value="none" ${x.dsLink === 'none' ? 'selected' : ''}>Не учитывать диагностики</option>` + (D.dsProfiles || []).map(pp => `<option value="${esc(pp.id)}" ${x.dsLink === pp.id ? 'selected' : ''}>${esc(pp.name)} — ${fmtInt(pp.diag)} за период</option>`).join('');
    body = `<div class="spay-form">
      <label class="spay-lbl">Должность</label><input class="finput" id="spfPos" value="${esc(x.position || '')}" placeholder="Продавец-консультант">
      <label class="spay-lbl">Аккаунт в ОртоCRM (откуда берутся диагностики)</label><select class="fselect" id="spfDs">${dsOpts}</select>
      ${x.manual ? `<label class="spay-lbl">Магазин (для расхода)</label><select class="fselect" id="spfShop">${shopOpts}</select>` : ''}
      <label class="spay-lbl" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="spfHide" ${x.hidden ? 'checked' : ''}> Скрыть из списка (уволен / не работает)</label>
      <div class="spay-mf"><button class="btn btn-primary" id="spfSave">Сохранить</button></div></div>`;
  } else {
    const T = p.tasks || { list: [] };
    const ST = { open: 'Открыта', review: 'На проверке', done: 'Выполнена', rejected: 'Отклонена', cancelled: 'Отменена', expired: 'Просрочена', resolved: 'Закрыта сама', skipped: 'Нет товара' };
    const KD = { restock: 'Пополнить', check: 'Проверка', manual: 'Ручная', ai: 'ИИ' };
    body = `<div class="spay-minis">${mini('Выполнено', fmtInt(T.done || 0), 'g')}${mini('Баллы', fmtInt(T.points || 0), 'v')}${mini('Открыто сейчас', fmtInt(T.open || 0), 'a')}</div>
      <table class="tbl spay-mt"><thead><tr><th>Когда</th><th>Задача</th><th>Вид</th><th class="c">Статус</th><th class="c">Баллы</th></tr></thead><tbody>${(T.list || []).map(t => `<tr><td>${spayDT(t.doneAt || t.createdAt)}</td><td>${esc(t.title || '')}${t.by ? `<div class="muted" style="font-size:11px">поставил: ${esc(t.by)}</div>` : ''}</td><td>${esc(KD[t.kind] || t.kind || '')}</td><td class="c"><span class="spay-st ${t.status === 'done' ? 'paid' : t.status === 'open' || t.status === 'review' ? 'due' : 'none'}">${esc(ST[t.status] || t.status)}</span></td><td class="c tnum">${t.status === 'done' ? fmtInt(t.points) : '—'}</td></tr>`).join('') || '<tr><td colspan="5" class="tbl-empty">Задач за период нет</td></tr>'}</tbody></table>`;
  }
  box.innerHTML = `
    <div class="spay-minis">
      ${mini('Продажи', spayN(s.sales) + ' с.', 'g')}${mini('Чеков', fmtInt(s.receipts || 0))}${mini('Возвраты', spayN(s.returns) + ' с.', 'r')}${mini('Чистые', spayN(s.net) + ' с.', 'b')}${mini('Средний чек', spayN(s.avgReceipt) + ' с.')}${mini('Товаров продано', fmtInt(s.items || 0))}
      ${x.diagCount != null ? mini('Диагностик', fmtInt(x.diagCount) + ' · ' + spayN(x.diagBonus) + ' с.', 'a') : ''}
      ${x.total != null ? mini('Всего начислено', spayN(x.total) + ' с.', 'v') + mini('Остаток к выплате', spayN(x.rest) + ' с.', 'a') : ''}
    </div>
    <div class="spay-tabs sm">${tabs.map(([k, l]) => `<button class="spay-tab ${SPAY.profTab === k ? 'on' : ''}" data-pt="${k}">${l}</button>`).join('')}</div>
    <div class="spay-pbody">${body}</div>`;
  box.querySelectorAll('[data-pt]').forEach(b => b.onclick = () => { SPAY.profTab = b.dataset.pt; spayProfRender(); });
  const sv = box.querySelector('#spfSave');
  if (sv) sv.onclick = async () => {
    const body = { sellerRef: x.sellerRef, position: box.querySelector('#spfPos').value.trim(), dsProfileId: box.querySelector('#spfDs').value, hidden: box.querySelector('#spfHide').checked, by: spayBy() };
    const sh = box.querySelector('#spfShop');
    if (sh) { body.whId = sh.value || null; body.shopName = sh.value ? sh.selectedOptions[0].dataset.name : null; }
    sv.disabled = true;
    try { await posApi('?action=staff-employee-update', { method: 'POST', body: JSON.stringify(body) }); spayToast('Сохранено'); m.close(); await renderBonuses(true); }
    catch (e) { spayToast('Ошибка: ' + (e.message || e)); sv.disabled = false; }
  };
  if (SPAY.profTab === 'overview') spayDrawChart(p.days || []);
}

function spayDrawChart(days) {
  const cv = document.getElementById('spChart'); if (!cv || !window.Chart) return;
  if (SPAY.chart) { try { SPAY.chart.destroy(); } catch (_) {} }
  SPAY.chart = new Chart(cv, {
    type: 'bar',
    data: { labels: days.map(d => d.day.slice(8, 10) + '.' + d.day.slice(5, 7)), datasets: [
      { label: 'Продажи', data: days.map(d => d.sales), backgroundColor: '#10b981', borderRadius: 4 },
      { label: 'Возвраты', data: days.map(d => -d.returns), backgroundColor: '#f43f5e', borderRadius: 4 },
    ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: v => (Math.abs(v) >= 1000 ? (v / 1000) + 'k' : v) } } } },
  });
}

function spayCsv() {
  const rows = spayRows();
  if (!rows.length) { spayToast('Нет данных для экспорта'); return; }
  const head = ['Сотрудник', 'Магазин', 'Продажи', 'Чеки', 'Возвраты', 'Чистые продажи', '% бонуса', 'Бонус', 'Диагностик', 'Бонус диагн.', 'Оклад', 'Всего начислено', 'Выплачено', 'Остаток', 'Статус'];
  const data = rows.map(x => [x.sellerName, spayShop(x.shopName), x.sales, x.receipts, x.returns, (x.sales || 0) - (x.returns || 0), x.ratePct, x.bonus, x.diagCount, x.diagBonus, x.salary, x.total, x.paidOut, x.rest, (SPAY_ST[x.status] || SPAY_ST.none)[0]]);
  const csv = '\uFEFF' + [head, ...data].map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(';')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `бонусы_сотрудникам_${SPAY.from}_${SPAY.to}.csv`; document.body.appendChild(a); a.click(); a.remove();
}

function spayRatesModal() {
  const r = (SPAY.data && SPAY.data.rates) || { diag: 5, docsale: 5 };
  const m = spayModal(`
    <div class="spay-mh"><div><h3>Ставки бонусов</h3><div class="muted">Действуют на весь выбранный период</div></div><button class="spay-x" data-close>✕</button></div>
    <label class="spay-lbl">Диагностика — с. за каждую (ОртоCRM)</label><input class="finput" id="srDiag" type="number" min="0" step="0.5" value="${r.diag}">
    <div class="spay-note">% от продаж задаётся каждому продавцу в таблице.</div>
    <div class="spay-mf"><button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" id="srGo">Сохранить</button></div>`, 'sm');
  m.ov.querySelector('#srGo').onclick = async () => {
    try { await posApi('?action=staff-rates-set', { method: 'POST', body: JSON.stringify({ diag: Number(m.ov.querySelector('#srDiag').value), docsale: Number(r.docsale) || 0, by: spayBy() }) }); m.close(); spayToast('Ставки сохранены'); await renderBonuses(true); }
    catch (e) { spayToast('Ошибка: ' + (e.message || e)); }
  };
}
function spayAddModal() {
  const shopOpts = `<option value="">Офис / сеть (общий расход)</option>` + (SPAY.salons || []).map(k => `<option value="${esc(k.warehouse_id)}" data-name="${esc(k.name)}">${esc(k.name)}</option>`).join('');
  const m = spayModal(`
    <div class="spay-mh"><div><h3>Сотрудник без продаж</h3><div class="muted">Бухгалтер, SMM, курьер, уборщица… — только оклад</div></div><button class="spay-x" data-close>✕</button></div>
    <label class="spay-lbl">Имя</label><input class="finput" id="saName">
    <label class="spay-lbl">Должность</label><input class="finput" id="saPos">
    <label class="spay-lbl">Магазин (на него пойдёт расход)</label><select class="fselect" id="saShop">${shopOpts}</select>
    <label class="spay-lbl">Оклад в месяц, с.</label><input class="finput" id="saSal" type="number" min="0" step="50" value="0">
    <div class="spay-mf"><button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" id="saGo">Добавить</button></div>`, 'sm');
  m.ov.querySelector('#saGo').onclick = async () => {
    const sh = m.ov.querySelector('#saShop');
    const body = { name: m.ov.querySelector('#saName').value.trim(), position: m.ov.querySelector('#saPos').value.trim(), whId: sh.value || null, shopName: sh.value ? sh.selectedOptions[0].dataset.name : null, salary: Number(m.ov.querySelector('#saSal').value) || 0, by: spayBy() };
    if (!body.name) { spayToast('Укажите имя'); return; }
    try { await posApi('?action=staff-employee-add', { method: 'POST', body: JSON.stringify(body) }); m.close(); spayToast('Сотрудник добавлен'); await renderBonuses(true); }
    catch (e) { spayToast('Ошибка: ' + (e.message || e)); }
  };
}
