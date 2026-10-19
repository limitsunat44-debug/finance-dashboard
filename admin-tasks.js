// ══════════════════════════════════════════════════════════
//  ЗАДАЧИ СОТРУДНИКОВ (v1.4.0) — backend /api/tasks
//  Авто-задачи «пополнить витрину» по планограмме, ежедневная проверка витрин,
//  ручные задачи и ИИ-генерация по статистике продаж/диагностик сотрудника, баллы, рейтинг.
//  Использует хелперы admin-rmk.js: $, esc, state, svcFetch, BARCODE_SVC_URL, BARCODE_SVC_SECRET.
// ══════════════════════════════════════════════════════════
const ATK = {
  tab: 'list', f: { wh: 'all', status: 'active', kind: '', seller: '' },
  rows: [], shops: [], emps: null, settings: null, ai: { ref: '', stats: null, drafts: [], mix: { low: 1, mid: 2, high: 1 }, focus: '', summary: '', busy: false },
  form: { title: '', desc: '', wh: '', who: '', prio: 'mid', points: '', due: '' },
};
const ATK_KIND = { restock: '🧩 Пополнить', check: '👀 Проверка', manual: '✍️ Ручная', ai: '✨ ИИ' };
const ATK_ST = { open: 'Открыта', review: 'На проверке', done: 'Выполнена', rejected: 'Отклонена', cancelled: 'Отменена', expired: 'Просрочена', resolved: 'Закрыта сама', skipped: 'Нет товара' };
const ATK_PRIO = { low: 'Низкий', mid: 'Средний', high: 'Высокий' };

