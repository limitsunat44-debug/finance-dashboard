// ══════════════════════════════════════════════════════════
//  SMS РАССЫЛКА (v1.3.0) — OsonSMS через backend /api/sms
//  Аудитории: дисконтные карты клиентов 10% + диагностики DocSales2.
//  Использует общие хелперы admin-rmk.js: $, esc, state, svcFetch, BARCODE_SVC_URL, BARCODE_SVC_SECRET, fmtNum.
// ══════════════════════════════════════════════════════════
const SMS = {
  tab: 'send', type: 'general', step: 1,
  status: null, templates: [], rules: [], rulesLast: null,
  src: 'all', filters: { branch: 'all', age: 'all', period: 'any', months_ago: '', points_min: '', points_max: '', q: '', skip_recent: true, exclude_branch: '' },
  rows: [], total: 0, info: null, sel: new Set(), page: 1, per: 20, loading: false,
  manual: '', text: '', long: false, name: '', tplId: '', schedule: '',
  tplCat: 'all', tplEdit: null, hist: { from: '', to: '', type: '', status: '' }, histRows: [],
};
const SMS_BRANCHES = ['Айни', 'Сиёма', 'Сити-Молл', 'Худжанд'];
const SMS_TYPES = [
  { id: 'general', ic: '📣', t: 'Общая рассылка', s: 'По дисконтным картам и базе клиентов', src: 'all' },
  { id: 'diag', ic: '🩺', t: 'После диагностики', s: 'Напоминания и приглашения', src: 'diag', tpl: 't_diag4m' },
  { id: 'remind', ic: '📅', t: 'Напоминание о визите', s: 'Через определённый период', src: 'diag', tpl: 't_remind' },
  { id: 'promo', ic: '％', t: 'Акции и новинки', s: 'Скидки и новые поступления', src: 'cards', tpl: 't_arrival' },
  { id: 'holiday', ic: '🎁', t: 'Поздравление', s: 'С праздниками', src: 'all', tpl: 't_holiday' },
  { id: 'individual', ic: '✈', t: 'Индивидуальная', s: 'Выбор конкретных номеров', src: 'manual' },
];
const SMS_TCATS = [['all', 'Все'], ['remind', 'Напоминания'], ['promo', 'Акции'], ['diag', 'После диагностики'], ['holiday', 'Поздравления'], ['cards', 'Карты'], ['general', 'Общие']];
const SMS_TCAT_IC = { remind: '📅', promo: '％', diag: '🩺', holiday: '🎁', cards: '💳', general: '✉' };
const SMS_VARS = [['Имя', 'имя клиента'], ['Баллы', 'баллы на карте'], ['Осталось', 'баллов до 100'], ['Филиал', 'магазин'], ['Товары', 'бренды поступления'], ['Дата', 'дата акции'], ['Скидка', '% скидки']];
const SMS_ST = { draft: 'Черновик', queued: 'В очереди', sending: 'Отправляется', done: 'Отправлено', paused: 'Пауза', cancelled: 'Отменено' };
const SMS_AI_TOPICS = [['diag', 'Повторная диагностика'], ['points', 'Баллы — скоро бонус 100 с.'], ['arrival', 'Новое поступление'], ['promo', 'Акция / скидка'], ['kids', 'Детская ортопедия'], ['remind', 'Пора проверить стельки'], ['holiday', 'Поздравление'], ['custom', 'Своя тема']];

async function smsApi(action, body, qs) {
  const res = await svcFetch(`${BARCODE_SVC_URL}/api/sms?action=${action}${qs || ''}`, {
    method: body ? 'POST' : 'GET', timeoutMs: 280000, retries: body ? 0 : 1,
    headers: { 'Content-Type': 'application/json', 'X-Provision-Secret': BARCODE_SVC_SECRET },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.ok === false) throw new Error(d.error || `HTTP ${res.status}`);
  return d;
}

// ── длина SMS (как на сервере) ──
const SMS_GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
function smsInfo(text) {
  const s = String(text || ''); let gsm = true, n7 = 0;
  for (const ch of s) { if (SMS_GSM.includes(ch)) n7++; else if ('^{}\\[~]|€'.includes(ch)) n7 += 2; else { gsm = false; break; } }
  if (gsm) return { chars: n7, unicode: false, parts: n7 <= 160 ? 1 : Math.ceil(n7 / 153), limit: n7 <= 160 ? 160 : 153 * Math.ceil(n7 / 153) };
  const n = Array.from(s).reduce((a, ch) => a + (ch.codePointAt(0) > 0xFFFF ? 2 : 1), 0);
  return { chars: n, unicode: true, parts: n <= 70 ? 1 : Math.ceil(n / 67), limit: n <= 70 ? 70 : 67 * Math.ceil(n / 67) };
}
function smsRender(text, r) {
  let s = String(text || ''); const pts = r && r.points != null ? r.points : null;
  const v = { 'Имя': r && r.name, 'Баллы': pts, 'Осталось': pts != null ? Math.max(0, 100 - pts) : '', 'Филиал': r && r.branch, 'Товары': SMS.goods || '', 'Дата': SMS.date || '', 'Скидка': SMS.discount || '' };
  if (!v['Имя']) s = s.replace(/,\s*\{Имя\}/g, '').replace(/\{Имя\}\s*,\s*/g, '').replace(/\{Имя\}\s*/g, '');
  s = s.replace(/\{(Имя|Баллы|Осталось|Филиал|Товары|Дата|Скидка)\}/g, (_, k) => v[k] == null ? '' : String(v[k]));
  s = s.replace(/^\s*([a-zа-яё])/, (m, c) => m.replace(c, c.toUpperCase()));
  return s.replace(/[ \t]{2,}/g, ' ').trim();
}
function smsPhoneFmt(p) { const s = String(p || ''); return s.length === 12 ? `+${s.slice(0, 3)} ${s.slice(3, 5)} ${s.slice(5, 8)} ${s.slice(8, 10)} ${s.slice(10)}` : s; }
function smsNormPhone(raw) { let p = String(raw || '').replace(/\D/g, ''); if (p.startsWith('00')) p = p.slice(2); if (p.length === 9) p = '992' + p; if (p.startsWith('0') && p.length === 10) p = '992' + p.slice(1); return /^992\d{9}$/.test(p) ? p : null; }
function smsDate(d) { return d ? d.split('-').reverse().join('.') : '—'; }
function smsToast(t) { if (typeof toastMsg === 'function') toastMsg(t); else alert(t); }
function smsModal(html, wide) {
  const bg = document.createElement('div'); bg.className = 'sms-mbg';
  bg.innerHTML = `<div class="sms-m ${wide ? 'wide' : ''}">${html}</div>`;
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
  bg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => bg.remove()));
  return bg;
}
const smsPrice = () => Number((SMS.status && SMS.status.settings && SMS.status.settings.price_per_part) || 0.1);

// ══════════ ВХОД В РАЗДЕЛ ══════════
async function renderSms(force) {
  const root = $('smsBody'); if (!root) return;
  if (!SMS._init || force) {
    SMS._init = true;
    root.innerHTML = '<div class="loading">⏳ Загрузка…</div>';
    try {
      const [st, tp] = await Promise.all([smsApi('status'), smsApi('templates')]);
      SMS.status = st; SMS.templates = tp.templates || [];
    } catch (e) { root.innerHTML = `<div class="sms-card"><b>Не удалось загрузить раздел:</b> ${esc(e.message)}</div>`; return; }
  }
  smsDraw();
}
function smsDraw() {
  const root = $('smsBody'); const st = SMS.status || {};
  root.innerHTML = `<div class="sms-wrap">
    <div class="sms-status">
      <span><span class="sms-dot ${st.configured ? '' : 'off'}"></span>OsonSMS: <b>${st.configured ? 'подключён' : 'не настроен'}</b></span>
      ${st.sender ? `<span>· отправитель <b>${esc(st.sender)}</b></span>` : ''}
      <span>· баланс <b>${st.balance != null ? fmtNum(st.balance) + ' с.' : '—'}</b></span>
      ${st.queued ? `<span>· в очереди: <b>${st.queued}</b></span>` : ''}
      ${st.quiet ? `<span>· сейчас тихие часы — отправка с ${st.settings.quiet_from}:00 до ${st.settings.quiet_to}:00</span>` : ''}
      <span class="sp"></span>
      <div class="sms-tabs">
        ${[['send', '✉ Рассылка'], ['templates', '🗂 Шаблоны'], ['auto', '⚡ Автоматические'], ['history', '🕘 История'], ['settings', '⚙ Настройки']]
          .map(([k, l]) => `<button class="sms-tab ${SMS.tab === k ? 'on' : ''}" data-smstab="${k}">${l}</button>`).join('')}
      </div>
    </div>
    <div id="smsTabBody"></div>
  </div>`;
  root.querySelectorAll('[data-smstab]').forEach(b => b.addEventListener('click', () => { SMS.tab = b.dataset.smstab; smsDraw(); }));
  if (SMS.tab === 'send') smsDrawSend();
  else if (SMS.tab === 'templates') smsDrawTemplates();
  else if (SMS.tab === 'auto') smsDrawAuto();
  else if (SMS.tab === 'history') smsDrawHistory();
  else smsDrawSettings();
}

