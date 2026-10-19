// ══════════════════════════════════════════════════════════
//  АНАЛИТИКА (v1.4.1) — backend /api/analytics (только чтение)
//   1) «Врачи × продавцы» — кто из продавцов какого врача отмечает чаще коллег (предвзятость).
//   2) «Возвраты» — детальный журнал: товар, чеки, суммы, способы, причина, кто/когда, клиент.
//  Хелперы admin-rmk.js: $, esc, svcFetch, BARCODE_SVC_URL, BARCODE_SVC_SECRET, fmtNum, fmtInt, money, dushToday, dushTime, errBar, bumpSync.
// ══════════════════════════════════════════════════════════
async function anApi(action, qs) {
  const res = await svcFetch(`${BARCODE_SVC_URL}/api/analytics?action=${action}${qs || ''}`, {
    method: 'GET', timeoutMs: 120000, retries: 1, headers: { 'X-Provision-Secret': BARCODE_SVC_SECRET },
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.ok === false) throw new Error(d.error || `HTTP ${res.status}`);
  return d;
}
const anMonthStart = () => dushToday().slice(0, 8) + '01';
const anDaysAgo = (n) => new Date(Date.now() + 5 * 3600e3 - n * 864e5).toISOString().slice(0, 10);
const anD = (ymd) => ymd ? ymd.split('-').reverse().join('.') : '';
const anS = (n) => { const v = Number(n) || 0; return `${v.toLocaleString('ru-RU', { maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 })}\u00a0с.`; };
const anDelta = (d, invert) => {
  if (d == null) return '';
  const good = invert ? d <= 0 : d >= 0;
  return `<span class="an-delta ${good ? 'up' : 'dn'}">${d > 0 ? '+' : ''}${String(d).replace('.', ',')}%</span>`;
};
const anInit = (n) => `<span class="an-av" style="--h:${[...String(n || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360}">${esc(String(n || '?').trim().charAt(0).toUpperCase())}</span>`;
function anCsv(name, head, rows) {
  const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const txt = '\ufeff' + [head, ...rows].map(r => r.map(q).join(';')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' })); a.download = name; a.click();
}

// ═════════════ 1) ВРАЧИ × ПРОДАВЦЫ ═════════════
const DS = { from: '', to: '', wh: '', doctor: '', seller: '', spec: '', topBy: 'receipts', selBy: 'receipts', page: 1, per: 10, selSeller: '', selDoctor: '', biasTab: 'pairs', data: null };
async function renderDocSellers(force) {
  const box = $('dsxBody'); if (!box) return;
  if (!DS.from) { DS.from = anDaysAgo(29); DS.to = dushToday(); }
  if (!DS.data || force) {
    box.innerHTML = '<div class="loading">⏳ Считаю чеки по врачам и продавцам…</div>';
    try { DS.data = await anApi('doctor-sellers', `&from=${DS.from}&to=${DS.to}${DS.wh ? '&wh=' + DS.wh : ''}`); bumpSync(); }
    catch (e) { box.innerHTML = errBar('Не удалось загрузить: ' + e.message); return; }
  }
  dsDraw();
}
function dsDraw() {
  const box = $('dsxBody'); const d = DS.data; if (!box || !d) return;
  const K = d.kpi;
  // фильтры (врач / продавец / специальность) — на клиенте
  let sellers = d.sellers.filter(s => s.receipts > 0);
  let doctors = d.doctors.slice();
  if (DS.spec) doctors = doctors.filter(x => (x.specialty || '') === DS.spec);
  if (DS.doctor) doctors = doctors.filter(x => x.ref === DS.doctor);
  if (DS.seller) sellers = sellers.filter(s => s.key === DS.seller);
  const docSet = new Set(doctors.map(x => x.ref));
  let pairs = d.pairs.filter(p => docSet.has(p.doctor) && (!DS.seller || p.seller === DS.seller));
  const specs = [...new Set(d.doctors.map(x => x.specialty).filter(Boolean))].sort();
  const topDocs = doctors.slice().sort((a, b) => DS.topBy === 'sum' ? b.sum - a.sum : b.receipts - a.receipts).slice(0, 10);
  const maxTop = Math.max(1, ...topDocs.map(x => DS.topBy === 'sum' ? x.sum : x.receipts));
  const selBars = sellers.filter(s => s.docReceipts > 0).slice().sort((a, b) => DS.selBy === 'sum' ? b.docSum - a.docSum : b.docReceipts - a.docReceipts).slice(0, 12);
  const maxSel = Math.max(1, ...selBars.map(s => DS.selBy === 'sum' ? s.docSum : s.docReceipts));
  const dist = d.distribution; const dTot = Math.max(1, dist.total);
  const seg = [[dist.top10, '#059669', 'Топ-10 врачей'], [dist.others, '#60a5fa', 'Остальные врачи'], [dist.noDoctor, '#cbd5e1', 'Без врача']];
  let acc = 0; const C = 2 * Math.PI * 54;
  const donut = seg.map(([v, c]) => { const len = v / dTot * C; const el = `<circle cx="70" cy="70" r="54" fill="none" stroke="${c}" stroke-width="22" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-acc}" transform="rotate(-90 70 70)"/>`; acc += len; return el; }).join('');
  // таблица продавцы × топ-3 врача
  const pagesN = Math.max(1, Math.ceil(sellers.length / DS.per)); if (DS.page > pagesN) DS.page = pagesN;
  const pageRows = sellers.slice((DS.page - 1) * DS.per, DS.page * DS.per);
  const flagOf = (sk, dref) => d.pairs.find(p => p.seller === sk && p.doctor === dref && p.level);
  const trs = pageRows.map(s => {
    const t = s.doctors.filter(x => docSet.has(x.ref)).slice(0, 3);
    const cells = [0, 1, 2].map(i => { const x = t[i]; if (!x) return '<td class="muted">—</td><td></td>'; const f = flagOf(s.key, x.ref); const c = f ? 'an-flag ' + f.level : ''; return `<td class="${c}" title="${f ? esc(f.why) : ''}">${f ? '⚠ ' : ''}${esc(x.name)}</td><td class="r tnum ${c}" title="${f ? esc(f.why) : ''}"><b>${x.count}</b> <span class="sm">${String(x.pct).replace('.', ',')}%</span></td>`; }).join('');
    return `<tr data-dssel="${esc(s.key)}" class="${DS.selSeller === s.key ? 'on' : ''}"><td>${anInit(s.name)} <b>${esc(s.name)}</b>${s.risk ? ` <span class="an-risk ${s.risk}" title="${s.marksMore ? 'Отмечает врача в чеке чаще коллег' : ''}">${s.risk === 'high' ? '⚠ высокий риск' : 'внимание'}</span>` : ''}<div class="muted sm">${esc(s.shop)}</div></td>
      <td class="r tnum">${fmtInt(s.receipts)}</td><td class="r tnum">${fmtInt(s.docReceipts)} <span class="${s.marksMore ? 'red' : 'muted'} sm">${String(s.withDoctorPct).replace('.', ',')}%</span>${s.peersDocPct != null ? `<div class="muted sm">коллеги ${String(s.peersDocPct).replace('.', ',')}%</div>` : ''}</td><td class="r tnum">${anS(s.docSum)}</td><td class="c tnum">${s.uniqueDoctors}</td><td class="r tnum">${fmtInt(s.noDoctor)} <span class="muted sm">(${String(s.noDoctorPct).replace('.', ',')}%)</span></td>${cells}</tr>`;
  }).join('');
  // детализация
  if (!DS.selSeller || !d.sellers.some(s => s.key === DS.selSeller)) DS.selSeller = (sellers.find(s => s.risk) || sellers[0] || {}).key || '';
  if (!DS.selDoctor || !d.doctors.some(x => x.ref === DS.selDoctor)) { const f = pairs.find(p => p.level); DS.selDoctor = f ? f.doctor : (doctors[0] || {}).ref || ''; }
  const sS = d.sellers.find(s => s.key === DS.selSeller), sD = d.doctors.find(x => x.ref === DS.selDoctor);
  const sellerDet = sS ? sS.doctors.filter(x => docSet.has(x.ref)).slice(0, 15).map(x => { const f = flagOf(sS.key, x.ref); return `<tr class="${f ? 'an-flag ' + f.level : ''}"><td>${f ? '⚠ ' : ''}${esc(x.name)}${x.code ? ` <span class="muted sm">${esc(x.code)}</span>` : ''}</td><td class="muted">${esc(x.specialty || '—')}</td><td class="r tnum">${x.count}</td><td class="r tnum">${anS(x.sum)}</td><td class="r tnum">${String(x.pct).replace('.', ',')}%</td></tr>`; }).join('') : '';
  const docDet = sD ? sD.sellers.map(x => { const f = flagOf(x.key, sD.ref); return `<tr class="${f ? 'an-flag ' + f.level : ''}"><td>${anInit(x.name)} ${esc(x.name)}</td><td class="r tnum">${x.count}</td><td class="r tnum">${anS(x.sum)}</td><td class="r tnum">${String(x.pct).replace('.', ',')}%</td></tr>`; }).join('') : '';
  // анализ предвзятости
  const flagged = pairs.filter(p => p.level);
  const nHigh = flagged.filter(p => p.level === 'high').length;
  const markers = d.sellers.filter(s => s.marksMore);
  const biasBody = DS.biasTab === 'pairs'
    ? (flagged.length ? `<table class="tbl an-tbl"><thead><tr><th>Продавец</th><th>Врач</th><th class="r">Чеков</th><th class="r">Доля врача у продавца</th><th class="r">У коллег</th><th class="r">Чеков врача от него</th><th>Почему</th><th>Статус</th></tr></thead><tbody>${flagged.slice(0, 40).map(p => `<tr title="${esc(p.why)}" data-dspair="${esc(p.seller)}|${esc(p.doctor)}"><td>${esc(p.sellerName)}<div class="muted sm">${esc(p.shopName)}</div></td><td>${esc(p.doctorName)}</td><td class="r tnum">${p.count}</td><td class="r tnum"><b class="red">${String(p.shareSeller).replace('.', ',')}%</b></td><td class="r tnum">${p.expected == null ? '—' : String(p.expected).replace('.', ',') + '%'}</td><td class="r"><b>${String(p.shareDoctor).replace('.', ',')}%</b><div class="muted sm">его доля продаж ${String(p.sellerShopShare).replace('.', ',')}%</div></td><td class="muted sm an-why">${esc(p.why)}</td><td><span class="an-lvl ${p.level}">${p.level === 'high' ? 'Высокая' : 'Средняя'}</span></td></tr>`).join('')}</tbody></table>` : '<div class="an-empty">За период явных перекосов не найдено</div>')
    : (d.sellers.filter(s => s.docReceipts > 0 || s.peersDocPct != null).length ? `<table class="tbl an-tbl"><thead><tr><th>Продавец</th><th class="r">Отмечает врача</th><th class="r">Коллеги в магазине</th><th class="r">Подозрительных врачей</th><th>Статус</th></tr></thead><tbody>${d.sellers.filter(s => s.receipts >= 20).map(s => `<tr data-dssel="${esc(s.key)}"><td>${anInit(s.name)} ${esc(s.name)}<div class="muted sm">${esc(s.shop)}</div></td><td class="r tnum"><b class="${s.marksMore ? 'red' : ''}">${String(s.withDoctorPct).replace('.', ',')}%</b></td><td class="r tnum">${s.peersDocPct == null ? '—' : String(s.peersDocPct).replace('.', ',') + '%'}</td><td class="r tnum">${s.flags || 0}</td><td>${s.risk ? `<span class="an-lvl ${s.risk}">${s.risk === 'high' ? 'Высокая' : 'Средняя'}</span>` : '<span class="an-lvl ok">Норма</span>'}</td></tr>`).join('')}</tbody></table>` : '<div class="an-empty">Нет данных</div>');

  const shopOpts = `<option value="">Все магазины</option>` + d.shops.map(s => `<option value="${s.wh}" ${DS.wh === s.wh ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  const docOpts = `<option value="">Все врачи</option>` + d.doctors.map(x => `<option value="${esc(x.ref)}" ${DS.doctor === x.ref ? 'selected' : ''}>${esc(x.name)}${x.code ? ' (' + esc(x.code) + ')' : ''}</option>`).join('');
  const selOpts = `<option value="">Все продавцы</option>` + d.sellers.map(s => `<option value="${esc(s.key)}" ${DS.seller === s.key ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  const specOpts = `<option value="">Все специализации</option>` + specs.map(x => `<option ${DS.spec === x ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const kc = (ic, tone, label, v, dlt, sub) => `<div class="an-kpi"><span class="an-kic ${tone}">${ic}</span><div><div class="an-kl">${label}</div><div class="an-kv">${v} ${dlt || ''}</div>${sub ? `<div class="an-ks">${sub}</div>` : ''}</div></div>`;
  box.innerHTML = `<div class="an">
    <div class="card card-pad an-filters">
      <div class="an-f"><label>Период</label><div class="an-range"><input type="date" class="finput" id="dsFrom" value="${DS.from}"><span>—</span><input type="date" class="finput" id="dsTo" value="${DS.to}"></div></div>
      <div class="an-f"><label>Магазин</label><select class="fselect" id="dsWh">${shopOpts}</select></div>
      <div class="an-f"><label>Врач</label><select class="fselect" id="dsDoc">${docOpts}</select></div>
      <div class="an-f"><label>Продавец</label><select class="fselect" id="dsSel">${selOpts}</select></div>
      <div class="an-f"><label>Специализация врача</label><select class="fselect" id="dsSpec">${specOpts}</select></div>
      <div class="an-f an-fb"><button class="btn btn-primary" id="dsApply">▽ Применить</button><button class="btn btn-ghost" id="dsExport">⭳ Экспорт</button></div>
    </div>
    <div class="an-kpis">
      ${kc('🩺', 'g', 'Всего продаж по врачам', fmtInt(K.docReceipts.v), anDelta(K.docReceipts.d), `${anS(K.docSum.v)} · к предыдущему периоду`)}
      ${kc('👤', 'b', 'Уникальных врачей', fmtInt(K.uniqueDoctors.v), anDelta(K.uniqueDoctors.d))}
      ${kc('👥', 'g', 'Активных продавцов', fmtInt(K.activeSellers.v), anDelta(K.activeSellers.d), 'отмечали врача в чеке')}
      ${kc('📈', 'r', 'Среднее врачей на продавца', String(K.avgDoctorsPerSeller.v).replace('.', ','), anDelta(K.avgDoctorsPerSeller.d))}
      ${kc('🔍', 'gr', 'Продаж без врача', fmtInt(K.noDoctor.v), `<span class="muted sm">${String(K.noDoctorPct.v).replace('.', ',')}%</span>`, `${K.receipts.v} чеков всего`)}
    </div>
    <div class="an-row3">
      <div class="card card-pad"><div class="an-h"><h3>Топ-10 врачей по продажам</h3></div>
        <div class="an-seg">${[['receipts', 'По количеству чеков'], ['sum', 'По сумме продаж']].map(([k, l]) => `<button data-dstop="${k}" class="${DS.topBy === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="an-hbars">${topDocs.map(x => { const v = DS.topBy === 'sum' ? x.sum : x.receipts; return `<div class="an-hb" data-dsdoc="${esc(x.ref)}"><span class="l" title="${esc(x.name)}">${esc(x.name)}</span><span class="t"><i style="width:${Math.max(2, v / maxTop * 100)}%"></i></span><span class="v">${DS.topBy === 'sum' ? anS(v) : v}</span></div>`; }).join('') || '<div class="an-empty">Нет данных</div>'}</div></div>
      <div class="card card-pad"><div class="an-h"><h3>Распределение продаж по врачам</h3></div>
        <div class="an-donut"><svg viewBox="0 0 140 140" width="170" height="170">${donut}<text x="70" y="68" text-anchor="middle" class="big">${fmtInt(dist.total)}</text><text x="70" y="86" text-anchor="middle" class="sm">чеков</text></svg>
          <div class="an-leg">${seg.map(([v, c, l]) => `<div><i style="background:${c}"></i><span>${l}<b>${Math.round(v / dTot * 100)}%</b><small>${fmtInt(v)} чеков</small></span></div>`).join('')}</div></div></div>
      <div class="card card-pad"><div class="an-h"><h3>Продажи с врачом по продавцам</h3></div>
        <div class="an-seg">${[['receipts', 'По количеству чеков'], ['sum', 'По сумме продаж']].map(([k, l]) => `<button data-dssb="${k}" class="${DS.selBy === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="an-vbars">${selBars.map(s => { const v = DS.selBy === 'sum' ? s.docSum : s.docReceipts; return `<div class="an-vb ${s.risk ? 'risk' : ''}" data-dssel="${esc(s.key)}" title="${esc(s.name)}"><b>${DS.selBy === 'sum' ? Math.round(v / 1000) + 'к' : v}</b><i style="height:${Math.max(3, v / maxSel * 100)}%"></i><span>${esc(s.name.split(' ')[0])}</span></div>`; }).join('') || '<div class="an-empty">Нет данных</div>'}</div></div>
    </div>
    <div class="card card-pad"><div class="an-h"><h3>Продажи по продавцам и врачам</h3><span class="muted sm">Красным — пары с признаками предвзятости (наведите, чтобы увидеть причину)</span></div>
      <div class="tbl-wrap"><table class="tbl an-tbl an-main"><thead><tr><th rowspan="2">Продавец</th><th rowspan="2" class="r">Всего чеков</th><th rowspan="2" class="r">Чеков с врачом</th><th rowspan="2" class="r">Сумма (с врачом)</th><th rowspan="2" class="c">Уник. врачей</th><th rowspan="2" class="r">Без врача</th><th colspan="6" class="c an-top3">Топ-3 врача (чеков · % от чеков продавца с врачом)</th></tr>
        <tr><th>Врач 1</th><th class="r">Чеков</th><th>Врач 2</th><th class="r">Чеков</th><th>Врач 3</th><th class="r">Чеков</th></tr></thead><tbody>${trs || '<tr><td colspan="12" class="tbl-empty">Нет данных</td></tr>'}</tbody></table></div>
      <div class="an-pager"><span class="muted">Показано ${sellers.length ? (DS.page - 1) * DS.per + 1 : 0}–${Math.min(sellers.length, DS.page * DS.per)} из ${sellers.length}</span><span class="an-pages">${Array.from({ length: pagesN }, (_, i) => `<button data-dspage="${i + 1}" class="${DS.page === i + 1 ? 'on' : ''}">${i + 1}</button>`).join('')}</span>
        <label class="muted">Показывать по <select class="fselect an-per" id="dsPer">${[5, 10, 20, 50].map(n => `<option ${DS.per === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
    </div>
    <div class="an-row3 an-bottom">
      <div class="card card-pad"><div class="an-h"><h3>Детализация продавца</h3><select class="fselect an-sm" id="dsSelDet">${d.sellers.map(s => `<option value="${esc(s.key)}" ${DS.selSeller === s.key ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
        ${sS ? `<div class="muted sm" style="margin-bottom:6px">${esc(sS.shop)} · ${sS.docReceipts} чеков с врачом из ${sS.receipts}</div>` : ''}
        <div class="tbl-wrap an-scroll"><table class="tbl an-tbl"><thead><tr><th>Врач</th><th>Специализация</th><th class="r">Чеков</th><th class="r">Сумма</th><th class="r">% от продаж продавца</th></tr></thead><tbody>${sellerDet || '<tr><td colspan="5" class="tbl-empty">Нет чеков с врачом</td></tr>'}</tbody></table></div></div>
      <div class="card card-pad"><div class="an-h"><h3>Детализация врача</h3><select class="fselect an-sm" id="dsDocDet">${d.doctors.map(x => `<option value="${esc(x.ref)}" ${DS.selDoctor === x.ref ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
        ${sD ? `<div class="muted sm" style="margin-bottom:6px">${esc(sD.specialty || 'специализация не указана')} · ${sD.receipts} чеков · ${anS(sD.sum)}</div>` : ''}
        <div class="tbl-wrap an-scroll"><table class="tbl an-tbl"><thead><tr><th>Продавец</th><th class="r">Чеков</th><th class="r">Сумма</th><th class="r">% от продаж врача</th></tr></thead><tbody>${docDet || '<tr><td colspan="4" class="tbl-empty">Нет данных</td></tr>'}</tbody></table></div></div>
      <div class="card card-pad"><div class="an-h"><h3>Анализ предвзятости <span class="an-i" title="${esc(d.rules)}">i</span></h3>
        <div class="an-seg sm">${[['pairs', 'По врачам'], ['sellers', 'По продавцам']].map(([k, l]) => `<button data-dsbias="${k}" class="${DS.biasTab === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        ${flagged.length || markers.length ? `<div class="an-alert"><b>⚠ Выявлены возможные случаи предвзятости</b><span>${nHigh ? `${nHigh} пар с высокой долей` : `${flagged.length} пар`}${markers.length ? ` · ${markers.map(s => esc(s.name)).join(', ')} отмечает врача в чеке намного чаще коллег` : ''}</span></div>` : '<div class="an-ok">✓ Явных перекосов за период нет</div>'}
        <div class="tbl-wrap an-scroll">${biasBody}</div></div>
    </div></div>`;
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  on('dsApply', 'click', () => { const nf = $('dsFrom').value, nt = $('dsTo').value, nw = $('dsWh').value; const reload = nf !== DS.from || nt !== DS.to || nw !== DS.wh; DS.from = nf; DS.to = nt; DS.wh = nw; DS.doctor = $('dsDoc').value; DS.seller = $('dsSel').value; DS.spec = $('dsSpec').value; DS.page = 1; reload ? renderDocSellers(true) : dsDraw(); });
  on('dsPer', 'change', e => { DS.per = +e.target.value; DS.page = 1; dsDraw(); });
  on('dsSelDet', 'change', e => { DS.selSeller = e.target.value; dsDraw(); });
  on('dsDocDet', 'change', e => { DS.selDoctor = e.target.value; dsDraw(); });
  on('dsExport', 'click', () => anCsv(`vrachi-prodavcy_${DS.from}_${DS.to}.csv`, ['Магазин', 'Продавец', 'Врач', 'Код врача', 'Чеков', 'Сумма', 'Доля врача у продавца %', 'Доля у коллег %', 'Доля чеков врача от продавца %', 'Доля продаж продавца %', 'Предвзятость', 'Причина'],
    d.pairs.map(p => [p.shopName, p.sellerName, p.doctorName, p.doctorCode, p.count, p.sum, p.shareSeller, p.expected, p.shareDoctor, p.sellerShopShare, p.level === 'high' ? 'Высокая' : p.level === 'mid' ? 'Средняя' : '', p.why])));
  box.querySelectorAll('[data-dstop]').forEach(b => b.addEventListener('click', () => { DS.topBy = b.dataset.dstop; dsDraw(); }));
  box.querySelectorAll('[data-dssb]').forEach(b => b.addEventListener('click', () => { DS.selBy = b.dataset.dssb; dsDraw(); }));
  box.querySelectorAll('[data-dsbias]').forEach(b => b.addEventListener('click', () => { DS.biasTab = b.dataset.dsbias; dsDraw(); }));
  box.querySelectorAll('[data-dspage]').forEach(b => b.addEventListener('click', () => { DS.page = +b.dataset.dspage; dsDraw(); }));
  box.querySelectorAll('[data-dssel]').forEach(b => b.addEventListener('click', () => { DS.selSeller = b.dataset.dssel; dsDraw(); }));
  box.querySelectorAll('[data-dsdoc]').forEach(b => b.addEventListener('click', () => { DS.selDoctor = b.dataset.dsdoc; dsDraw(); }));
  box.querySelectorAll('[data-dspair]').forEach(b => b.addEventListener('click', () => { const [s, dd] = b.dataset.dspair.split('|'); DS.selSeller = s; DS.selDoctor = dd; dsDraw(); }));
}

// ═════════════ 2) ВОЗВРАТЫ (детально) ═════════════
const RT2 = { from: '', to: '', wh: '', seller: '', reason: '', method: '', status: '', doctor: '', client: '', no: '', q: '', page: 1, per: 20, sel: '', data: null };
const RT_ST = { paid: ['Выплачено', 'ok'], exchange: ['Обмен', 'ex'], nopay: ['Не выплачено', 'no'], noreceipt: ['Без чека', 'gr'], voided: ['Аннулирован', 'no'] };
const rtPayIc = (m) => /налич/i.test(m) ? '💵' : /alif/i.test(m) ? '🅰' : /dc/i.test(m) ? '🟧' : /humo/i.test(m) ? '💳' : '💳';
async function renderReturns2(force) {
  const box = $('rtBody'); if (!box) return;
  if (!RT2.from) { RT2.from = anMonthStart(); RT2.to = dushToday(); }
  if (!RT2.data || force) {
    box.innerHTML = '<div class="loading">⏳ Загружаю возвраты…</div>';
    try { RT2.data = await anApi('returns-detail', `&from=${RT2.from}&to=${RT2.to}${RT2.wh ? '&wh=' + RT2.wh : ''}`); bumpSync(); }
    catch (e) { box.innerHTML = errBar('Не удалось загрузить возвраты: ' + e.message); return; }
  }
  rtDraw();
}
function rtFiltered() {
  const f = RT2; const s = (x) => String(x || '').toLowerCase();
  return RT2.data.returns.filter(r => {
    if (f.seller && r.returnBy !== f.seller && r.soldBy !== f.seller) return false;
    if (f.reason && r.reason !== f.reason) return false;
    if (f.method && !r.refundMethod.includes(f.method)) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.doctor && !s(r.doctor).includes(s(f.doctor))) return false;
    if (f.client) { const c = r.client; if (!c || !(s(c.name) + ' ' + s(c.phone) + ' ' + s(c.card)).includes(s(f.client))) return false; }
    if (f.no && !(s(r.returnNo).includes(s(f.no)) || s(r.saleNo).includes(s(f.no)))) return false;
    if (f.q && !(s(r.product.name) + ' ' + s(r.product.sku) + ' ' + s(r.barcode)).includes(s(f.q))) return false;
    return true;
  });
}
function rtDraw() {
  const box = $('rtBody'); const d = RT2.data; if (!box || !d) return;
  const rows = rtFiltered();
  const K = d.kpi;
  const all = d.returns;
  const sellers = [...new Set(all.flatMap(r => [r.returnBy, r.soldBy]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const reasons = [...new Set(all.map(r => r.reason))];
  const methods = [...new Set(all.flatMap(r => r.refund.map(x => x.label)))];
  const doctors = [...new Set(all.map(r => r.doctor).filter(Boolean))].sort();
  const pagesN = Math.max(1, Math.ceil(rows.length / RT2.per)); if (RT2.page > pagesN) RT2.page = pagesN;
  const page = rows.slice((RT2.page - 1) * RT2.per, RT2.page * RT2.per);
  if (RT2.sel && !rows.some(r => r.id === RT2.sel)) RT2.sel = '';
  const cur = rows.find(r => r.id === RT2.sel);
  const fsum = rows.reduce((a, r) => a + (Number(r.sum) || 0), 0);
  const opt = (arr, v, all) => `<option value="">${all}</option>` + arr.map(x => `<option ${v === x ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const kc = (ic, tone, label, v, dlt, sub) => `<div class="an-kpi"><span class="an-kic ${tone}">${ic}</span><div><div class="an-kl">${label}</div><div class="an-kv">${v} ${dlt || ''}</div>${sub ? `<div class="an-ks">${sub}</div>` : ''}</div></div>`;
  const pagesBtns = (() => { const out = []; for (let i = 1; i <= pagesN; i++) if (i === 1 || i === pagesN || Math.abs(i - RT2.page) <= 2) out.push(i); else if (out[out.length - 1] !== '…') out.push('…'); return out.map(i => i === '…' ? '<span class="muted">…</span>' : `<button data-rtpage="${i}" class="${RT2.page === i ? 'on' : ''}">${i}</button>`).join(''); })();
  box.innerHTML = `<div class="an an-rt">
    <div class="card card-pad an-filters">
      <div class="an-f"><label>Период возврата</label><div class="an-range"><input type="date" class="finput" id="rtFrom" value="${RT2.from}"><span>—</span><input type="date" class="finput" id="rtTo" value="${RT2.to}"></div></div>
      <div class="an-f"><label>Магазин</label><select class="fselect" id="rtWh"><option value="">Все магазины</option>${d.shops.map(s => `<option value="${s.wh}" ${RT2.wh === s.wh ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div class="an-f"><label>Продавец</label><select class="fselect" id="rtSel">${opt(sellers, RT2.seller, 'Все продавцы')}</select></div>
      <div class="an-f"><label>Причина возврата</label><select class="fselect" id="rtReason">${opt(reasons, RT2.reason, 'Все причины')}</select></div>
      <div class="an-f"><label>Способ выплаты</label><select class="fselect" id="rtMethod">${opt(methods, RT2.method, 'Все способы')}</select></div>
      <div class="an-f"><label>Статус</label><select class="fselect" id="rtStatus"><option value="">Все статусы</option>${Object.entries(RT_ST).map(([k, [l]]) => `<option value="${k}" ${RT2.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="an-f"><label>Врач (если был)</label><select class="fselect" id="rtDoc">${opt(doctors, RT2.doctor, 'Все врачи')}</select></div>
      <div class="an-f"><label>Клиент</label><input class="finput" id="rtClient" value="${esc(RT2.client)}" placeholder="🔍 ФИО, телефон, номер карты…"></div>
      <div class="an-f"><label>Номер чека</label><input class="finput" id="rtNo" value="${esc(RT2.no)}" placeholder="RMK-…"></div>
      <div class="an-f"><label>Товар</label><input class="finput" id="rtQ2" value="${esc(RT2.q)}" placeholder="🔍 Название, артикул, штрихкод…"></div>
      <div class="an-f an-fb"><button class="btn" id="rtReset2">↻ Сбросить</button><button class="btn btn-primary" id="rtApply2">▽ Применить</button><button class="btn btn-ghost" id="rtExport">⭳ Экспорт</button></div>
    </div>
    <div class="an-kpis">
      ${kc('↩', 'g', 'Всего возвратов', fmtInt(K.count.v), anDelta(K.count.d, true), 'к предыдущему периоду')}
      ${kc('💸', 'r', 'Сумма возвратов', anS(K.sum.v), anDelta(K.sum.d, true))}
      ${kc('📊', 'b', 'Средняя сумма возврата', anS(K.avg.v), anDelta(K.avg.d, true))}
      ${kc('🔄', 'gr', 'Обмен на другой товар', fmtInt(K.exchange.count), `<span class="muted sm">(${String(K.exchange.pct).replace('.', ',')}%)</span>`, anS(K.exchange.sum))}
      ${kc('💵', 'am', 'Выплата клиенту', fmtInt(K.cash.count + K.card.count), `<span class="muted sm">(${String(Math.round((K.cash.pct + K.card.pct) * 10) / 10).replace('.', ',')}%)</span>`, `наличными ${anS(K.cash.sum)} · безнал ${anS(K.card.sum)}`)}
      ${kc('⏱', 'gr', 'Через сколько возвращают', K.avgDays == null ? '—' : String(K.avgDays).replace('.', ',') + ' дн.', '', 'в среднем от покупки')}
    </div>
    ${d.reasons.length ? `<div class="an-reasons">${d.reasons.map(x => `<button data-rtreason="${esc(x.reason)}" class="${RT2.reason === x.reason ? 'on' : ''}">${esc(x.reason)} <b>${x.count}</b> <span>${anS(x.sum)}</span></button>`).join('')}</div>` : ''}
    <div class="an-rtgrid">
      <div class="card card-pad">
        <div class="tbl-wrap"><table class="tbl an-tbl an-rtt"><thead><tr><th>Возврат</th><th>Покупка (чек)</th><th>Товар</th><th class="r">Сумма</th><th>Способ выплаты</th><th>Причина</th><th>Клиент</th><th>Оформил</th><th>Статус</th></tr></thead>
        <tbody>${page.map(r => { const st = RT_ST[r.status] || [r.status, 'gr']; return `<tr data-rtid="${r.id}" class="${RT2.sel === r.id ? 'on' : ''}">
          <td class="nw"><b>${esc(r.returnNo || '—')}</b><div class="muted sm">${dushTime(r.returnedAt, true)}</div><div class="muted sm">${esc(r.shop)}</div></td><td class="nw">${esc(r.saleNo || '—')}<div class="muted sm">${r.soldAt ? dushTime(r.soldAt, true) : '—'}</div>${r.days != null ? `<div class="muted sm">${r.days === 0 ? 'в тот же день' : 'через ' + r.days + ' дн.'}</div>` : ''}</td>
          <td><div class="an-prod">${r.product.photo ? `<img src="${esc(r.product.photo)}" alt="" loading="lazy">` : '<span class="an-noimg">👟</span>'}<span><b>${esc(r.product.name)}</b><small>Размер ${esc(String(r.product.size || '—').replace(/^размер[:\s]*/i, ''))}</small></span></div></td>
          <td class="r tnum strong">${anS(r.sum)}</td><td class="nw">${rtPayIc(r.refundMethod)} ${esc(r.refundMethod)}</td><td>${esc(r.reason)}${r.reasonNote ? `<div class="muted sm">${esc(r.reasonNote)}</div>` : ''}</td>
          <td>${r.client ? esc(r.client.name || r.client.phone || 'карта') : '<span class="muted">—</span>'}</td><td>${esc(r.returnBy || '—')}</td><td><span class="an-st ${st[1]}">${st[0]}</span></td></tr>`; }).join('') || '<tr><td colspan="9" class="tbl-empty">За выбранный период возвратов нет</td></tr>'}</tbody></table></div>
        <div class="an-pager"><span class="muted">Показано ${rows.length ? (RT2.page - 1) * RT2.per + 1 : 0}–${Math.min(rows.length, RT2.page * RT2.per)} из ${rows.length} · на сумму ${anS(fsum)}</span><span class="an-pages">${pagesBtns}</span>
          <label class="muted">Показывать по <select class="fselect an-per" id="rtPer">${[10, 20, 50, 100].map(n => `<option ${RT2.per === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
      </div>
      ${cur ? `<div class="an-drawer-bg" id="rtSideBg"></div><div class="an-side an-drawer">${rtSide(cur)}</div>` : ''}
    </div></div>`;
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  const val = (id) => ($(id) || {}).value || '';
  on('rtApply2', 'click', () => {
    const nf = val('rtFrom'), nt = val('rtTo'), nw = val('rtWh'); const reload = nf !== RT2.from || nt !== RT2.to || nw !== RT2.wh;
    Object.assign(RT2, { from: nf, to: nt, wh: nw, seller: val('rtSel'), reason: val('rtReason'), method: val('rtMethod'), status: val('rtStatus'), doctor: val('rtDoc'), client: val('rtClient').trim(), no: val('rtNo').trim(), q: val('rtQ2').trim(), page: 1 });
    reload ? renderReturns2(true) : rtDraw();
  });
  ['rtClient', 'rtNo', 'rtQ2'].forEach(id => on(id, 'keydown', e => { if (e.key === 'Enter') $('rtApply2').click(); }));
  on('rtReset2', 'click', () => { Object.assign(RT2, { seller: '', reason: '', method: '', status: '', doctor: '', client: '', no: '', q: '', page: 1 }); rtDraw(); });
  on('rtPer', 'change', e => { RT2.per = +e.target.value; RT2.page = 1; rtDraw(); });
  on('rtExport', 'click', () => anCsv(`vozvraty_${RT2.from}_${RT2.to}.csv`, ['№ возврата', 'Дата возврата', '№ чека продажи', 'Дата покупки', 'Дней', 'Магазин', 'Товар', 'Артикул', 'Размер', 'Штрихкод', 'Сумма возврата', 'Способ выплаты', 'Оплата при покупке', 'Сумма чека', 'Причина', 'Комментарий', 'Статус', 'Оформил возврат', 'Продавец (покупка)', 'Врач', 'Клиент', 'Телефон', 'Карта'],
    rows.map(r => [r.returnNo, dushTime(r.returnedAt, true), r.saleNo, r.soldAt ? dushTime(r.soldAt, true) : '', r.days, r.shop, r.product.name, r.product.sku, r.product.size, r.barcode, r.sum, r.refundMethod, r.salePayMethod, r.saleTotal, r.reason, r.reasonNote, (RT_ST[r.status] || [r.status])[0], r.returnBy, r.soldBy, r.doctor, r.client && r.client.name, r.client && r.client.phone, r.client && r.client.card])));
  box.querySelectorAll('[data-rtid]').forEach(tr => tr.addEventListener('click', () => { RT2.sel = tr.dataset.rtid; rtDraw(); }));
  box.querySelectorAll('[data-rtpage]').forEach(b => b.addEventListener('click', () => { RT2.page = +b.dataset.rtpage; rtDraw(); }));
  box.querySelectorAll('[data-rtreason]').forEach(b => b.addEventListener('click', () => { RT2.reason = RT2.reason === b.dataset.rtreason ? '' : b.dataset.rtreason; RT2.page = 1; rtDraw(); }));
  const closeSide = () => { RT2.sel = ''; rtDraw(); };
  const cls = $('rtSideClose'); if (cls) cls.addEventListener('click', closeSide);
  const bg = $('rtSideBg'); if (bg) bg.addEventListener('click', closeSide);
  if (cur && !RT2._esc) { RT2._esc = true; document.addEventListener('keydown', e => { if (e.key === 'Escape' && RT2.sel && $('rtSideBg')) { RT2.sel = ''; rtDraw(); } }); }
}
function rtSide(r) {
  const st = RT_ST[r.status] || [r.status, 'gr'];
  const kv = (k, v) => `<div class="an-kvr"><span>${k}</span><b>${v}</b></div>`;
  const hist = [
    r.soldAt ? [`Покупка · чек ${esc(r.saleNo)}`, dushTime(r.soldAt, true), esc(r.soldBy || '')] : null,
    [`Возврат оформлен · ${esc(r.returnNo)}`, dushTime(r.returnedAt, true), esc(r.returnBy || '')],
    r.status === 'exchange' ? ['Обмен на другой товар', dushTime(r.returnedAt, true), 'новым чеком продажи'] : r.status === 'paid' ? [`Выплата клиенту: ${esc(r.refundMethod)}`, dushTime(r.returnedAt, true), anS(r.sum)] : null,
  ].filter(Boolean);
  return `<div class="an-sh"><h3>Возврат ${esc(r.returnNo || '')}</h3><button class="an-x" id="rtSideClose" title="Закрыть">✕</button></div>
    <div class="an-stbox ${st[1]}"><span>✓</span><div><b>${r.status === 'exchange' ? 'Обмен оформлен' : r.status === 'paid' ? 'Возврат оформлен' : st[0]}</b><small>${dushTime(r.returnedAt, true)}</small></div><em class="an-st ${st[1]}">${st[0]}</em></div>
    <h4>Информация о чеке (покупка)</h4>
    ${kv('№ чека', esc(r.saleNo || '—'))}${kv('Дата покупки', r.soldAt ? dushTime(r.soldAt, true) : '—')}${kv('Магазин', esc(r.soldShop || r.shop))}${kv('Продавец (покупка)', esc(r.soldBy || '—'))}${kv('Врач (если был)', esc(r.doctor || '—'))}${kv('Сумма чека', r.saleTotal != null ? anS(r.saleTotal) : '—')}${kv('Оплата при покупке', esc(r.salePayMethod))}
    <div class="an-pcard">${r.product.photo ? `<img src="${esc(r.product.photo)}" alt="">` : '<span class="an-noimg big">👟</span>'}<div><b>${esc(r.product.name)}</b>${r.product.sku ? `<small>Артикул: ${esc(r.product.sku)}</small>` : ''}<small>Размер: ${esc(r.product.size || '—')}</small><small class="mono">${esc(r.barcode)}</small><em>${anS(r.sum)}</em></div></div>
    <h4>Информация о возврате</h4>
    ${kv('Дата возврата', dushTime(r.returnedAt, true))}${kv('Магазин возврата', esc(r.shop))}${kv('Оформил возврат', esc(r.returnBy || '—'))}${kv('Причина возврата', esc(r.reason))}${r.reasonNote ? kv('Комментарий', esc(r.reasonNote)) : ''}${kv('Через сколько', r.days == null ? '—' : r.days === 0 ? 'в тот же день' : r.days + ' дн. после покупки')}
    <div class="an-sum"><span>Сумма возврата</span><b>${anS(r.sum)}</b></div>
    ${kv('Способ выплаты клиенту', `${rtPayIc(r.refundMethod)} ${esc(r.refundMethod)}`)}${r.refund.length > 1 ? r.refund.map(x => kv('— ' + esc(x.label), anS(x.amount))).join('') : ''}${kv('Статус выплаты', `<span class="an-st ${st[1]}">${st[0]}</span>`)}${kv('Товар сейчас', esc(r.unitStatus === 'in_stock' ? 'на складе' : r.unitStatus === 'sold' ? 'продан снова' : r.unitStatus || '—'))}
    <h4>Клиент</h4>
    ${r.client ? `<div class="an-client"><span>👤</span><div><b>${esc(r.client.name || 'Без имени')}</b>${r.client.phone ? `<small>📞 ${esc(r.client.phone)}</small>` : ''}${r.client.card ? `<small>💳 № карты: ${esc(r.client.card)}</small>` : ''}</div></div>` : '<div class="muted sm">Покупка без дисконтной карты — клиент не известен</div>'}
    <h4>История</h4>
    <div class="an-hist">${hist.map(h => `<div><i></i><b>${h[0]}</b><small>${h[1]} · ${h[2]}</small></div>`).join('')}</div>`;
}

// ═════════════ 3) ЧЕКИ ПРОДАЖ (детально, в стиле «Возвратов») ═════════════
const SL = { from: '', to: '', wh: '', seller: '', method: '', status: '', doctor: '', client: '', no: '', q: '', page: 1, per: 20, sel: '', data: null };
const SL_ST = { paid: ['Оплачен', 'ok'], partial: ['Частичный возврат', 'am'], returned: ['Возвращён', 'no'], voided: ['Аннулирован', 'gr'] };
async function renderSales2(force) {
  const box = $('rcBody'); if (!box) return;
  if (!SL.from) { SL.from = dushToday(); SL.to = dushToday(); }
  if (!SL.data || force) {
    box.innerHTML = '<div class="loading">⏳ Загружаю чеки…</div>';
    try { SL.data = await anApi('sales-detail', `&from=${SL.from}&to=${SL.to}${SL.wh ? '&wh=' + SL.wh : ''}`); bumpSync(); }
    catch (e) { box.innerHTML = errBar('Не удалось загрузить чеки: ' + e.message); return; }
  }
  slDraw();
}
function slFiltered() {
  const f = SL; const s = (x) => String(x || '').toLowerCase();
  return SL.data.receipts.filter(r => {
    if (f.seller && r.seller !== f.seller) return false;
    if (f.method && !r.pays.some(p => p.label === f.method)) return false;
    if (f.status === 'edited') { if (!r.edited) return false; } else if (f.status === 'disc') { if (!(r.disc > 0)) return false; } else if (f.status && r.status !== f.status) return false;
    if (f.doctor === '__any') { if (!r.doctor) return false; } else if (f.doctor === '__none') { if (r.doctor) return false; } else if (f.doctor && r.doctor !== f.doctor) return false;
    if (f.client) { const c = r.client; if (!c || !(s(c.name) + ' ' + s(c.phone) + ' ' + s(c.card)).includes(s(f.client))) return false; }
    if (f.no && !s(r.no).includes(s(f.no))) return false;
    if (f.q && !r.items.some(i => (s(i.name) + ' ' + s(i.sku) + ' ' + s(i.barcode)).includes(s(f.q)))) return false;
    return true;
  });
}
function slDraw() {
  const box = $('rcBody'); const d = SL.data; if (!box || !d) return;
  const rows = slFiltered();
  const K = d.kpi, all = d.receipts;
  const sellers = [...new Set(all.map(r => r.seller).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const methods = d.payMethods.map(x => x.label);
  const doctors = [...new Set(all.map(r => r.doctor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const pagesN = Math.max(1, Math.ceil(rows.length / SL.per)); if (SL.page > pagesN) SL.page = pagesN;
  const page = rows.slice((SL.page - 1) * SL.per, SL.page * SL.per);
  if (SL.sel && !rows.some(r => r.id === SL.sel)) SL.sel = '';
  const cur = rows.find(r => r.id === SL.sel);
  const fsum = rows.filter(r => r.status !== 'voided').reduce((a, r) => a + r.total, 0);
  const opt = (arr, v, allL) => `<option value="">${allL}</option>` + arr.map(x => `<option ${v === x ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const kc = (ic, tone, label, v, dlt, sub) => `<div class="an-kpi"><span class="an-kic ${tone}">${ic}</span><div><div class="an-kl">${label}</div><div class="an-kv">${v} ${dlt || ''}</div>${sub ? `<div class="an-ks">${sub}</div>` : ''}</div></div>`;
  const pc = (x) => String(x).replace('.', ',');
  const pagesBtns = (() => { const out = []; for (let i = 1; i <= pagesN; i++) if (i === 1 || i === pagesN || Math.abs(i - SL.page) <= 2) out.push(i); else if (out[out.length - 1] !== '…') out.push('…'); return out.map(i => i === '…' ? '<span class="muted">…</span>' : `<button data-slpage="${i}" class="${SL.page === i ? 'on' : ''}">${i}</button>`).join(''); })();
  const stOpts = [['paid', 'Оплачен'], ['partial', 'Частичный возврат'], ['returned', 'Возвращён'], ['voided', 'Аннулирован'], ['edited', 'Изменён администратором'], ['disc', 'Со скидкой']];
  box.innerHTML = `<div class="an an-sl">
    <div class="card card-pad an-filters">
      <div class="an-f"><label>Период продажи</label><div class="an-range"><input type="date" class="finput" id="slFrom" value="${SL.from}"><span>—</span><input type="date" class="finput" id="slTo" value="${SL.to}"></div></div>
      <div class="an-f"><label>Магазин</label><select class="fselect" id="slWh"><option value="">Все магазины</option>${d.shops.map(s => `<option value="${s.wh}" ${SL.wh === s.wh ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div class="an-f"><label>Продавец</label><select class="fselect" id="slSel">${opt(sellers, SL.seller, 'Все продавцы')}</select></div>
      <div class="an-f"><label>Способ оплаты</label><select class="fselect" id="slMethod">${opt(methods, SL.method, 'Все способы')}</select></div>
      <div class="an-f"><label>Статус</label><select class="fselect" id="slStatus"><option value="">Все статусы</option>${stOpts.map(([k, l]) => `<option value="${k}" ${SL.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="an-f"><label>Врач</label><select class="fselect" id="slDoc"><option value="">Все чеки</option><option value="__any" ${SL.doctor === '__any' ? 'selected' : ''}>Только с врачом</option><option value="__none" ${SL.doctor === '__none' ? 'selected' : ''}>Без врача</option>${doctors.map(x => `<option ${SL.doctor === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
      <div class="an-f"><label>Клиент</label><input class="finput" id="slClient" value="${esc(SL.client)}" placeholder="🔍 ФИО, телефон, номер карты…"></div>
      <div class="an-f"><label>Номер чека</label><input class="finput" id="slNo" value="${esc(SL.no)}" placeholder="RMK-…"></div>
      <div class="an-f"><label>Товар</label><input class="finput" id="slQ" value="${esc(SL.q)}" placeholder="🔍 Название, артикул, штрихкод…"></div>
      <div class="an-f an-fb"><button class="btn" id="slReset">↻ Сбросить</button><button class="btn btn-primary" id="slApply">▽ Применить</button><button class="btn btn-ghost" id="slExport">⭳ Экспорт</button></div>
    </div>
    <div class="an-kpis">
      ${kc('🧾', 'g', 'Всего чеков', fmtInt(K.count.v), anDelta(K.count.d), 'к предыдущему периоду')}
      ${kc('💵', 'g', 'Сумма продаж', anS(K.sum.v), anDelta(K.sum.d))}
      ${kc('📊', 'b', 'Средний чек', anS(K.avg.v), anDelta(K.avg.d))}
      ${kc('👟', 'gr', 'Продано товаров', fmtInt(K.qty.v) + ' шт.', anDelta(K.qty.d))}
      ${kc('🏷', 'am', 'Скидки', anS(K.disc.v), '', `в ${fmtInt(K.disc.count)} чеках`)}
      ${kc('🩺', 'b', 'С врачом / с картой', `${pc(K.doctor.pct)}% <span class="muted sm">/ ${pc(K.card.pct)}%</span>`, '', `${fmtInt(K.doctor.count)} с врачом · ${fmtInt(K.card.count)} с картой`)}
      ${kc('↩', 'r', 'Возвраты по чекам', fmtInt(K.returns.count), '', K.returns.count ? anS(K.returns.sum) : 'возвратов нет')}
    </div>
    ${d.payMethods.length ? `<div class="an-reasons">${d.payMethods.map(x => `<button data-slm="${esc(x.label)}" class="${SL.method === x.label ? 'on' : ''}">${rtPayIc(x.label)} ${esc(x.label)} <b>${x.count}</b> <span>${anS(x.sum)}</span></button>`).join('')}</div>` : ''}
    <div class="card card-pad">
      <div class="tbl-wrap"><table class="tbl an-tbl an-rtt"><thead><tr><th>Чек</th><th>Товары</th><th class="r">Кол-во</th><th class="r">Сумма</th><th>Способ оплаты</th><th>Продавец</th><th>Врач</th><th>Клиент</th><th>Статус</th></tr></thead>
      <tbody>${page.map(r => { const st = SL_ST[r.status] || [r.status, 'gr']; const i0 = r.items[0] || { name: 'Товар', size: '' }; return `<tr data-slid="${esc(r.id)}" class="${SL.sel === r.id ? 'on' : ''}${r.status === 'voided' ? ' an-void' : ''}">
        <td class="nw"><b>${esc(r.no || '—')}</b><div class="muted sm">${dushTime(r.at, true)}</div><div class="muted sm">${esc(r.shop)}</div></td>
        <td><div class="an-prod">${i0.photo ? `<img src="${esc(i0.photo)}" alt="" loading="lazy">` : '<span class="an-noimg">👟</span>'}<span><b>${esc(i0.name)}</b><small>${i0.size ? 'Размер ' + esc(i0.size) : ''}${r.items.length > 1 ? `${i0.size ? ' · ' : ''}<span class="an-more">+ ещё ${r.items.length - 1}</span>` : ''}</small></span></div></td>
        <td class="r tnum">${fmtInt(r.qty)}</td>
        <td class="r tnum"><b>${anS(r.total)}</b>${r.disc > 0 ? `<div class="muted sm">скидка ${anS(r.disc)}</div>` : ''}</td>
        <td>${r.pays.map(p => `<div class="nw">${rtPayIc(p.label)} ${esc(p.label)}${r.pays.length > 1 ? ` <span class="muted sm">${anS(p.amount)}</span>` : ''}</div>`).join('') || '—'}</td>
        <td>${esc(r.seller || '—')}</td><td>${r.doctor ? esc(r.doctor) : '<span class="muted">—</span>'}</td>
        <td>${r.client ? esc(r.client.name || r.client.phone || 'карта') : '<span class="muted">—</span>'}</td>
        <td><span class="an-st ${st[1]}">${st[0]}</span>${r.edited ? '<div><span class="an-st gr sm2">изменён</span></div>' : ''}</td></tr>`; }).join('') || '<tr><td colspan="9" class="tbl-empty">За выбранный период чеков нет</td></tr>'}</tbody></table></div>
      <div class="an-pager"><span class="muted">Показано ${rows.length ? (SL.page - 1) * SL.per + 1 : 0}–${Math.min(rows.length, SL.page * SL.per)} из ${rows.length} · на сумму ${anS(fsum)}</span><span class="an-pages">${pagesBtns}</span>
        <label class="muted">Показывать по <select class="fselect an-per" id="slPer">${[10, 20, 50, 100].map(n => `<option ${SL.per === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
    </div>
    ${cur ? `<div class="an-drawer-bg" id="slSideBg"></div><div class="an-side an-drawer">${slSide(cur)}</div>` : ''}
  </div>`;
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  const val = (id) => ($(id) || {}).value || '';
  on('slApply', 'click', () => {
    const nf = val('slFrom'), nt = val('slTo'), nw = val('slWh'); const reload = nf !== SL.from || nt !== SL.to || nw !== SL.wh;
    Object.assign(SL, { from: nf, to: nt, wh: nw, seller: val('slSel'), method: val('slMethod'), status: val('slStatus'), doctor: val('slDoc'), client: val('slClient').trim(), no: val('slNo').trim(), q: val('slQ').trim(), page: 1 });
    reload ? renderSales2(true) : slDraw();
  });
  ['slClient', 'slNo', 'slQ'].forEach(id => on(id, 'keydown', e => { if (e.key === 'Enter') $('slApply').click(); }));
  on('slReset', 'click', () => { Object.assign(SL, { seller: '', method: '', status: '', doctor: '', client: '', no: '', q: '', page: 1 }); slDraw(); });
  on('slPer', 'change', e => { SL.per = +e.target.value; SL.page = 1; slDraw(); });
  on('slExport', 'click', () => anCsv(`cheki_${SL.from}_${SL.to}.csv`, ['№ чека', 'Дата', 'Магазин', 'Продавец', 'Врач', 'Товар', 'Артикул', 'Размер', 'Штрихкод', 'Кол-во', 'Цена', 'Скидка', 'Сумма позиции', 'Итого чека', 'Способ оплаты', 'Статус', 'Клиент', 'Телефон', 'Карта'],
    rows.flatMap(r => (r.items.length ? r.items : [{}]).map(i => [r.no, dushTime(r.at, true), r.shop, r.seller, r.doctor, i.name, i.sku, i.size, i.barcode, i.qty, i.price, i.disc, i.sum, r.total, r.pays.map(p => `${p.label} ${p.amount}`).join(' + '), (SL_ST[r.status] || [r.status])[0] + (r.edited ? ' (изменён)' : ''), r.client && r.client.name, r.client && r.client.phone, r.client && r.client.card]))));
  box.querySelectorAll('[data-slid]').forEach(tr => tr.addEventListener('click', () => { SL.sel = tr.dataset.slid; slDraw(); }));
  box.querySelectorAll('[data-slpage]').forEach(b => b.addEventListener('click', () => { SL.page = +b.dataset.slpage; slDraw(); }));
  box.querySelectorAll('[data-slm]').forEach(b => b.addEventListener('click', () => { SL.method = SL.method === b.dataset.slm ? '' : b.dataset.slm; SL.page = 1; slDraw(); }));
  const closeSide = () => { SL.sel = ''; slDraw(); };
  on('slSideClose', 'click', closeSide); on('slSideBg', 'click', closeSide);
  on('slCopy', 'click', async () => { try { await navigator.clipboard.writeText(cur.no); $('slCopy').textContent = '✓ Скопировано'; } catch (_) {} });
  on('slEdit', 'click', () => slEdit(cur));
  if (cur && !SL._esc) { SL._esc = true; document.addEventListener('keydown', e => { if (e.key === 'Escape' && SL.sel && $('slSideBg') && !document.getElementById('rcEditOverlay')) { SL.sel = ''; slDraw(); } }); }
}
// Редактирование — существующая модалка админки (openReceiptEditModal), данные из receipt-items
async function slEdit(r) {
  const btn = $('slEdit'); if (btn) { btn.disabled = true; btn.textContent = '⏳ Загружаю…'; }
  try {
    if (!rcItemsCache[r.id]) rcItemsCache[r.id] = await posApi(`?action=receipt-items&ref=${encodeURIComponent(r.id)}`, { method: 'GET' });
    const before = rcItemsCache[r.id];
    openReceiptEditModal(r.id, r.no, document.createElement('div'));
    const mo = new MutationObserver(() => {
      if (document.getElementById('rcEditOverlay')) return;
      mo.disconnect();
      if (rcItemsCache[r.id] !== before) renderSales2(true); else slDraw();
    });
    mo.observe(document.body, { childList: true });
  } catch (e) { alert('Не удалось открыть чек: ' + e.message); if (btn) { btn.disabled = false; btn.textContent = '✏️ Редактировать'; } }
}
function slSide(r) {
  const st = SL_ST[r.status] || [r.status, 'gr'];
  const kv = (k, v) => `<div class="an-kvr"><span>${k}</span><b>${v}</b></div>`;
  const hist = [
    [`Продажа · чек ${esc(r.no)}`, dushTime(r.at, true), esc(r.seller || '')],
    r.client && r.client.bonus ? [`Начислено ${fmtInt(r.client.bonus)} бонусов на карту`, dushTime(r.at, true), esc(r.client.name || r.client.card || '')] : null,
    r.edited ? [`Чек изменён администратором${r.origTotal != null && r.origTotal !== r.total ? ` · было ${anS(r.origTotal)}` : ''}`, r.editedAt ? dushTime(r.editedAt, true) : '—', esc(r.editedBy || '')] : null,
    ...r.returns.map(x => [`Возврат ${esc(x.no || '')} · ${esc(x.reason)}`, dushTime(x.at, true), `${esc(x.by)} · ${anS(x.sum)}`]),
    r.status === 'voided' ? ['Чек аннулирован', r.editedAt ? dushTime(r.editedAt, true) : '—', esc(r.editedBy || '')] : null,
  ].filter(Boolean).sort((a, b) => 0);
  const retBc = new Set(r.returns.map(x => x.barcode));
  return `<div class="an-sh"><h3>Чек ${esc(r.no || '')}</h3><button class="an-x" id="slSideClose" title="Закрыть">✕</button></div>
    <div class="an-stbox ${st[1]}"><span>${r.status === 'paid' ? '✓' : r.status === 'voided' ? '✕' : '↩'}</span><div><b>${r.status === 'paid' ? 'Продажа оплачена' : st[0]}</b><small>${dushTime(r.at, true)} · ${esc(r.shop)}</small></div><em class="an-st ${st[1]}">${st[0]}</em></div>
    <div class="an-sbtns"><button class="btn btn-ghost" id="slCopy">⧉ Копировать №</button>${r.status !== 'voided' ? '<button class="btn" id="slEdit">✏️ Редактировать</button>' : ''}</div>
    <h4>Информация о чеке</h4>
    ${kv('№ чека', esc(r.no || '—'))}${kv('Дата и время', dushTime(r.at, true))}${kv('Магазин', esc(r.shop))}${kv('Продавец', esc(r.seller || '—'))}${kv('Врач (если был)', esc(r.doctor || '—'))}${kv('Источник', r.source === 'pos' ? 'Касса РМК' : esc(r.source || '—'))}
    <h4>Товары · ${fmtInt(r.qty)} шт.</h4>
    ${r.items.map(i => `<div class="an-pcard${retBc.has(i.barcode) ? ' ret' : ''}">${i.photo ? `<img src="${esc(i.photo)}" alt="">` : '<span class="an-noimg big">👟</span>'}<div><b>${esc(i.name)}</b>${i.sku ? `<small>Артикул: ${esc(i.sku)}</small>` : ''}${i.size ? `<small>Размер: ${esc(i.size)}</small>` : ''}${i.barcode ? `<small class="mono">${esc(i.barcode)}</small>` : ''}<small>${fmtInt(i.qty)} × ${anS(i.price)}${i.disc > 0 ? ` · скидка ${anS(i.disc)}${i.discPct ? ` (${Math.round(i.discPct)}%)` : ''}` : ''}</small>${retBc.has(i.barcode) ? '<small class="red">↩ возвращён</small>' : ''}<em>${anS(i.sum)}</em></div></div>`).join('') || '<div class="muted sm">Состав чека не найден</div>'}
    <h4>Оплата</h4>
    ${r.disc > 0 ? kv('Сумма без скидки', anS(r.gross)) + kv('Скидка', `<span class="red">−${anS(r.disc)}</span>`) : ''}
    <div class="an-sum"><span>Итого оплачено</span><b>${anS(r.total)}</b></div>
    ${r.pays.map(p => kv(`${rtPayIc(p.label)} ${esc(p.label)}`, anS(p.amount))).join('') || kv('Способ оплаты', '—')}
    ${r.returns.length ? `<h4>Возвраты по чеку</h4>${r.returns.map(x => kv(`${esc(x.no || 'Возврат')} · ${dushTime(x.at, true)}`, anS(x.sum))).join('')}${kv('Возвращено всего', `<span class="red">${anS(r.retSum)}</span>`)}` : ''}
    <h4>Клиент</h4>
    ${r.client ? `<div class="an-client"><span>👤</span><div><b>${esc(r.client.name || 'Без имени')}</b>${r.client.phone ? `<small>📞 ${esc(r.client.phone)}</small>` : ''}${r.client.card ? `<small>💳 № карты: ${esc(r.client.card)}</small>` : ''}${r.client.bonus ? `<small>⭐ Начислено бонусов: ${fmtInt(r.client.bonus)}${r.client.bonusReversed ? ' (списаны при возврате)' : ''}</small>` : ''}</div></div>` : '<div class="muted sm">Покупка без дисконтной карты — клиент не известен</div>'}
    <h4>История</h4>
    <div class="an-hist">${hist.map(h => `<div><i></i><b>${h[0]}</b><small>${h[1]} · ${h[2]}</small></div>`).join('')}</div>`;
}

// ═════════════ 4) НАСТРОЙКА ИИ-МОДЕЛИ (единая для всего РМК) ═════════════
async function aiSetApi(action, body) {
  const res = await svcFetch(`${BARCODE_SVC_URL}/api/ai?action=${action}`, {
    method: body ? 'POST' : 'GET', timeoutMs: 120000, retries: 0,
    headers: { 'X-Provision-Secret': BARCODE_SVC_SECRET, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.ok === false) throw new Error(d.error || `HTTP ${res.status}`);
  return d;
}
async function renderAiModelCard() {
  const box = $('aiModelCard'); if (!box) return;
  box.innerHTML = '<div class="card card-pad"><div class="muted">⏳ Загружаю настройку ИИ…</div></div>';
  let d;
  try { d = await aiSetApi('get'); } catch (e) { box.innerHTML = `<div class="card card-pad">${errBar('ИИ-модель: ' + e.message)}</div>`; return; }
  const known = d.list.map(m => m.id);
  const inhName = (k) => { const dm = d.kindDefaults && d.kindDefaults[k]; const m = dm && d.list.find(x => x.id === dm); return dm ? `— по умолчанию: ${esc(m ? m.name : dm)} —` : '— как основная —'; };
  const sel = (id, val, withInherit) => `<select class="fselect" id="${id}">${withInherit ? `<option value="">${inhName(String(id).replace(/^aiK_/, ''))}</option>` : ''}${d.list.map(m => `<option value="${m.id}" ${val === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}${val && !known.includes(val) ? `<option value="${esc(val)}" selected>${esc(val)}</option>` : ''}</select>`;
  const cur = d.list.find(m => m.id === d.model);
  box.innerHTML = `<div class="card card-pad an-ai">
    <div class="card-h-row"><h3>🤖 ИИ-модель</h3><span class="muted sm">${d.updatedAt ? 'изменено ' + dushTime(d.updatedAt, true) + (d.updatedBy ? ' · ' + esc(d.updatedBy) : '') : 'по умолчанию'}</span></div>
    <div class="muted" style="font-size:13px;margin-bottom:12px">Одна настройка для всего ИИ в РМК: отчёты и ассистент в Telegram, бот расходов, SMS, задачи, финансовый анализ, проверка скриншотов инкассации. Меняется здесь — без правки кода, действует в течение минуты.</div>
    <div class="an-ai-row"><label>Основная модель</label>${sel('aiMain', d.model)}<span class="muted sm">${cur ? esc(cur.note) : esc(d.model)}</span></div>
    <details class="an-ai-adv"><summary>Отдельная модель для функции (необязательно)</summary>
      ${Object.entries(d.kinds).map(([k, l]) => `<div class="an-ai-row"><label>${esc(l)}</label>${sel('aiK_' + k, d.models[k] || '', true)}</div>`).join('')}
    </details>
    <div class="an-ai-btns"><button class="btn" id="aiTest">⚡ Проверить</button><button class="btn btn-primary" id="aiSave">💾 Сохранить</button></div>
    <div id="aiMsg" class="muted sm" style="margin-top:10px"></div>
  </div>`;
  const msg = (t, bad) => { const m = $('aiMsg'); m.innerHTML = t; m.className = bad ? 'red sm' : 'muted sm'; };
  $('aiTest').addEventListener('click', async () => {
    msg('⏳ Отправляю тестовый запрос…');
    try { const r = await aiSetApi('test', { model: $('aiMain').value }); msg(`✅ ${esc(r.model)} отвечает за ${(r.ms / 1000).toFixed(1).replace('.', ',')} с: «${esc(r.text)}»`); }
    catch (e) { msg('❌ ' + esc(e.message), true); }
  });
  $('aiSave').addEventListener('click', async () => {
    const models = {}; Object.keys(d.kinds).forEach(k => { const v = ($('aiK_' + k) || {}).value; if (v) models[k] = v; });
    msg('⏳ Проверяю модель и сохраняю…'); $('aiSave').disabled = true;
    try {
      let by = 'admin'; try { by = (JSON.parse(localStorage.getItem('orto_admin_rmk_auth') || '{}').user) || by; } catch (_) {}
      await aiSetApi('save', { model: $('aiMain').value, models, by });
      await renderAiModelCard(); msg('✅ Сохранено. Новая модель начнёт работать в течение минуты.');
    } catch (e) { msg('❌ ' + esc(e.message), true); $('aiSave').disabled = false; }
  });
}