async function atkApi(action, body, qs) {
  const res = await svcFetch(`${BARCODE_SVC_URL}/api/tasks?action=${action}${qs || ''}`, {
    method: body ? 'POST' : 'GET', timeoutMs: 120000, retries: body ? 0 : 1,
    headers: { 'Content-Type': 'application/json', 'X-Provision-Secret': BARCODE_SVC_SECRET },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.ok === false) throw new Error(d.error || `HTTP ${res.status}`);
  return d;
}
function atkToast(t) { if (typeof toastMsg === 'function') toastMsg(t); else alert(t); }
const atkDT = (iso) => iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const atkDay = (ymd) => ymd ? String(ymd).split('-').reverse().slice(0, 2).join('.') : '—';
function atkBy() { return (typeof state !== 'undefined' && state.user) || 'Администратор'; }

async function renderTasks(force) {
  const root = $('tasksBody'); if (!root) return;
  if (!ATK._init || force) {
    ATK._init = true;
    root.innerHTML = '<div class="loading">⏳ Загрузка…</div>';
    try {
      const [s, e] = await Promise.all([atkApi('settings'), atkApi('employees')]);
      ATK.settings = s.settings; ATK.emps = e.employees || [];
    } catch (err) { root.innerHTML = `<div class="sms-card"><b>Не удалось загрузить раздел:</b> ${esc(err.message)}</div>`; return; }
    await atkLoad(true);
  }
  atkDraw();
}
async function atkLoad(sync) {
  const f = ATK.f;
  const qs = `&wh=${encodeURIComponent(f.wh)}&status=${encodeURIComponent(f.status)}${f.kind ? '&kind=' + f.kind : ''}${f.seller ? '&seller=' + encodeURIComponent(f.seller) : ''}${sync ? '' : '&sync=0'}`;
  try { const d = await atkApi('admin-list', null, qs); ATK.rows = d.tasks || []; ATK.total = d.total || 0; if (f.wh === 'all') ATK.shops = d.shops || []; }
  catch (e) { atkToast('Ошибка: ' + e.message); }
}
function atkDraw() {
  const root = $('tasksBody'); if (!root) return;
  const rv = ATK.rows.filter(t => t.status === 'review').length;
  const tabs = [['list', 'Задачи' + (rv ? ` · ${rv} на проверке` : '')], ['new', 'Новая задача'], ['ai', '✨ ИИ-генератор'], ['rating', 'Рейтинг'], ['settings', 'Настройки']];
  let body = '';
  if (ATK.tab === 'list') body = atkListHtml();
  else if (ATK.tab === 'new') body = atkNewHtml();
  else if (ATK.tab === 'ai') body = atkAiHtml();
  else if (ATK.tab === 'rating') body = atkRatingHtml();
  else body = atkSettingsHtml();
  root.innerHTML = `<div class="sms-wrap atk">
    <div class="sms-tabs">${tabs.map(([k, l]) => `<button class="sms-tab ${ATK.tab === k ? 'on' : ''}" data-atktab="${k}">${l}</button>`).join('')}</div>
    ${body}</div>`;
  root.querySelectorAll('[data-atktab]').forEach(b => b.addEventListener('click', () => { ATK.tab = b.dataset.atktab; atkDraw(); }));
  atkBind(root);
}
function atkShopOpts(sel, withAll) {
  const shops = ATK.shops.length ? ATK.shops : [];
  return (withAll ? `<option value="all"${sel === 'all' ? ' selected' : ''}>Все магазины</option>` : '') +
    shops.map(s => `<option value="${s.wh}"${sel === s.wh ? ' selected' : ''}>${esc(s.name)}${s.planogram ? '' : ' (без планограммы)'}</option>`).join('');
}
function atkEmpOpts(sel, wh, allLabel) {
  const list = (ATK.emps || []).filter(e => !wh || wh === 'all' || e.wh === wh);
  return `<option value="">${allLabel || 'Все сотрудники'}</option>` + list.map(e => `<option value="${e.ref}"${sel === e.ref ? ' selected' : ''}>${esc(e.name)} — ${esc(e.shop)}</option>`).join('');
}

// ── список ──
function atkListHtml() {
  const f = ATK.f;
  const rows = ATK.rows;
  const tr = rows.map(t => {
    const p = t.place || {};
    const place = p.fixture ? `${esc(p.fixture)}${p.n ? ' · П' + p.n : ''}${p.k ? ' · М' + p.k : ''}` : '';
    const who = t.doneBy ? `<b>${esc(t.doneBy.name || '')}</b><br><small>${atkDT(t.doneAt)}</small>` : (t.assignee ? `→ ${esc(t.assignee.name)}` : '<small>все</small>');
    let acts = '';
    if (t.status === 'review') acts = `<button class="sms-btn pri" data-atkact="approve" data-id="${t.id}" data-wh="${t.wh}">✓ Принять</button><button class="sms-btn red" data-atkact="reject" data-id="${t.id}" data-wh="${t.wh}">Вернуть</button>`;
    else if (t.status === 'open') acts = `<button class="sms-btn" data-atkact="cancel" data-id="${t.id}" data-wh="${t.wh}">Отменить</button>`;
    else if (['cancelled', 'expired', 'rejected'].includes(t.status)) acts = `<button class="sms-btn" data-atkact="reopen" data-id="${t.id}" data-wh="${t.wh}">Открыть</button>`;
    if (t.kind !== 'restock' || t.status !== 'open') acts += `<button class="sms-btn red" title="Удалить" data-atkact="delete" data-id="${t.id}" data-wh="${t.wh}">🗑</button>`;
    return `<tr>
      <td><span class="atk-kind">${ATK_KIND[t.kind] || t.kind}</span></td>
      <td><b>${esc(t.title)}</b>${t.desc ? `<div class="atk-desc">${esc(t.desc.slice(0, 160))}</div>` : ''}${t.comment ? `<div class="atk-cmt">💬 ${esc(t.comment)}</div>` : ''}${t.note ? `<div class="atk-note">${esc(t.note)}</div>` : ''}</td>
      <td>${esc(t.shop)}${place ? `<br><small>${place}</small>` : ''}</td>
      <td><span class="atk-pr ${t.prio}">${ATK_PRIO[t.prio]}</span><br><small>+${t.points} б.</small></td>
      <td><span class="atk-st ${t.status}">${ATK_ST[t.status] || t.status}</span>${t.due ? `<br><small>до ${atkDay(t.due)}</small>` : ''}</td>
      <td>${who}</td>
      <td class="atk-acts">${acts}</td></tr>`;
  }).join('');
  return `<div class="sms-card">
    <div class="atk-filters">
      <select class="sms-sel" id="atkFWh">${atkShopOpts(f.wh, true)}</select>
      <select class="sms-sel" id="atkFSt">${[['active', 'Активные'], ['review', 'На проверке'], ['open', 'Открытые'], ['done', 'Выполненные'], ['all', 'Все']].map(([k, l]) => `<option value="${k}"${f.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select class="sms-sel" id="atkFKind"><option value="">Все виды</option>${Object.entries(ATK_KIND).map(([k, l]) => `<option value="${k}"${f.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select class="sms-sel" id="atkFSel">${atkEmpOpts(f.seller, f.wh)}</select>
      <button class="sms-btn" id="atkRefresh">↻ Обновить</button>
    </div>
    <div class="sms-sub" style="margin:10px 0">Найдено: ${ATK.total || 0}. Авто-задачи «Пополнить» создаются сами, когда с места на планограмме уходит пара.</div>
    ${rows.length ? `<div class="atk-tblw"><table class="sms-tbl atk-tbl"><thead><tr><th>Вид</th><th>Задача</th><th>Магазин / место</th><th>Сложность</th><th>Статус</th><th>Сотрудник</th><th></th></tr></thead><tbody>${tr}</tbody></table></div>` : '<div class="atk-empty">Задач нет</div>'}
  </div>`;
}
// ── новая задача ──
function atkNewHtml() {
  const F = ATK.form; const S = ATK.settings || { points: {} };
  if (!F.wh && ATK.shops[0]) F.wh = ATK.shops[0].wh;
  return `<div class="sms-card atk-form"><h3>✍️ Новая задача</h3>
    <div class="sms-f">
      <div class="full"><label>Название</label><input class="sms-in" id="atkNTitle" maxlength="120" value="${esc(F.title)}" placeholder="Например: Разложить новое поступление Comformini по размерам"></div>
      <div class="full"><label>Описание (что сделать и как проверить)</label><textarea class="sms-ta" id="atkNDesc" maxlength="1000">${esc(F.desc)}</textarea></div>
      <div><label>Магазин</label><select class="sms-sel" id="atkNWh">${atkShopOpts(F.wh, false)}</select></div>
      <div><label>Сотрудник</label><select class="sms-sel" id="atkNWho">${atkEmpOpts(F.who, F.wh, 'Все сотрудники магазина')}</select></div>
      <div><label>Сложность</label><select class="sms-sel" id="atkNPrio">${['low', 'mid', 'high'].map(p => `<option value="${p}"${F.prio === p ? ' selected' : ''}>${ATK_PRIO[p]} (${S.points[p] || 0} б.)</option>`).join('')}</select></div>
      <div><label>Баллы (пусто — по сложности)</label><input class="sms-in" id="atkNPts" type="number" min="0" value="${esc(F.points)}"></div>
      <div><label>Срок</label><input class="sms-in" id="atkNDue" type="date" value="${esc(F.due)}"></div>
    </div>
    <p class="sms-sub" style="margin-top:12px">${S.needApproval ? 'Сотрудник отметит выполнение с комментарием — баллы начислятся после вашего подтверждения во вкладке «Задачи».' : 'Баллы начисляются сразу после выполнения.'}</p>
    <button class="sms-btn pri big" id="atkNCreate">Поставить задачу</button></div>`;
}
// ── ИИ-генератор ──
function atkAiHtml() {
  const A = ATK.ai; const st = A.stats;
  let stats = '';
  if (st) {
    const s = st.sales || {}, a = st.shopAvg || {}, d = st.diag || null;
    const cmp = (v, avg) => avg ? `<small class="${v >= avg ? 'up' : 'dn'}">${v >= avg ? '▲' : '▼'} среднее ${avg}</small>` : '';
    stats = `<div class="atk-stats">
      <div><span>Чеков за 30 дн.</span><b>${s.receipts || 0}</b>${cmp(s.receipts || 0, a.receipts)}</div>
      <div><span>Средний чек</span><b>${s.avgCheck || 0} с.</b>${cmp(s.avgCheck || 0, a.avgCheck)}</div>
      <div><span>Товаров в чеке</span><b>${s.itemsPerCheck || 0}</b>${cmp(s.itemsPerCheck || 0, a.itemsPerCheck)}</div>
      <div><span>Продажи</span><b>${(s.sum || 0).toLocaleString('ru-RU')} с.</b><small>${s.workDays || 0} раб. дней</small></div>
      <div><span>Диагностики</span><b>${d ? d.visits : '—'}</b><small>${d ? `детей: ${d.children}` : 'нет профиля в DocSales'}</small></div>
      <div><span>Задачи</span><b>${(st.tasks || {}).done || 0}</b><small>${(st.tasks || {}).points || 0} баллов</small></div>
    </div>`;
  }
  const drafts = A.drafts.map((t, i) => `<div class="atk-draft ${t.off ? 'off' : ''}">
      <label class="sms-chk"><input type="checkbox" data-atkdraft="${i}" ${t.off ? '' : 'checked'}></label>
      <div class="atk-dbody">
        <input class="sms-in atk-dt" data-atkdf="title" data-i="${i}" value="${esc(t.title)}">
        <textarea class="sms-ta atk-dd" data-atkdf="desc" data-i="${i}">${esc(t.desc)}</textarea>
        <div class="atk-dmeta"><span class="atk-pr ${t.prio}">${ATK_PRIO[t.prio]}</span>${t.category ? `<span>${esc(t.category)}</span>` : ''}<span>+<input type="number" min="0" class="atk-dpts" data-atkdf="points" data-i="${i}" value="${t.points}"> б.</span><span>до <input type="date" class="atk-ddue" data-atkdf="due" data-i="${i}" value="${t.due || ''}"></span></div>
      </div></div>`).join('');
  return `<div class="atk-aigrid">
    <div class="sms-card"><h3>✨ Задачи с помощью ИИ</h3>
      <p class="sms-sub">ИИ смотрит продажи сотрудника за 30 дней (чеки, средний чек, товары в чеке) и его диагностики в DocSales2, сравнивает со средними по магазину и предлагает задачи разной сложности.</p>
      <div class="sms-f">
        <div class="full"><label>Сотрудник</label><select class="sms-sel" id="atkAiWho">${atkEmpOpts(A.ref, 'all', '— выберите —')}</select></div>
        <div><label>Простые (${(ATK.settings.points || {}).low} б.)</label><input class="sms-in" type="number" min="0" max="5" id="atkAiL" value="${A.mix.low}"></div>
        <div><label>Средние (${(ATK.settings.points || {}).mid} б.)</label><input class="sms-in" type="number" min="0" max="5" id="atkAiM" value="${A.mix.mid}"></div>
        <div><label>Сложные (${(ATK.settings.points || {}).high} б.)</label><input class="sms-in" type="number" min="0" max="5" id="atkAiH" value="${A.mix.high}"></div>
        <div class="full"><label>Акцент (необязательно)</label><input class="sms-in" id="atkAiFocus" value="${esc(A.focus)}" placeholder="Например: больше стелек к детской обуви"></div>
      </div>
      <button class="sms-btn pri big" id="atkAiGo" style="margin-top:12px" ${A.busy ? 'disabled' : ''}>${A.busy ? '⏳ ИИ думает (≈20 сек)…' : '✨ Сгенерировать задачи'}</button>
      ${stats}
      ${A.summary ? `<div class="atk-sum">💡 ${esc(A.summary)}</div>` : ''}
    </div>
    <div class="sms-card"><h3>Черновики задач <span class="sp"></span>${A.drafts.length ? `<small>${A.drafts.filter(t => !t.off).length} из ${A.drafts.length}</small>` : ''}</h3>
      ${A.drafts.length ? drafts + `<button class="sms-btn pri big" id="atkAiSave">Поставить выбранные задачи</button>` : '<div class="atk-empty">Выберите сотрудника и нажмите «Сгенерировать». Задачи можно поправить перед отправкой.</div>'}
    </div></div>`;
}
// ── рейтинг ──
function atkRatingHtml() {
  const list = [...(ATK.emps || [])].filter(e => e.receipts60 > 0).sort((a, b) => (b.monthPoints || 0) - (a.monthPoints || 0) || (b.monthDone || 0) - (a.monthDone || 0));
  const k = Number((ATK.settings || {}).somPerPoint) || 0;
  return `<div class="sms-card"><h3>🏆 Рейтинг за месяц</h3>
    <table class="sms-tbl"><thead><tr><th>#</th><th>Сотрудник</th><th>Магазин</th><th>Выполнено</th><th>Баллы</th>${k ? '<th>Сумма</th>' : ''}<th>Открыто на нём</th></tr></thead><tbody>
    ${list.map((e, i) => `<tr><td>${i < 3 && e.monthPoints ? ['🥇', '🥈', '🥉'][i] : i + 1}</td><td><b>${esc(e.name)}</b></td><td>${esc(e.shop)}</td><td>${e.monthDone || 0}</td><td><b>${e.monthPoints || 0}</b></td>${k ? `<td>${((e.monthPoints || 0) * k).toLocaleString('ru-RU')} с.</td>` : ''}<td>${e.openAssigned || 0}</td></tr>`).join('')}
    </tbody></table></div>`;
}
// ── настройки ──
function atkSettingsHtml() {
  const S = ATK.settings || { points: {} };
  return `<div class="sms-card atk-form"><h3>⚙️ Настройки задач</h3>
    <div class="sms-f">
      <div><label>Баллы: простая</label><input class="sms-in" type="number" min="0" id="atkSL" value="${S.points.low}"></div>
      <div><label>Баллы: средняя</label><input class="sms-in" type="number" min="0" id="atkSM" value="${S.points.mid}"></div>
      <div><label>Баллы: сложная</label><input class="sms-in" type="number" min="0" id="atkSH" value="${S.points.high}"></div>
      <div><label>Баллы за проверку витрины</label><input class="sms-in" type="number" min="0" id="atkSC" value="${S.checkPoints}"></div>
      <div><label>1 балл = ? сомони (0 — только баллы)</label><input class="sms-in" type="number" min="0" step="0.1" id="atkSSom" value="${S.somPerPoint}"></div>
      <div><label>Проверок витрин в день</label><input class="sms-in" type="number" min="0" max="5" id="atkSDC" value="${S.dailyCheckCount}"></div>
      <div><label>«Отложить» на, мин</label><input class="sms-in" type="number" min="5" id="atkSSn" value="${S.snoozeMin}"></div>
      <div class="full"><label class="sms-chk"><input type="checkbox" id="atkSRe" ${S.restock ? 'checked' : ''}> Авто-задачи «Пополнить витрину» после продажи (по планограмме)</label></div>
      <div class="full"><label class="sms-chk"><input type="checkbox" id="atkSDaily" ${S.dailyCheck ? 'checked' : ''}> Ежедневная задача «Проверить витрину» (после 9:00, секции по кругу)</label></div>
      <div class="full"><label class="sms-chk"><input type="checkbox" id="atkSAp" ${S.needApproval ? 'checked' : ''}> Ручные и ИИ-задачи — баллы после подтверждения администратором</label></div>
    </div>
    <p class="sms-sub" style="margin-top:10px">Задачи «Пополнить» подтверждаются сканом пары и начисляются сразу. Планограмма нужна для авто-задач и «Узнать место товара».</p>
    <button class="sms-btn pri big" id="atkSSave">Сохранить</button></div>`;
}

function atkBind(root) {
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  // список
  const reload = async () => { await atkLoad(false); atkDraw(); };
  on('atkFWh', 'change', e => { ATK.f.wh = e.target.value; ATK.f.seller = ''; reload(); });
  on('atkFSt', 'change', e => { ATK.f.status = e.target.value; reload(); });
  on('atkFKind', 'change', e => { ATK.f.kind = e.target.value; reload(); });
  on('atkFSel', 'change', e => { ATK.f.seller = e.target.value; reload(); });
  on('atkRefresh', 'click', async () => { await atkLoad(true); atkDraw(); });
  root.querySelectorAll('[data-atkact]').forEach(b => b.addEventListener('click', async () => {
    const act = b.dataset.atkact; const body = { act, id: b.dataset.id, wh: b.dataset.wh, by: atkBy() };
    if (act === 'reject') { const n = prompt('Что доделать? (увидит сотрудник)', 'доделать'); if (n == null) return; body.note = n; }
    if (act === 'delete' && !confirm('Удалить задачу?')) return;
    if (act === 'cancel' && !confirm('Отменить задачу?')) return;
    b.disabled = true;
    try { await atkApi('admin-act', body); atkToast('Готово'); await atkLoad(false); atkDraw(); } catch (e) { atkToast('Ошибка: ' + e.message); b.disabled = false; }
  }));
  // новая
  const F = ATK.form;
  const keep = () => { const g = (id) => ($(id) || {}).value; F.title = g('atkNTitle') || ''; F.desc = g('atkNDesc') || ''; F.who = g('atkNWho') || ''; F.prio = g('atkNPrio') || 'mid'; F.points = g('atkNPts') || ''; F.due = g('atkNDue') || ''; };
  on('atkNWh', 'change', e => { keep(); F.wh = e.target.value; F.who = ''; atkDraw(); });
  on('atkNCreate', 'click', async (e) => {
    keep(); if (!F.title.trim()) { atkToast('Укажите название'); return; }
    const emp = (ATK.emps || []).find(x => x.ref === F.who);
    e.target.disabled = true;
    try {
      await atkApi('admin-create', { by: atkBy(), wh: F.wh, title: F.title, desc: F.desc, prio: F.prio, points: F.points, due: F.due, assignee: emp ? { ref: emp.ref, name: emp.name } : null });
      atkToast('Задача поставлена'); ATK.form = { title: '', desc: '', wh: F.wh, who: '', prio: 'mid', points: '', due: '' };
      ATK.tab = 'list'; await atkLoad(false); atkDraw();
    } catch (err) { atkToast('Ошибка: ' + err.message); e.target.disabled = false; }
  });
  // ИИ
  const A = ATK.ai;
  const keepAi = () => { A.ref = ($('atkAiWho') || {}).value || ''; A.mix = { low: +($('atkAiL') || {}).value || 0, mid: +($('atkAiM') || {}).value || 0, high: +($('atkAiH') || {}).value || 0 }; A.focus = ($('atkAiFocus') || {}).value || ''; };
  on('atkAiWho', 'change', () => { keepAi(); A.stats = null; A.drafts = []; A.summary = ''; atkDraw(); });
  on('atkAiGo', 'click', async () => {
    keepAi(); if (!A.ref) { atkToast('Выберите сотрудника'); return; }
    A.busy = true; atkDraw();
    try { const d = await atkApi('ai-generate', { sellerRef: A.ref, mix: A.mix, focus: A.focus }); A.stats = d.stats; A.summary = d.summary; A.drafts = d.tasks || []; }
    catch (e) { atkToast('Ошибка ИИ: ' + e.message); }
    A.busy = false; atkDraw();
  });
  root.querySelectorAll('[data-atkdraft]').forEach(c => c.addEventListener('change', () => { A.drafts[+c.dataset.atkdraft].off = !c.checked; atkDraw(); }));
  root.querySelectorAll('[data-atkdf]').forEach(el => el.addEventListener('input', () => { const t = A.drafts[+el.dataset.i]; t[el.dataset.atkdf] = el.dataset.atkdf === 'points' ? (+el.value || 0) : el.value; }));
  on('atkAiSave', 'click', async (e) => {
    const emp = (ATK.emps || []).find(x => x.ref === A.ref); if (!emp) return;
    const sel = A.drafts.filter(t => !t.off); if (!sel.length) { atkToast('Не выбрано ни одной задачи'); return; }
    e.target.disabled = true;
    try {
      const d = await atkApi('admin-create', { by: atkBy(), tasks: sel.map(t => ({ ...t, ai: true, wh: emp.wh, assignee: { ref: emp.ref, name: emp.name } })) });
      atkToast(`Поставлено задач: ${d.created} → ${emp.name}`); A.drafts = []; A.summary = '';
      ATK.tab = 'list'; await atkLoad(false); atkDraw();
    } catch (err) { atkToast('Ошибка: ' + err.message); e.target.disabled = false; }
  });
  // настройки
  on('atkSSave', 'click', async (e) => {
    const n = (id) => ($(id) || {}).value; const c = (id) => !!($(id) || {}).checked;
    e.target.disabled = true;
    try {
      const d = await atkApi('settings-save', { settings: { points: { low: n('atkSL'), mid: n('atkSM'), high: n('atkSH') }, checkPoints: n('atkSC'), somPerPoint: n('atkSSom'), dailyCheckCount: n('atkSDC'), snoozeMin: n('atkSSn'), restock: c('atkSRe'), dailyCheck: c('atkSDaily'), needApproval: c('atkSAp') } });
      ATK.settings = d.settings; atkToast('Настройки сохранены'); atkDraw();
    } catch (err) { atkToast('Ошибка: ' + err.message); e.target.disabled = false; }
  });
}
