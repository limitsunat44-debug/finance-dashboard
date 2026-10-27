// ═════════════════════════════════════════════════════════════════════
//  ПОСЕТИТЕЛИ (v1.6.3) — камеры Hikvision → подсчёт людей в зале.
//  Сервер каждые 3 мин (9:00–21:00) смотрит кадры и записывает только ЦИФРЫ
//  (app_state cam_stats:<склад>:<дата>). Кадры не хранятся.
//  Зашло = рост числа покупателей между замерами (раз в минуту, сглажено); вместе вошедшие = 1 визит.
//  С покупкой = чеки РМК (не больше визитов); без покупки = визиты − чеки.
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
      <div class="vs-note">Данные приблизительные (±20%): камеры считают людей каждую минуту с 9:00 до 21:00. «Зашло» — сколько раз число покупателей в зале выросло; люди, вошедшие вместе, — один визит. «С покупкой» — визиты, закончившиеся чеком; «без покупки» — остальные. Сотрудников в смене и длительность визита можно поменять на планограмме → «⚙ Камеры». Фото с камер не сохраняются — только цифры.</div>
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
    ${k('🚶', 'Зашло людей', hasCam ? '≈ ' + fmtInt(t.people) : '—', hasCam ? `${fmtInt(t.visits)} визитов (компания = 1) · пик ${t.peak} чел.` : 'нет данных камер за день')}
    ${k('✅', 'Ушли с покупкой', hasCam ? fmtInt(t.bought) : '—', `чеков за день: ${fmtInt(t.receipts)} · ${fmtNum(t.revenue)} ${CUR}`)}
    ${k('❌', 'Ушли без покупки', hasCam ? '≈ ' + fmtInt(t.left) : '—', hasCam && t.leftPct != null ? `${t.leftPct}% визитов` : '', 'gray')}
    ${k('🎯', 'Конверсия', t.conversion != null ? t.conversion + '%' : '—', 'визиты с чеком')}
    ${k('⏸', 'Без покупателей', hasCam ? vsHM(t.idleMin) : '—', hasCam && t.coverMin ? `${Math.round(t.idleMin / t.coverMin * 100)}% из ${vsHM(t.coverMin)} наблюдения` : '', 'gray')}
  </div>`;
  const hrs = []; for (let h = 9; h < 21; h++) hrs.push(d.hours.find(x => x.h === h) || { h, receipts: 0, revenue: 0, visits: null, people: null, bought: 0, left: null, avg: null, peak: 0, staffMin: 0, idleMin: 0, coverMin: 0, samples: 0 });
  hrs.push(...d.hours.filter(x => x.h < 9 || x.h >= 21)); hrs.sort((a, b) => a.h - b.h);
  const mx = Math.max(1, ...hrs.map(h => Math.max((h.visits || 0), h.receipts || 0)));
  const W = 760, H = 220, pad = 28, bw = (W - pad * 2) / hrs.length;
  let svg = `<svg viewBox="0 0 ${W} ${H + 26}" class="vs-chart">`;
  for (let i = 0; i <= 4; i++) { const y = pad + (H - pad * 2) * i / 4; svg += `<line x1="${pad}" x2="${W - 6}" y1="${y}" y2="${y}" stroke="#eef2f1"/><text x="${pad - 6}" y="${y + 4}" font-size="10" text-anchor="end" fill="#94a3b8">${Math.round(mx * (1 - i / 4))}</text>`; }
  hrs.forEach((h, i) => {
    const x = pad + i * bw, bh = (v) => (H - pad * 2) * (v || 0) / mx, base = H - pad;
    if (h.samples) {
      const bought = Math.min(h.visits || 0, h.receipts || 0), left = h.left || 0;
      svg += `<rect x="${x + bw * 0.18}" y="${base - bh(bought)}" width="${bw * 0.64}" height="${bh(bought)}" rx="2" fill="#10b981"><title>${h.h}:00 — с покупкой ${bought}</title></rect>`;
      svg += `<rect x="${x + bw * 0.18}" y="${base - bh(bought) - bh(left)}" width="${bw * 0.64}" height="${bh(left)}" rx="2" fill="#f87171"><title>${h.h}:00 — без покупки ≈ ${left}</title></rect>`;
      if (h.visits) svg += `<text x="${x + bw / 2}" y="${base - bh(bought) - bh(left) - 4}" font-size="10.5" text-anchor="middle" fill="#334155">${h.visits}</text>`;
    } else if (h.receipts) {
      svg += `<rect x="${x + bw * 0.3}" y="${base - bh(h.receipts)}" width="${bw * 0.4}" height="${bh(h.receipts)}" rx="2" fill="#a7f3d0"><title>${h.h}:00 — чеков ${h.receipts} (камер не было)</title></rect>`;
    }
    svg += `<text x="${x + bw / 2}" y="${H - pad + 16}" font-size="11" text-anchor="middle" fill="#475569">${h.h}</text>`;
  });
  svg += `</svg>`;
  const dash = (v) => v == null ? '—' : v;
  html += `<div class="card card-pad"><div class="card-h-row"><h3>Визиты по часам</h3><span class="vs-leg"><i style="background:#10b981"></i>с покупкой <i style="background:#f87171"></i>без покупки</span></div>${svg}
    <div class="vs-tbl-wrap"><table class="vs-tbl"><thead><tr><th>Час</th><th>Зашло людей ≈</th><th>Визитов</th><th>С покупкой</th><th>Без покупки ≈</th><th>Конверсия</th><th>Чеков</th><th>Выручка</th><th>В зале (сред./пик)</th><th>Без покупателей</th></tr></thead><tbody>
    ${hrs.map(h => `<tr><td>${String(h.h).padStart(2, '0')}:00</td><td>${dash(h.people)}</td><td>${dash(h.visits)}</td><td>${h.samples ? Math.min(h.visits || 0, h.receipts) : '—'}</td><td class="${h.left ? 'vs-bad' : ''}">${dash(h.left)}</td><td>${h.visits ? Math.min(100, Math.round(h.receipts / h.visits * 100)) + '%' : '—'}</td><td>${h.receipts || 0}</td><td>${h.revenue ? fmtNum(h.revenue) + ' ' + CUR : '—'}</td><td>${h.avg != null ? `${h.avg} / ${h.peak}` : '—'}</td><td>${h.coverMin ? h.idleMin + ' мин' : '—'}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  if (!hasCam) html += `<div class="card card-pad vs-empty">За ${esc(VS.date.split('-').reverse().join('.'))} записей с камер нет. Подсчёт идёт с 28.10.2026 — каждую минуту с 9:00 до 21:00.</div>`;
  main.innerHTML = html;
}
