// ═════════════════════════════════════════════════════════════════════
//  ПОСЕТИТЕЛИ (v1.6.3) — камеры Hikvision → подсчёт людей в зале.
//  Сервер каждые 3 мин (9:00–21:00) смотрит кадры и записывает только ЦИФРЫ
//  (app_state cam_stats:<склад>:<дата>). Кадры не хранятся.
//  Посетители ≈ человеко-минуты покупателей / средняя длительность визита.
//  Покупатели = все люди − сотрудники смены. Конверсия = чеки РМК / посетители.
//  Backend: https://1c-sync-barcodes.vercel.app/api/cams?action=stats|live|config
// ═════════════════════════════════════════════════════════════════════
const VS = { wh: localStorage.getItem('vs_wh') || '19db06fa-deb5-47db-acd7-486c5bc679d0', date: '', data: null, live: null, seq: 0 };
const VS_STORES = [['19db06fa-deb5-47db-acd7-486c5bc679d0', 'Сиёма'], ['5ca2d3e6-29c1-4d1a-aeee-832fa513e2e2', 'Айни']];
async function vsApi(q) {
  const r = await fetch(BARCODE_SVC_URL + '/api/cams' + q, { headers: { 'X-Provision-Secret': BARCODE_SVC_SECRET } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.ok === false) throw new Error(d.error || 'HTTP ' + r.status);
  return d;
}
const vsHM = (min) => { min = Math.round(min || 0); const h = Math.floor(min / 60), m = min % 60; return h ? `${h} ч ${m} мин` : `${m} мин`; };
function vsToday() { return new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10); }

async function renderVisitors(force) {
  const box = $('vsBody'); if (!box) return;
  if (!VS.date) VS.date = vsToday();
  if (!box.querySelector('.vs-wrap')) {
    box.innerHTML = `<div class="vs-wrap">
      <div class="card card-pad vs-bar">
        <select id="vsWh">${VS_STORES.map(([id, n]) => `<option value="${id}">${n}</option>`).join('')}</select>
        <input type="date" id="vsDate">
        <button class="btn" id="vsRef">Обновить</button>
        <span class="vs-live" id="vsLive"></span>
        <a class="btn vs-plan" id="vsPlan" target="_blank" rel="noopener">🧭 Люди на планограмме ↗</a>
      </div>
      <div id="vsMain"><div class="loading">⏳ Загрузка…</div></div>
      <div class="vs-note">Данные приблизительные: камера считает людей в кадре раз в 3 минуты (9:00–21:00). «Посетители» — оценка: время покупателей в зале ÷ средний визит. Сотрудников в смене и длительность визита можно поменять на планограмме → «⚙ Камеры». Фото с камер не сохраняются — только цифры.</div>
    </div>`;
    $('vsWh').value = VS.wh; $('vsDate').value = VS.date;
    $('vsWh').onchange = (e) => { VS.wh = e.target.value; localStorage.setItem('vs_wh', VS.wh); vsLoad(); vsLiveLoad(); };
    $('vsDate').onchange = (e) => { VS.date = e.target.value || vsToday(); vsLoad(); };
    $('vsRef').onclick = () => { vsLoad(); vsLiveLoad(); };
  }
  vsLoad(); vsLiveLoad();
}

async function vsLiveLoad() {
  const el = $('vsLive'); if (!el) return;
  $('vsPlan').href = 'planogram.html?wh=' + VS.wh;
  el.innerHTML = '<span class="vs-dot"></span> Сейчас: смотрю камеры…';
  const seq = ++VS.seq;
  try {
    const d = await vsApi('?action=live&wh=' + VS.wh);
    if (seq !== VS.seq) return;
    const bad = (d.cams || []).filter(c => !c.ok).length;
    el.innerHTML = `<span class="vs-dot on"></span> Сейчас в зале: <b>${d.total}</b>${d.floor2 ? ` + 2 этаж: <b>${d.floor2}</b>` : ''} · покупателей ≈ <b>${d.customers}</b>${bad ? ` · <span class="vs-warn">камер не ответило: ${bad}</span>` : ''}`;
  } catch (e) { if (seq === VS.seq) el.innerHTML = `<span class="vs-dot"></span> Камеры: ${esc(e.message)}`; }
}