// ══════════ РАССЫЛКА ══════════
function smsDrawSend() {
  const b = $('smsTabBody');
  const isManual = SMS.type === 'individual';
  b.innerHTML = `
  <div class="sms-card" style="margin-bottom:16px">
    <h3>Создание рассылки<span class="sp"></span><span class="sms-cnt">Шаг ${SMS.step} из 4</span></h3>
    <div class="sms-steps">${['Аудитория', 'Сообщение', 'Проверка', 'Отправка'].map((s, i) => `<div class="sms-step ${SMS.step >= i + 1 ? 'on' : ''}"><i>${i + 1}</i>${s}</div>`).join('')}</div>
    <div class="sms-types">${SMS_TYPES.map(t => `<button class="sms-type ${SMS.type === t.id ? 'on' : ''}" data-smstype="${t.id}"><span class="ic">${t.ic}</span><span><b>${t.t}</b><small>${t.s}</small></span></button>`).join('')}</div>
  </div>
  <div class="sms-grid">
    <div class="sms-card" id="smsAud"></div>
    <div class="sms-card" id="smsList"></div>
    <div class="sms-card sms-msg" id="smsMsg"></div>
  </div>`;
  b.querySelectorAll('[data-smstype]').forEach(x => x.addEventListener('click', () => smsSetType(x.dataset.smstype)));
  smsDrawAud(); smsDrawList(); smsDrawMsg();
  if (!isManual && !SMS.rows.length && !SMS.loading && !SMS._autoloaded) { SMS._autoloaded = true; smsFind(); }
}
function smsSetType(id) {
  const t = SMS_TYPES.find(x => x.id === id); SMS.type = id;
  if (t.src !== 'manual') { SMS.src = t.src; }
  SMS.filters = { branch: 'all', age: 'all', period: 'any', months_ago: '', points_min: '', points_max: '', q: '', skip_recent: id !== 'individual', exclude_branch: '' };
  if (id === 'diag') { SMS.filters.age = 'child'; SMS.filters.months_ago = '4'; SMS.filters.exclude_branch = 'Сиёма'; }
  if (t.tpl) { const tp = SMS.templates.find(x => x.id === t.tpl); if (tp) { SMS.tplId = tp.id; SMS.text = tp.text; } }
  SMS.rows = []; SMS.sel = new Set(); SMS.page = 1; SMS.step = 1;
  smsDrawSend();
  if (id !== 'individual') smsFind();
}
function smsDrawAud() {
  const el = $('smsAud'); const f = SMS.filters;
  if (SMS.type === 'individual') {
    el.innerHTML = `<h3>Номера получателей</h3>
      <div class="sms-sub">Вставьте номера — каждый с новой строки или через запятую. Можно с именем: «+992 90 123 45 67 Зарина».</div>
      <textarea class="sms-ta" id="smsManual" style="min-height:220px" placeholder="+992 90 123 45 67 Зарина&#10;931234567">${esc(SMS.manual)}</textarea>
      <div class="sms-bar"><button class="sms-btn" id="smsXls">⬆ Загрузить из Excel</button><span class="sp"></span><button class="sms-btn pri" id="smsManualOk">Добавить в список</button></div>`;
    $('smsManualOk').onclick = () => { SMS.manual = $('smsManual').value; smsParseManual(); };
    $('smsXls').onclick = smsExcel;
    return;
  }
  const seg = [['all', 'Клиенты'], ['diag', 'После диагностики'], ['cards', 'Дисконтные карты']];
  const isDiag = SMS.src === 'diag', isCards = SMS.src === 'cards' || SMS.src === 'points';
  el.innerHTML = `<h3>Выбор аудитории</h3>
    <div class="sms-seg">${seg.map(([k, l]) => `<button class="${(SMS.src === k || (k === 'cards' && SMS.src === 'points')) ? 'on' : ''}" data-smssrc="${k}">${l}</button>`).join('')}</div>
    <h3 style="font-size:14px">Фильтры<span class="sp"></span><button class="sms-link" id="smsReset">Сбросить</button></h3>
    <div class="sms-f">
      <div><label>Филиал</label><select class="sms-sel" id="sfBranch"><option value="all">Все филиалы</option>${SMS_BRANCHES.map(x => `<option ${f.branch === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div><label>Возраст</label><select class="sms-sel" id="sfAge" ${isCards ? 'disabled' : ''}><option value="all">Все возрастные группы</option><option value="child" ${f.age === 'child' ? 'selected' : ''}>Дети</option><option value="adult" ${f.age === 'adult' ? 'selected' : ''}>Взрослые</option></select></div>
      <div><label>${isDiag ? 'Последняя диагностика' : 'Последняя покупка / визит'}</label><select class="sms-sel" id="sfPeriod">
        ${[['any', 'Любая дата'], ['30', 'За 30 дней'], ['90', 'За 3 месяца'], ['180', 'За 6 месяцев'], ['365', 'За год'], ['old180', 'Давно (более 6 мес.)'], ['custom', 'Свой период…']].map(([k, l]) => `<option value="${k}" ${f.period === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select></div>
      <div><label>Месяцев после диагностики</label><select class="sms-sel" id="sfMonths" ${isCards ? 'disabled' : ''}><option value="">—</option>${[1, 2, 3, 4, 5, 6, 9, 12].map(m => `<option ${String(f.months_ago) === String(m) ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      <div id="sfCustom" class="full" style="display:${f.period === 'custom' ? 'grid' : 'none'};grid-template-columns:1fr 1fr;gap:10px">
        <div><label>С</label><input type="date" class="sms-in" id="sfFrom" value="${esc(f.last_from || '')}"></div>
        <div><label>По</label><input type="date" class="sms-in" id="sfTo" value="${esc(f.last_to || '')}"></div>
      </div>
      <div><label>Баллы на карте от</label><input class="sms-in" id="sfPmin" type="number" min="0" value="${esc(f.points_min)}" ${isDiag ? 'disabled' : ''} placeholder="—"></div>
      <div><label>до</label><input class="sms-in" id="sfPmax" type="number" min="0" value="${esc(f.points_max)}" ${isDiag ? 'disabled' : ''} placeholder="—"></div>
      <div class="full"><label>Исключить филиал</label><select class="sms-sel" id="sfExcl"><option value="">Не исключать</option>${SMS_BRANCHES.map(x => `<option ${f.exclude_branch === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="full"><label>Поиск по имени / телефону</label><input class="sms-in" id="sfQ" value="${esc(f.q)}" placeholder="Например: Зарина или 901234"></div>
      <label class="sms-chk full" style="font-weight:400"><input type="checkbox" id="sfRecent" ${f.skip_recent ? 'checked' : ''}> Не писать тем, кому уже отправляли за ${(SMS.status && SMS.status.settings && SMS.status.settings.freq_cap_days) || 3} дн.</label>
      <div class="full"><label>Наличие телефона</label><select class="sms-sel" disabled><option>Только с телефоном</option></select></div>
    </div>
    <button class="sms-btn pri big" id="smsFind" style="margin-top:14px">🔍 Найти клиентов</button>
    ${SMS.info ? `<div class="sms-note">В базе: карт с телефоном — <b>${SMS.info.counts.cards}</b>, пациентов диагностик — <b>${SMS.info.counts.diag}</b> (детей ${SMS.info.counts.diag_child}).${SMS.info.optout ? ` Отписались: ${SMS.info.optout}.` : ''}${SMS.info.capped ? ` Пропущено (писали недавно): ${SMS.info.capped}.` : ''}</div>` : ''}`;
  el.querySelectorAll('[data-smssrc]').forEach(x => x.addEventListener('click', () => { SMS.src = x.dataset.smssrc; smsReadFilters(); smsDrawAud(); smsFind(); }));
  $('sfPeriod').onchange = () => { $('sfCustom').style.display = $('sfPeriod').value === 'custom' ? 'grid' : 'none'; };
  $('smsReset').onclick = () => { SMS.filters = { branch: 'all', age: 'all', period: 'any', months_ago: '', points_min: '', points_max: '', q: '', skip_recent: true, exclude_branch: '' }; smsDrawAud(); smsFind(); };
  $('smsFind').onclick = () => { smsReadFilters(); smsFind(); };
  $('sfQ').addEventListener('keydown', e => { if (e.key === 'Enter') { smsReadFilters(); smsFind(); } });
}
function smsReadFilters() {
  const g = id => ($(id) ? $(id).value : '');
  if (!$('sfBranch')) return;
  Object.assign(SMS.filters, { branch: g('sfBranch'), age: g('sfAge') || 'all', period: g('sfPeriod'), months_ago: g('sfMonths'), points_min: g('sfPmin'), points_max: g('sfPmax'),
    exclude_branch: g('sfExcl'), q: g('sfQ').trim(), skip_recent: $('sfRecent').checked, last_from: g('sfFrom'), last_to: g('sfTo') });
}
function smsFilterPayload() {
  const f = SMS.filters, today = dushToday(); const p = { source: SMS.src, branch: f.branch, age: f.age, q: f.q || undefined, skip_recent: !!f.skip_recent, exclude_branch: f.exclude_branch || undefined };
  if (f.months_ago) p.months_ago = Number(f.months_ago);
  if (f.points_min !== '') p.points_min = Number(f.points_min);
  if (f.points_max !== '') p.points_max = Number(f.points_max);
  const back = n => new Date(Date.parse(today + 'T00:00:00Z') - n * 864e5).toISOString().slice(0, 10);
  if (/^\d+$/.test(f.period)) p.last_from = back(Number(f.period));
  if (f.period === 'old180') p.last_to = back(180);
  if (f.period === 'custom') { if (f.last_from) p.last_from = f.last_from; if (f.last_to) p.last_to = f.last_to; }
  return p;
}
async function smsFind() {
  SMS.loading = true; smsDrawList();
  try {
    const d = await smsApi('audience', { filters: smsFilterPayload(), all: true });
    SMS.rows = d.rows || []; SMS.total = d.total; SMS.info = d; SMS.sel = new Set(SMS.rows.map(r => r.phone)); SMS.page = 1;
    if (SMS.step < 2 && SMS.rows.length) SMS.step = 2;
  } catch (e) { smsToast('Ошибка: ' + e.message); SMS.rows = []; }
  SMS.loading = false;
  if (SMS.tab === 'send') { smsDrawAud(); smsDrawList(); smsDrawMsg(); smsDrawStepper(); }
}
function smsDrawStepper() { document.querySelectorAll('.sms-step').forEach((s, i) => s.classList.toggle('on', SMS.step >= i + 1)); const c = document.querySelector('#smsTabBody .sms-card h3 .sms-cnt'); if (c) c.textContent = `Шаг ${SMS.step} из 4`; }
function smsParseManual() {
  const lines = String(SMS.manual || '').split(/[\n;,]+/).map(s => s.trim()).filter(Boolean);
  const out = new Map();
  lines.forEach(l => { const m = l.match(/(\+?[\d\s()-]{9,})(.*)$/); if (!m) return; const p = smsNormPhone(m[1]); if (!p) return; const nm = (m[2] || '').trim(); out.set(p, { phone: p, name: nm.split(/\s+/)[0] || '', full: nm, src: ['manual'] }); });
  SMS.rows = Array.from(out.values()); SMS.sel = new Set(SMS.rows.map(r => r.phone)); SMS.page = 1; SMS.step = SMS.rows.length ? 2 : 1;
  smsDrawList(); smsDrawMsg(); smsDrawStepper();
  smsToast(`Распознано номеров: ${SMS.rows.length} из ${lines.length}`);
}
async function smsExcel() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv,.txt';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    let text = '';
    if (/\.(csv|txt)$/i.test(f.name)) text = await f.text();
    else {
      if (!window.XLSX) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); }).catch(() => {});
      if (!window.XLSX) { smsToast('Не удалось загрузить модуль Excel'); return; }
      const wb = XLSX.read(await f.arrayBuffer()); const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
      text = rows.map(r => { const cells = r.map(x => String(x || '').trim()); const ph = cells.find(c => smsNormPhone(c)); const nm = cells.find(c => c && !smsNormPhone(c) && /[A-Za-zА-Яа-яЁё]/.test(c)); return ph ? `${ph} ${nm || ''}` : ''; }).filter(Boolean).join('\n');
    }
    if (SMS.type !== 'individual') { SMS.type = 'individual'; smsDrawSend(); }
    SMS.manual = (SMS.manual ? SMS.manual + '\n' : '') + text; if ($('smsManual')) $('smsManual').value = SMS.manual; smsParseManual();
  };
  inp.click();
}
function smsDrawList() {
  const el = $('smsList'); if (!el) return;
  const rows = SMS.rows, per = SMS.per, pages = Math.max(1, Math.ceil(rows.length / per));
  if (SMS.page > pages) SMS.page = pages;
  const slice = rows.slice((SMS.page - 1) * per, SMS.page * per);
  const allOn = rows.length && rows.every(r => SMS.sel.has(r.phone));
  const pageOn = slice.length && slice.every(r => SMS.sel.has(r.phone));
  const pgBtns = []; const P = SMS.page;
  for (let i = 1; i <= pages; i++) { if (i === 1 || i === pages || Math.abs(i - P) <= 2) pgBtns.push(i); else if (pgBtns[pgBtns.length - 1] !== '…') pgBtns.push('…'); }
  const srcB = r => (r.src || []).map(s => s === 'cards' ? '<span class="sms-badge c">карта</span>' : s === 'diag' ? `<span class="sms-badge d">диагн.${r.child ? ' · ребёнок' : ''}</span>` : '<span class="sms-badge">вручную</span>').join('');
  el.innerHTML = `<h3>Список клиентов<span class="sp"></span>
      <button class="sms-btn" id="smsXls2">⬆ Загрузить из Excel</button>
      <button class="sms-btn" id="smsAll">${allOn ? '☐ Снять все' : '☑ Выбрать все'}</button></h3>
    <div class="sms-sub">Выбрано: <b>${SMS.sel.size}</b> из ${rows.length} клиентов</div>
    ${SMS.loading ? '<div class="sms-empty">⏳ Собираю клиентов из карт и DocSales2…</div>' : !rows.length ? '<div class="sms-empty">Нет клиентов по выбранным фильтрам</div>' : `
    <div class="sms-tblw"><table class="sms-tbl"><thead><tr>
      <th style="width:30px"><input type="checkbox" id="smsPageChk" ${pageOn ? 'checked' : ''}></th><th>Клиент</th><th>Телефон</th><th>${SMS.src === 'diag' ? 'Диагностика' : 'Последняя покупка'}</th><th>Филиал</th>${SMS.src === 'diag' ? '' : '<th>Баллы</th>'}</tr></thead><tbody>
      ${slice.map(r => `<tr><td><input type="checkbox" data-ph="${r.phone}" ${SMS.sel.has(r.phone) ? 'checked' : ''}></td>
        <td>${esc(r.full || r.name || '—')}<div>${srcB(r)}</div></td><td class="ph">${smsPhoneFmt(r.phone)}</td>
        <td>${smsDate(r.last)}</td><td>${esc(r.branch || '—')}</td>${SMS.src === 'diag' ? '' : `<td>${r.points != null ? r.points : '—'}</td>`}</tr>`).join('')}
    </tbody></table></div>
    <div class="sms-pg"><span>Показано ${(SMS.page - 1) * per + 1}–${Math.min(SMS.page * per, rows.length)} из ${rows.length}</span><span class="sp"></span>
      <button data-pg="${Math.max(1, P - 1)}">‹</button>${pgBtns.map(x => x === '…' ? '<span>…</span>' : `<button data-pg="${x}" class="${x === P ? 'on' : ''}">${x}</button>`).join('')}<button data-pg="${Math.min(pages, P + 1)}">›</button>
      <span style="margin-left:10px">Показывать по</span><select class="sms-sel" id="smsPer" style="width:auto;padding:5px 8px">${[8, 20, 50, 100].map(n => `<option ${n === per ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`}`;
  $('smsXls2').onclick = smsExcel;
  $('smsAll').onclick = () => { if (allOn) SMS.sel.clear(); else rows.forEach(r => SMS.sel.add(r.phone)); smsDrawList(); smsDrawMsg(); };
  if ($('smsPageChk')) $('smsPageChk').onchange = e => { slice.forEach(r => e.target.checked ? SMS.sel.add(r.phone) : SMS.sel.delete(r.phone)); smsDrawList(); smsDrawMsg(); };
  el.querySelectorAll('[data-ph]').forEach(c => c.addEventListener('change', () => { c.checked ? SMS.sel.add(c.dataset.ph) : SMS.sel.delete(c.dataset.ph); const s = el.querySelector('.sms-sub b'); if (s) s.textContent = SMS.sel.size; smsDrawMsgStats(); }));
  el.querySelectorAll('[data-pg]').forEach(x => x.addEventListener('click', () => { SMS.page = Number(x.dataset.pg); smsDrawList(); }));
  if ($('smsPer')) $('smsPer').onchange = e => { SMS.per = Number(e.target.value); SMS.page = 1; smsDrawList(); };
}
function smsSelected() { return SMS.rows.filter(r => SMS.sel.has(r.phone)); }
function smsDrawMsg() {
  const el = $('smsMsg'); if (!el) return;
  const tpls = SMS.templates;
  el.innerHTML = `<h3>Сообщение<span class="sp"></span><button class="sms-btn" id="smsToTpl">🗂 Шаблоны</button></h3>
    <label class="sms-f" style="display:block"><label>Выберите шаблон</label></label>
    <select class="sms-sel" id="smsTplSel"><option value="">— без шаблона —</option>${tpls.map(t => `<option value="${t.id}" ${SMS.tplId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
    <textarea class="sms-ta" id="smsText" style="margin-top:10px" placeholder="Текст SMS. Переменные: {Имя}, {Баллы}, {Осталось}…">${esc(SMS.text)}</textarea>
    <div class="sms-bar">
      <div class="sms-dd"><button class="sms-btn" id="smsVarBtn">{ } Переменная ▾</button></div>
      <button class="sms-btn" id="smsAiBtn">✨ ИИ-генератор</button>
      <span class="sp"></span><span class="sms-cnt" id="smsCnt"></span>
    </div>
    <label class="sms-chk" style="margin-top:8px"><input type="checkbox" id="smsLong" ${SMS.long ? 'checked' : ''}> Длинное сообщение (несколько SMS — дороже)</label>
    <div id="smsLenNote"></div>
    <div id="smsExtra"></div>
    <div class="sms-pv">
      <div><div class="sms-pvh">Предпросмотр сообщения</div><div class="sms-bubble" id="smsBubble"></div><div class="sms-cnt" id="smsBubbleNm" style="margin-top:4px"></div></div>
      <div class="sms-kv" id="smsStats"></div>
    </div>
    <div class="sms-f" style="margin-top:12px">
      <div class="full"><label>Название рассылки</label><input class="sms-in" id="smsName" value="${esc(SMS.name)}" placeholder="Например: Повторная диагностика — октябрь"></div>
      <div class="full"><label>Когда отправить</label><input class="sms-in" type="datetime-local" id="smsWhen" value="${esc(SMS.schedule)}"><div class="sms-cnt" style="margin-top:4px">Пусто — сразу (в тихие часы — утром с ${(SMS.status && SMS.status.settings && SMS.status.settings.quiet_from) || 9}:00)</div></div>
    </div>
    <button class="sms-btn pri big" id="smsSend" style="margin-top:14px">➤ Отправить SMS</button>`;
  const ta = $('smsText');
  ta.addEventListener('input', () => { SMS.text = ta.value; if (SMS.step < 2) SMS.step = 2; smsDrawMsgStats(); });
  $('smsTplSel').onchange = e => { SMS.tplId = e.target.value; const t = tpls.find(x => x.id === SMS.tplId); if (t) { SMS.text = t.text; ta.value = t.text; } smsDrawMsgStats(); };
  $('smsLong').onchange = e => { SMS.long = e.target.checked; smsDrawMsgStats(); };
  $('smsName').oninput = e => { SMS.name = e.target.value; };
  $('smsWhen').onchange = e => { SMS.schedule = e.target.value; };
  $('smsToTpl').onclick = () => { SMS.tab = 'templates'; smsDraw(); };
  $('smsVarBtn').onclick = (e) => smsVarMenu(e.currentTarget, ta, () => { SMS.text = ta.value; smsDrawMsgStats(); });
  $('smsAiBtn').onclick = () => smsAiModal(txt => { SMS.text = txt; ta.value = txt; smsDrawMsgStats(); });
  $('smsSend').onclick = smsConfirmSend;
  smsDrawMsgStats();
}
function smsVarMenu(anchor, ta, after) {
  document.querySelectorAll('.sms-ddm').forEach(x => x.remove());
  const m = document.createElement('div'); m.className = 'sms-ddm';
  m.innerHTML = SMS_VARS.map(([k, d]) => `<button data-v="${k}">{${k}} <small>— ${d}</small></button>`).join('');
  anchor.parentElement.appendChild(m);
  m.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => {
    const v = `{${b.dataset.v}}`; const s = ta.selectionStart || ta.value.length;
    ta.value = ta.value.slice(0, s) + v + ta.value.slice(ta.selectionEnd || s); ta.focus(); m.remove(); after && after();
  }));
  setTimeout(() => document.addEventListener('click', function h(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', h); } }), 0);
}
function smsDrawMsgStats() {
  const sel = smsSelected(); const sample = sel[0] || SMS.rows[0] || { name: 'Зарина', points: 60, branch: 'Айни' };
  const usesGoods = /\{Товары\}/.test(SMS.text), usesDate = /\{Дата\}/.test(SMS.text), usesDisc = /\{Скидка\}/.test(SMS.text);
  const ex = $('smsExtra');
  if (ex) {
    const need = usesGoods || usesDate || usesDisc;
    if (need && !ex.dataset.on) {
      ex.dataset.on = '1';
      ex.innerHTML = `<div class="sms-f" style="margin-top:10px">${usesGoods ? `<div class="full"><label>{Товары} — что поступило</label><input class="sms-in" id="smsGoods" value="${esc(SMS.goods || '')}" placeholder="Forelli, Comformini"></div>` : ''}${usesDate ? `<div><label>{Дата}</label><input class="sms-in" id="smsDateV" value="${esc(SMS.date || '')}" placeholder="31.10"></div>` : ''}${usesDisc ? `<div><label>{Скидка}, %</label><input class="sms-in" id="smsDisc" value="${esc(SMS.discount || '')}" placeholder="10"></div>` : ''}</div>`;
      ['smsGoods', 'smsDateV', 'smsDisc'].forEach(id => { const i = $(id); if (i) i.oninput = () => { SMS[id === 'smsGoods' ? 'goods' : id === 'smsDateV' ? 'date' : 'discount'] = i.value; smsDrawMsgStats(); }; });
    } else if (!need) { ex.innerHTML = ''; delete ex.dataset.on; }
  }
  const t = smsRender(SMS.text, sample); const inf = smsInfo(t);
  const cnt = $('smsCnt'); if (cnt) { cnt.textContent = `${inf.chars} / ${inf.parts} SMS`; cnt.className = 'sms-cnt' + (inf.parts > 1 ? (SMS.long ? ' warn' : ' bad') : ''); }
  const note = $('smsLenNote');
  if (note) {
    const lim = inf.unicode ? 70 : 160;
    note.innerHTML = !SMS.text ? '' : inf.parts > 1
      ? `<div class="sms-note ${SMS.long ? 'warn' : 'bad'}">${SMS.long ? `Длинное: ${inf.parts} SMS на человека — стоимость ×${inf.parts}.` : `Длиннее 1 SMS (${inf.chars} из ${lim}). Сократите до ${lim} символов или включите «Длинное сообщение».`}</div>`
      : `<div class="sms-note">1 SMS: ${inf.unicode ? 'кириллица — до 70 символов' : 'латиница — до 160 символов'}. Осталось ${lim - inf.chars}.</div>`;
  }
  const bub = $('smsBubble'); if (bub) bub.textContent = t || '…';
  const nm = $('smsBubbleNm'); if (nm) nm.textContent = sel[0] ? `для: ${sel[0].full || sel[0].name || smsPhoneFmt(sel[0].phone)}` : '';
  const parts = sel.reduce((a, r) => a + smsInfo(smsRender(SMS.text, r)).parts, 0);
  const cost = parts * smsPrice(); const bal = SMS.status && SMS.status.balance;
  const stEl = $('smsStats');
  if (stEl) stEl.innerHTML = `Получателей<b>👥 ${sel.length}</b>Стоимость<b>${fmtNum(cost)} с.</b><small>${parts} SMS × ${fmtNum(smsPrice())} с.</small>${bal != null ? `Баланс OsonSMS<b style="font-size:16px;color:${bal < cost ? 'var(--red)' : 'var(--tx)'}">${fmtNum(bal)} с.</b>` : ''}`;
  const btn = $('smsSend'); if (btn) btn.disabled = !sel.length || !SMS.text.trim();
}
function smsConfirmSend() {
  const sel = smsSelected(); if (!sel.length) return smsToast('Выберите получателей');
  if (!SMS.text.trim()) return smsToast('Введите текст сообщения');
  const msgs = sel.map(r => ({ r, t: smsRender(SMS.text, r) }));
  const long = msgs.filter(m => smsInfo(m.t).parts > 1);
  if (long.length && !SMS.long) return smsToast(`У ${long.length} получателей сообщение длиннее 1 SMS. Сократите текст или включите «Длинное сообщение».`);
  const empty = msgs.filter(m => /\{[А-Яа-я]+\}/.test(m.t));
  const parts = msgs.reduce((a, m) => a + smsInfo(m.t).parts, 0); const cost = parts * smsPrice(); const bal = SMS.status && SMS.status.balance;
  SMS.step = 3; smsDrawStepper();
  const when = SMS.schedule ? new Date(SMS.schedule) : null;
  const md = smsModal(`<h3>Проверка перед отправкой<span class="sp"></span><button class="sms-x" data-close>×</button></h3>
    <div class="sms-sum"><div>Получателей<b>${sel.length}</b></div><div>SMS всего<b>${parts}</b></div><div>Стоимость<b>${fmtNum(cost)} с.</b></div><div>Баланс<b style="color:${bal != null && bal < cost ? 'var(--red)' : 'inherit'}">${bal != null ? fmtNum(bal) + ' с.' : '—'}</b></div></div>
    ${bal != null && bal < cost ? '<div class="sms-note bad">На балансе OsonSMS не хватает денег — часть сообщений не уйдёт, рассылка встанет на паузу.</div>' : ''}
    ${empty.length ? `<div class="sms-note bad">В ${empty.length} сообщениях осталась незаполненная переменная — проверьте текст.</div>` : ''}
    <div class="sms-note">Тип: <b>${esc((SMS_TYPES.find(t => t.id === SMS.type) || {}).t)}</b> · ${when ? `отправка <b>${when.toLocaleString('ru-RU')}</b>` : 'отправка <b>сразу</b>'} · отправитель <b>${esc((SMS.status && SMS.status.sender) || '—')}</b></div>
    <div class="sms-pvh" style="margin-top:12px">Примеры сообщений</div>
    ${msgs.slice(0, 3).map(m => `<div class="sms-var"><div><b>${smsPhoneFmt(m.r.phone)}</b> ${esc(m.r.full || m.r.name || '')}<br>${esc(m.t)}</div><span class="sms-cnt">${smsInfo(m.t).chars} симв.</span></div>`).join('')}
    <label class="sms-chk" style="margin-top:10px"><input type="checkbox" id="smsOkChk"> Я проверил текст и список — отправить ${sel.length} клиентам</label>
    <div class="sms-mft"><button class="sms-btn" data-close>Отмена</button><button class="sms-btn" id="smsDraftBtn">Сохранить черновик</button><button class="sms-btn pri" id="smsGo" disabled>➤ Отправить</button></div>`);
  md.querySelector('#smsOkChk').onchange = e => { md.querySelector('#smsGo').disabled = !e.target.checked; };
  const go = async (draft) => {
    md.querySelectorAll('button').forEach(b => b.disabled = true);
    md.querySelector('#smsGo').textContent = draft ? 'Сохраняю…' : 'Отправляю…';
    try {
      const recipients = sel.map(r => ({ phone: r.phone, name: r.name, full: r.full, points: r.points, branch: r.branch }));
      const d = await smsApi('campaign-create', { confirm: true, draft: !!draft, name: SMS.name || (SMS_TYPES.find(t => t.id === SMS.type) || {}).t, type: SMS.type, text: SMS.text, long: SMS.long,
        recipients, by: state.user, scheduled_at: when ? when.toISOString() : null, meta: { goods: SMS.goods || '', date: SMS.date || '', discount: SMS.discount || '' } });
      md.remove(); SMS.step = 4; smsDrawStepper();
      const c = d.campaign;
      smsToast(draft ? 'Черновик сохранён' : `Рассылка создана: отправлено ${c.ok} из ${c.total}${c.queued ? `, в очереди ${c.queued}` : ''}`);
      SMS.tab = 'history'; smsDraw(); smsOpenCampaign(c.id);
    } catch (e) { smsToast('Ошибка: ' + e.message); md.querySelectorAll('button').forEach(b => b.disabled = false); md.querySelector('#smsGo').textContent = '➤ Отправить'; }
  };
  md.querySelector('#smsGo').onclick = () => go(false);
  md.querySelector('#smsDraftBtn').onclick = () => go(true);
}

// ══════════ ИИ-ГЕНЕРАТОР ══════════
function smsAiModal(onPick) {
  const md = smsModal(`<h3>✨ ИИ-генератор сообщения<span class="sp"></span><button class="sms-x" data-close>×</button></h3>
    <div class="sms-f">
      <div class="full"><label>Тема</label><select class="sms-sel" id="aiTopic">${SMS_AI_TOPICS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      <div class="full"><label>Детали (необязательно)</label><textarea class="sms-ta" id="aiDet" style="min-height:70px" placeholder="Например: скидка 15% на детскую обувь до 31.10, новые модели Comformini"></textarea></div>
      <div><label>Длина</label><select class="sms-sel" id="aiLen"><option value="short">1 SMS (до 70 символов)</option><option value="long">2 SMS (до 134 символов)</option></select></div>
      <div><label>Язык</label><select class="sms-sel" id="aiLang"><option value="ru">Русский</option><option value="tj">Таджикский</option></select></div>
      <div class="full"><label>Тон</label><select class="sms-sel" id="aiTone"><option value="">Обычный, вежливый</option><option value="тёплый, заботливый">Тёплый, заботливый</option><option value="праздничный">Праздничный</option><option value="деловой, коротко">Деловой, коротко</option></select></div>
    </div>
    <div class="sms-mft"><button class="sms-btn pri" id="aiGo">✨ Сгенерировать 3 варианта</button></div>
    <div id="aiOut"></div>`);
  md.querySelector('#aiGo').onclick = async () => {
    const out = md.querySelector('#aiOut'); const btn = md.querySelector('#aiGo'); btn.disabled = true; out.innerHTML = '<div class="sms-empty">⏳ Пишу варианты…</div>';
    try {
      const d = await smsApi('ai-generate', { topic: md.querySelector('#aiTopic').value, details: md.querySelector('#aiDet').value, length: md.querySelector('#aiLen').value, lang: md.querySelector('#aiLang').value, tone: md.querySelector('#aiTone').value });
      out.innerHTML = '<div class="sms-pvh" style="margin-top:12px">Выберите вариант</div>' + (d.variants || []).map((v, i) => `<div class="sms-var"><div>${esc(v.text)}<div class="sms-cnt ${v.parts > 1 ? 'warn' : ''}">${v.chars} симв. · ${v.parts} SMS</div></div><button class="sms-btn pri" data-pick="${i}">Использовать</button></div>`).join('');
      out.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => { onPick(d.variants[Number(b.dataset.pick)].text); md.remove(); }));
    } catch (e) { out.innerHTML = `<div class="sms-note bad">${esc(e.message)}</div>`; }
    btn.disabled = false;
  };
}

// ══════════ ШАБЛОНЫ ══════════
function smsDrawTemplates() {
  const b = $('smsTabBody');
  const list = SMS.templates.filter(t => SMS.tplCat === 'all' || t.cat === SMS.tplCat);
  if (!SMS.tplEdit) SMS.tplEdit = list[0] ? { ...list[0] } : { id: '', cat: 'general', name: '', hint: '', text: '' };
  const e = SMS.tplEdit;
  b.innerHTML = `<div class="sms-card"><h3>Шаблоны сообщений<span class="sp"></span><button class="sms-btn pri" id="tplNew">＋ Новый шаблон</button></h3>
    <div class="sms-tcats">${SMS_TCATS.map(([k, l]) => `<button class="${SMS.tplCat === k ? 'on' : ''}" data-tcat="${k}">${l}</button>`).join('')}</div>
    <div class="sms-tpl">
      <div>${list.length ? list.map(t => `<button class="sms-titem ${e.id === t.id ? 'on' : ''}" data-tid="${t.id}"><span class="ic">${SMS_TCAT_IC[t.cat] || '✉'}</span><span><b>${esc(t.name)}</b><small>${esc(t.hint || '')} · ${smsInfo(t.text).chars} симв.</small></span></button>`).join('') : '<div class="sms-empty">Нет шаблонов</div>'}</div>
      <div class="sms-card" style="box-shadow:none">
        <h3 style="font-size:14.5px">${e.id ? 'Редактирование шаблона' : 'Новый шаблон'}</h3>
        <div class="sms-f">
          <div class="full"><label>Название шаблона *</label><input class="sms-in" id="teName" value="${esc(e.name)}"></div>
          <div><label>Категория</label><select class="sms-sel" id="teCat">${SMS_TCATS.slice(1).map(([k, l]) => `<option value="${k}" ${e.cat === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div><label>Подпись (когда)</label><input class="sms-in" id="teHint" value="${esc(e.hint || '')}" placeholder="Через 1 месяц"></div>
          <div class="full"><label>Текст сообщения *</label><textarea class="sms-ta" id="teText">${esc(e.text)}</textarea>
            <div class="sms-bar"><div class="sms-dd"><button class="sms-btn" id="teVar">{ } Переменная ▾</button></div><button class="sms-btn" id="teAi">✨ ИИ</button><span class="sp"></span><span class="sms-cnt" id="teCnt"></span></div></div>
        </div>
        <div class="sms-note">SMS не поддерживает картинки — только текст. Чтобы показать фото, добавьте в текст короткую ссылку.</div>
        <div class="sms-mft">${e.id ? '<button class="sms-btn red" id="teDel">Удалить</button>' : ''}<button class="sms-btn" id="teUse">Использовать в рассылке</button><button class="sms-btn pri" id="teSave">Сохранить</button></div>
      </div>
    </div></div>`;
  const ta = $('teText'); const upd = () => { const i = smsInfo(smsRender(ta.value, { name: 'Зарина', points: 60, branch: 'Айни' })); $('teCnt').textContent = `${i.chars} / ${i.parts} SMS`; $('teCnt').className = 'sms-cnt' + (i.parts > 1 ? ' warn' : ''); };
  ta.oninput = upd; upd();
  b.querySelectorAll('[data-tcat]').forEach(x => x.addEventListener('click', () => { SMS.tplCat = x.dataset.tcat; SMS.tplEdit = null; smsDrawTemplates(); }));
  b.querySelectorAll('[data-tid]').forEach(x => x.addEventListener('click', () => { SMS.tplEdit = { ...SMS.templates.find(t => t.id === x.dataset.tid) }; smsDrawTemplates(); }));
  $('tplNew').onclick = () => { SMS.tplEdit = { id: '', cat: SMS.tplCat === 'all' ? 'general' : SMS.tplCat, name: '', hint: '', text: '' }; smsDrawTemplates(); };
  $('teVar').onclick = ev => smsVarMenu(ev.currentTarget, ta, upd);
  $('teAi').onclick = () => smsAiModal(t => { ta.value = t; upd(); });
  const read = () => ({ id: e.id || '', name: $('teName').value.trim(), cat: $('teCat').value, hint: $('teHint').value.trim(), text: ta.value.trim() });
  $('teSave').onclick = async () => {
    const t = read(); if (!t.name || !t.text) return smsToast('Заполните название и текст');
    try { const d = await smsApi('template-save', { template: t }); SMS.templates = d.templates; SMS.tplEdit = { ...(d.templates.find(x => x.name === t.name && x.text === t.text) || t) }; smsToast('Шаблон сохранён'); smsDrawTemplates(); }
    catch (er) { smsToast('Ошибка: ' + er.message); }
  };
  if ($('teDel')) $('teDel').onclick = async () => {
    if (!confirm('Удалить шаблон «' + e.name + '»?')) return;
    try { const d = await smsApi('template-delete', { id: e.id }); SMS.templates = d.templates; SMS.tplEdit = null; smsDrawTemplates(); } catch (er) { smsToast('Ошибка: ' + er.message); }
  };
  $('teUse').onclick = () => { const t = read(); SMS.text = t.text; SMS.tplId = e.id; SMS.tab = 'send'; smsDraw(); };
}

// ══════════ АВТОМАТИЧЕСКИЕ ══════════
async function smsDrawAuto() {
  const b = $('smsTabBody'); b.innerHTML = '<div class="loading">⏳ Загрузка правил…</div>';
  try { const d = await smsApi('rules'); SMS.rules = d.rules; SMS.rulesLast = d.lastrun; } catch (e) { b.innerHTML = `<div class="sms-card">${esc(e.message)}</div>`; return; }
  const tplOpts = id => SMS.templates.map(t => `<option value="${t.id}" ${t.id === id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  const salonsDS = ['Айни', 'СитиМолл', 'СиемаМолл', 'Баракат'];
  const salonLbl = { 'Айни': 'Айни', 'СитиМолл': 'Сити-Молл', 'СиемаМолл': 'Сиёма Молл', 'Баракат': 'Баракат/Худжанд' };
  b.innerHTML = `<div class="sms-note" style="margin-bottom:14px">Автоправила проверяются каждый день после 11:00 (по Ташкенту) и отправляют SMS в рабочее время. Один и тот же клиент по одному правилу повторно не получает сообщение.${SMS.rulesLast ? ` Последний запуск: <b>${smsDate(SMS.rulesLast)}</b>.` : ''}</div>
  <div class="sms-rules">${SMS.rules.map(r => `<div class="sms-card sms-rule" data-rule="${r.id}">
    <h4>${r.type === 'diag_followup' ? '🩺' : r.type === 'points_near' ? '💳' : '📦'} ${esc(r.name)}<span class="sp"></span><span class="sms-on ${r.enabled ? 'y' : ''}">${r.enabled ? 'ВКЛ' : 'ВЫКЛ'}</span>
      <label class="sms-sw"><input type="checkbox" data-k="enabled" ${r.enabled ? 'checked' : ''}><span></span></label></h4>
    <p>${esc(r.note || '')}</p>
    <div class="sms-f">
      ${r.type === 'diag_followup' ? `
        <div><label>Через сколько месяцев</label><input class="sms-in" type="number" min="1" max="24" data-k="months" value="${r.months}"></div>
        <div><label>Кому</label><select class="sms-sel" data-k="child_only"><option value="1" ${r.child_only ? 'selected' : ''}>Только дети</option><option value="0" ${!r.child_only ? 'selected' : ''}>Все пациенты</option></select></div>
        <div class="full"><label>Не отправлять по диагностикам в салонах</label>${salonsDS.map(s => `<label class="sms-chk" style="display:inline-flex;margin-right:12px"><input type="checkbox" data-ex="${s}" ${(r.exclude_salons || []).includes(s) ? 'checked' : ''}> ${salonLbl[s]}</label>`).join('')}</div>` : ''}
      ${r.type === 'points_near' ? `
        <div><label>Баллов от</label><input class="sms-in" type="number" data-k="min" value="${r.min}"></div>
        <div><label>до</label><input class="sms-in" type="number" data-k="max" value="${r.max}"></div>
        <div class="full"><label>Повторять не чаще, дней</label><input class="sms-in" type="number" data-k="repeat_days" value="${r.repeat_days}"></div>` : ''}
      ${r.type === 'new_arrival' ? `
        <div><label>Режим</label><select class="sms-sel" data-k="mode"><option value="draft" ${r.mode !== 'auto' ? 'selected' : ''}>Черновик — отправлю сам</option><option value="auto" ${r.mode === 'auto' ? 'selected' : ''}>Отправлять сразу</option></select></div>
        <div><label>Поступление от, шт.</label><input class="sms-in" type="number" data-k="min_units" value="${r.min_units}"></div>
        <div class="full sms-cnt">Получатели — все клиенты с картой и телефоном. {Товары} — бренды из поступления.</div>` : ''}
      <div class="full"><label>Шаблон сообщения</label><select class="sms-sel" data-k="template_id">${tplOpts(r.template_id)}</select></div>
    </div>
    <div class="sms-mft"><button class="sms-btn" data-act="pv">👁 Кому уйдёт сейчас</button><button class="sms-btn pri" data-act="save">Сохранить</button></div>
    <div data-out></div>
  </div>`).join('')}</div>
  <div class="sms-mft" style="justify-content:flex-start"><button class="sms-btn" id="autoRun">▶ Запустить включённые правила сейчас</button></div>`;
  const readRule = card => {
    const id = card.dataset.rule; const r = { id };
    card.querySelectorAll('[data-k]').forEach(i => { const k = i.dataset.k; r[k] = i.type === 'checkbox' ? i.checked : (k === 'child_only' ? i.value === '1' : (i.type === 'number' ? Number(i.value) : i.value)); });
    const ex = card.querySelectorAll('[data-ex]'); if (ex.length) r.exclude_salons = Array.from(ex).filter(x => x.checked).map(x => x.dataset.ex);
    return r;
  };
  b.querySelectorAll('.sms-rule').forEach(card => {
    const out = card.querySelector('[data-out]');
    card.querySelector('[data-act="save"]').onclick = async () => {
      const r = readRule(card);
      if (r.enabled && !SMS.rules.find(x => x.id === r.id).enabled && !confirm('Включить автоматическую отправку SMS по правилу «' + SMS.rules.find(x => x.id === r.id).name + '»?')) return;
      try { await smsApi('rule-save', { rule: r }); smsToast('Правило сохранено'); smsDrawAuto(); } catch (e) { smsToast('Ошибка: ' + e.message); }
    };
    card.querySelector('[data-act="pv"]').onclick = async () => {
      out.innerHTML = '<div class="sms-empty">⏳ Считаю…</div>';
      try {
        const r = readRule(card); const d = await smsApi('rule-preview', { id: r.id, override: r });
        out.innerHTML = `<div class="sms-note">Сейчас получат: <b>${d.count}</b>${d.goods ? ` · товары: ${esc(d.goods)}` : ''}${d.sample ? `<div class="sms-bubble" style="margin-top:8px">${esc(d.sample)}</div><div class="sms-cnt">${d.chars} симв. · ${d.parts} SMS</div>` : ''}</div>
          ${d.rows && d.rows.length ? `<div class="sms-tblw" style="max-height:220px;margin-top:8px"><table class="sms-tbl"><tbody>${d.rows.slice(0, 30).map(x => `<tr><td>${esc(x.full || x.name || '—')}</td><td class="ph">${smsPhoneFmt(x.phone)}</td><td>${smsDate(x.last)}</td><td>${esc(x.salon || x.branch || '')}</td><td>${x.points != null ? x.points : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
      } catch (e) { out.innerHTML = `<div class="sms-note bad">${esc(e.message)}</div>`; }
    };
  });
  $('autoRun').onclick = async () => {
    if (!SMS.rules.some(r => r.enabled)) return smsToast('Нет включённых правил');
    if (!confirm('Запустить включённые автоправила сейчас? SMS уйдут клиентам (в тихие часы — утром).')) return;
    try { const d = await smsApi('auto-run', { by: state.user }); smsToast('Готово: ' + (d.rules || []).map(r => `${r.id}: ${r.count || 0}`).join(', ')); SMS.tab = 'history'; smsDraw(); } catch (e) { smsToast('Ошибка: ' + e.message); }
  };
}

// ══════════ ИСТОРИЯ ══════════
async function smsDrawHistory() {
  const b = $('smsTabBody'); const h = SMS.hist;
  if (!h.from) { h.to = dushToday(); h.from = new Date(Date.parse(h.to + 'T00:00:00Z') - 60 * 864e5).toISOString().slice(0, 10); }
  b.innerHTML = `<div class="sms-card"><h3>История рассылок<span class="sp"></span><button class="sms-btn" id="hRef">⟳ Обновить</button></h3>
    <div class="sms-hf">
      <div><label class="sms-cnt">Период с</label><input type="date" class="sms-in" id="hFrom" value="${h.from}"></div>
      <div><label class="sms-cnt">по</label><input type="date" class="sms-in" id="hTo" value="${h.to}"></div>
      <div><label class="sms-cnt">Тип рассылки</label><select class="sms-sel" id="hType"><option value="">Все типы</option>${SMS_TYPES.map(t => `<option value="${t.id}" ${h.type === t.id ? 'selected' : ''}>${t.t}</option>`).join('')}<option value="auto" ${h.type === 'auto' ? 'selected' : ''}>Автоматические</option></select></div>
      <div><label class="sms-cnt">Статус</label><select class="sms-sel" id="hSt"><option value="">Все статусы</option>${Object.entries(SMS_ST).map(([k, l]) => `<option value="${k}" ${h.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    </div><div id="hBody"><div class="loading">⏳</div></div></div>`;
  ['hFrom', 'hTo', 'hType', 'hSt'].forEach(id => $(id).onchange = () => { h.from = $('hFrom').value; h.to = $('hTo').value; h.type = $('hType').value; h.status = $('hSt').value; smsDrawHistory(); });
  $('hRef').onclick = smsDrawHistory;
  try {
    const qs = `&from=${h.from}&to=${h.to}${h.type ? '&type=' + h.type : ''}${h.status ? '&status=' + h.status : ''}`;
    const d = await smsApi('campaigns', null, qs); SMS.histRows = d.campaigns || [];
  } catch (e) { $('hBody').innerHTML = `<div class="sms-note bad">${esc(e.message)}</div>`; return; }
  const rows = SMS.histRows;
  $('hBody').innerHTML = !rows.length ? '<div class="sms-empty">Рассылок за период нет</div>' : `<div class="sms-tblw" style="max-height:640px"><table class="sms-tbl"><thead><tr><th>Дата</th><th>Название</th><th>Тип</th><th>Получатели</th><th>Статус</th><th>Стоимость</th><th>Действия</th></tr></thead><tbody>
    ${rows.map(c => `<tr><td style="white-space:nowrap">${dushTime(c.created_at, true)}</td><td>${esc(c.name)}<div class="sms-cnt">${esc((c.text || '').slice(0, 60))}${(c.text || '').length > 60 ? '…' : ''}</div></td><td>${esc(c.type_label || c.type)}</td><td>${c.total}</td>
      <td><span class="sms-st ${c.status}">${SMS_ST[c.status] || c.status}</span><div class="sms-cnt">(${c.ok} / ${c.total})${c.err ? ` · ошибок ${c.err}` : ''}${c.delivered ? ` · доставлено ${c.delivered}` : ''}</div><div class="sms-prog"><i style="width:${c.total ? Math.round(c.ok / c.total * 100) : 0}%"></i></div></td>
      <td>${fmtNum(c.cost)} с.</td><td><button class="sms-btn" data-open="${c.id}">📊 Детали</button></td></tr>`).join('')}
  </tbody></table></div>`;
  $('hBody').querySelectorAll('[data-open]').forEach(x => x.addEventListener('click', () => smsOpenCampaign(x.dataset.open)));
}
async function smsOpenCampaign(id, refresh) {
  let d; try { d = await smsApi('campaign', null, `&id=${encodeURIComponent(id)}${refresh ? '&refresh=1' : ''}`); } catch (e) { return smsToast('Ошибка: ' + e.message); }
  document.querySelectorAll('.sms-mbg').forEach(x => x.remove());
  const c = d.campaign, R = d.recipients || [];
  const sLbl = { q: 'в очереди', ok: 'отправлено', err: 'ошибка', skip: 'пропущено' };
  const md = smsModal(`<h3>${esc(c.name)}<span class="sp"></span><button class="sms-x" data-close>×</button></h3>
    <div class="sms-sum"><div>Получателей<b>${c.total}</b></div><div>Отправлено<b style="color:var(--g2)">${c.ok}</b></div><div>Ошибок<b style="color:${c.err ? 'var(--red)' : 'inherit'}">${c.err}</b></div><div>Стоимость<b>${fmtNum(c.cost)} с.</b></div></div>
    <div class="sms-note">Статус: <b class="sms-st ${c.status}">${SMS_ST[c.status] || c.status}</b> · ${esc(c.type_label)} · создал ${esc(c.created_by || '—')} ${dushTime(c.created_at, true)}${c.queued ? ` · в очереди ${c.queued}` : ''}${c.delivered ? ` · доставлено ${c.delivered}` : ''}${c.last_error ? `<br><span style="color:var(--red)">Остановлено: ${esc(c.last_error)}</span>` : ''}</div>
    <div class="sms-bubble" style="margin-top:10px">${esc(c.text)}</div>
    <div class="sms-tblw" style="max-height:340px;margin-top:12px"><table class="sms-tbl"><thead><tr><th>Телефон</th><th>Клиент</th><th>Статус</th><th>Доставка</th><th>Время</th></tr></thead><tbody>
      ${R.map(r => `<tr title="${esc(r.t)}"><td class="ph">${smsPhoneFmt(r.p)}</td><td>${esc(r.n || '')}</td><td>${sLbl[r.s] || r.s}${r.e ? `<div class="sms-cnt" style="color:var(--red)">${esc(r.e)}</div>` : ''}</td><td>${esc(r.d || '—')}</td><td>${r.at ? dushTime(r.at, true) : '—'}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="sms-mft">
      ${['queued', 'sending', 'draft', 'paused'].includes(c.status) ? '<button class="sms-btn red" id="cCancel">Отменить</button>' : ''}
      ${['draft', 'paused'].includes(c.status) ? '<button class="sms-btn pri" id="cStart">➤ Отправить</button>' : ''}
      ${['queued', 'sending'].includes(c.status) ? '<button class="sms-btn" id="cProc">▶ Дослать сейчас</button>' : ''}
      ${c.ok ? '<button class="sms-btn" id="cDlv">⟳ Обновить статусы доставки</button>' : ''}
      <button class="sms-btn" data-close>Закрыть</button></div>`, true);
  const q = s => md.querySelector(s);
  if (q('#cCancel')) q('#cCancel').onclick = async () => { if (!confirm('Отменить неотправленные сообщения?')) return; try { await smsApi('campaign-cancel', { id }); smsOpenCampaign(id); if (SMS.tab === 'history') smsDrawHistory(); } catch (e) { smsToast(e.message); } };
  if (q('#cStart')) q('#cStart').onclick = async () => { if (!confirm(`Отправить ${c.queued || c.total} SMS сейчас?`)) return; q('#cStart').disabled = true; q('#cStart').textContent = 'Отправляю…'; try { await smsApi('campaign-start', { id, confirm: true }); smsOpenCampaign(id); if (SMS.tab === 'history') smsDrawHistory(); } catch (e) { smsToast(e.message); } };
  if (q('#cProc')) q('#cProc').onclick = async () => { q('#cProc').disabled = true; q('#cProc').textContent = 'Отправляю…'; try { const r = await smsApi('process', { id }); smsToast(r.quiet ? r.note : `Отправлено ещё ${r.sent || 0}`); smsOpenCampaign(id); } catch (e) { smsToast(e.message); } };
  if (q('#cDlv')) q('#cDlv').onclick = () => smsOpenCampaign(id, true);
}

// ══════════ НАСТРОЙКИ ══════════
async function smsDrawSettings() {
  const b = $('smsTabBody'); const s = (SMS.status && SMS.status.settings) || {};
  let opt = []; try { opt = (await smsApi('optout', {})).phones || []; } catch (_) {}
  b.innerHTML = `<div class="sms-grid" style="grid-template-columns:1fr 1fr">
    <div class="sms-card"><h3>Параметры отправки</h3><div class="sms-f">
      <div><label>Цена одной SMS, с.</label><input class="sms-in" type="number" step="0.01" id="stPrice" value="${s.price_per_part}"></div>
      <div><label>Не чаще 1 SMS на номер, дней</label><input class="sms-in" type="number" id="stCap" value="${s.freq_cap_days}"></div>
      <div><label>Отправлять с, час</label><input class="sms-in" type="number" min="0" max="23" id="stQf" value="${s.quiet_from}"></div>
      <div><label>до, час</label><input class="sms-in" type="number" min="1" max="24" id="stQt" value="${s.quiet_to}"></div>
    </div>
    <div class="sms-note">Ограничения длины: кириллица — 70 символов в 1 SMS (длинное делится по 67), латиница — 160 (по 153). Эмодзи считаются за 2 символа и переводят сообщение в кириллический режим. Сверьте цену SMS с тарифом OsonSMS — от неё считается стоимость.</div>
    <div class="sms-mft"><button class="sms-btn pri" id="stSave">Сохранить</button></div></div>
    <div class="sms-card"><h3>Отписались от рассылок (${opt.length})</h3>
      <div class="sms-sub">Этим номерам SMS не отправляются ни вручную, ни автоматически.</div>
      <textarea class="sms-ta" id="stOptAdd" style="min-height:70px" placeholder="Номера через запятую или с новой строки"></textarea>
      <div class="sms-mft" style="justify-content:flex-start"><button class="sms-btn" id="stOptBtn">＋ Добавить</button></div>
      <div class="sms-tblw" style="max-height:300px;margin-top:10px"><table class="sms-tbl"><tbody>${opt.map(p => `<tr><td class="ph">${smsPhoneFmt(p)}</td><td style="text-align:right"><button class="sms-btn red" data-rm="${p}">Убрать</button></td></tr>`).join('') || '<tr><td class="sms-empty">Пусто</td></tr>'}</tbody></table></div>
    </div></div>`;
  $('stSave').onclick = async () => { try { const d = await smsApi('settings-save', { price_per_part: $('stPrice').value, freq_cap_days: $('stCap').value, quiet_from: $('stQf').value, quiet_to: $('stQt').value }); SMS.status.settings = d.settings; smsToast('Сохранено'); } catch (e) { smsToast(e.message); } };
  $('stOptBtn').onclick = async () => { const add = $('stOptAdd').value.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean); if (!add.length) return; try { await smsApi('optout', { add }); smsDrawSettings(); } catch (e) { smsToast(e.message); } };
  b.querySelectorAll('[data-rm]').forEach(x => x.addEventListener('click', async () => { try { await smsApi('optout', { remove: [x.dataset.rm] }); smsDrawSettings(); } catch (e) { smsToast(e.message); } }));
}