async function vsLoad() {
  const main = $('vsMain'); if (!main) return;
  main.innerHTML = '<div class="loading">⏳ Загрузка…</div>';
  let d;
  try { d = await vsApi(`?action=stats&wh=${VS.wh}&date=${VS.date}`); } catch (e) { main.innerHTML = `<div class="card card-pad">Ошибка: ${esc(e.message)}</div>`; return; }
  VS.data = d;
  const t = d.totals, hasCam = t.coverMin > 0;
  const k = (ic, l, v, sub, tone) => kpi(ic, l, v, tone, sub);
  let html = `<div class="kpis">
    ${k('👣', 'Посетителей (оценка)', hasCam ? fmtInt(t.visitors) : '—', hasCam ? `пик в зале: ${t.peak} чел.` : 'нет данных камер за день')}
    ${k('🧾', 'Чеков', fmtInt(t.receipts), `${fmtNum(t.revenue)} ${CUR}`)}
    ${k('🎯', 'Конверсия', t.conversion != null ? t.conversion + '%' : '—', 'чеки ÷ посетители')}
    ${k('🧑‍💼', 'Сотрудник в зале', hasCam ? vsHM(t.staffMin) : '—', hasCam ? `из ${vsHM(t.coverMin)} наблюдения` : '')}
    ${k('⏸', 'Без покупателей', hasCam ? vsHM(t.idleMin) : '—', hasCam && t.coverMin ? `${Math.round(t.idleMin / t.coverMin * 100)}% времени` : '', 'gray')}
  </div>`;
  const hrs = []; for (let h = 9; h < 21; h++) hrs.push(d.hours.find(x => x.h === h) || { h, receipts: 0, revenue: 0, visitors: null, avg: null, peak: 0, staffMin: 0, idleMin: 0, coverMin: 0 });
  const extra = d.hours.filter(x => x.h < 9 || x.h >= 21); hrs.push(...extra); hrs.sort((a, b) => a.h - b.h);
  const mx = Math.max(1, ...hrs.map(h => Math.max(h.visitors || 0, h.receipts || 0)));
  const W = 760, H = 220, pad = 28, bw = (W - pad * 2) / hrs.length;
  let svg = `<svg viewBox="0 0 ${W} ${H + 26}" class="vs-chart">`;
  for (let i = 0; i <= 4; i++) { const y = pad + (H - pad * 2) * i / 4; svg += `<line x1="${pad}" x2="${W - 6}" y1="${y}" y2="${y}" stroke="#eef2f1"/><text x="${pad - 6}" y="${y + 4}" font-size="10" text-anchor="end" fill="#94a3b8">${Math.round(mx * (1 - i / 4))}</text>`; }
  hrs.forEach((h, i) => {
    const x = pad + i * bw, bh = (v) => (H - pad * 2) * (v || 0) / mx;
    if (h.visitors != null) svg += `<rect x="${x + bw * 0.12}" y="${H - pad - bh(h.visitors)}" width="${bw * 0.36}" height="${bh(h.visitors)}" rx="3" fill="#f97316"><title>${h.h}:00 — посетителей ≈ ${h.visitors}</title></rect>`;
    svg += `<rect x="${x + bw * 0.52}" y="${H - pad - bh(h.receipts)}" width="${bw * 0.36}" height="${bh(h.receipts)}" rx="3" fill="#10b981"><title>${h.h}:00 — чеков ${h.receipts}</title></rect>`;
    svg += `<text x="${x + bw / 2}" y="${H - pad + 16}" font-size="11" text-anchor="middle" fill="#475569">${h.h}</text>`;
  });
  svg += `</svg>`;
  html += `<div class="card card-pad"><div class="card-h-row"><h3>По часам</h3><span class="vs-leg"><i style="background:#f97316"></i>посетители ≈ <i style="background:#10b981"></i>чеки</span></div>${svg}
    <div class="vs-tbl-wrap"><table class="vs-tbl"><thead><tr><th>Час</th><th>В зале (сред./пик)</th><th>Посетителей ≈</th><th>Чеков</th><th>Конверсия</th><th>Выручка</th><th>Сотрудник в зале</th><th>Без покупателей</th></tr></thead><tbody>
    ${hrs.map(h => `<tr><td>${String(h.h).padStart(2, '0')}:00</td><td>${h.avg != null ? `${h.avg} / ${h.peak}` : '—'}</td><td>${h.visitors != null ? h.visitors : '—'}</td><td>${h.receipts || 0}</td><td>${h.visitors ? Math.round(h.receipts / h.visitors * 100) + '%' : '—'}</td><td>${h.revenue ? fmtNum(h.revenue) + ' ' + CUR : '—'}</td><td>${h.coverMin ? h.staffMin + ' из ' + h.coverMin + ' мин' : '—'}</td><td>${h.coverMin ? h.idleMin + ' мин' : '—'}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  if (!hasCam) html += `<div class="card card-pad vs-empty">За ${esc(VS.date.split('-').reverse().join('.'))} записей с камер нет. Подсчёт идёт с ${'28.10.2026'} — каждые 3 минуты с 9:00 до 21:00.</div>`;
  main.innerHTML = html;
}
