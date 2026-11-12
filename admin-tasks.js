// ══════════════════════════════════════════════════════════
//  ЗАДАЧИ СОТРУДНИКОВ (v1.4.0) — backend /api/tasks
//  Авто-задачи «пополнить витрину» по планограмме, ежедневная проверка витрин,
//  ручные задачи и ИИ-генерация по статистике продаж/диагностик сотрудника, баллы, рейтинг.
//  Использует хелперы admin-rmk.js: $, esc, state, svcFetch, BARCODE_SVC_URL, BARCODE_SVC_SECRET.
// ══════════════════════════════════════════════════════════
const ATK = {
  tab: 'list', f: { wh: 'all', status: 'active', kind: '', seller: '', prio: '', q: '', from: '', to: '' }, all: [], menu: null,
  rows: [], shops: [], emps: null, settings: null, ai: { ref: '', stats: null, drafts: [], mix: { low: 1, mid: 2, high: 1 }, focus: '', summary: '', busy: false },
  form: { title: '', desc: '', wh: '', who: '', prio: 'mid', ttype: 'complex', points: '', due: '' },
};
const ATK_KIND = { restock: '🧩 Пополнить', check: '👀 Проверка', manual: '✍️ Ручная', ai: '✨ ИИ' };
const ATK_ST = { open: 'Открыта', review: 'На проверке', done: 'Выполнена', rejected: 'Отклонена', cancelled: 'Отменена', expired: 'Просрочена', resolved: 'Закрыта сама', skipped: 'Нет товара' };
const ATK_PRIO = { low: 'Низкий', mid: 'Средний', high: 'Высокий' };
const ATK_TTYPE = { arrival: 'Расстановка нового поступления', storage: 'Проверка адресного хранения', fix: 'Исправление расхождений', complex: 'Сложное поручение администратора', other: 'Прочее (баллы по приоритету)' };
function atkTypePts(tt, prio) { const S = ATK.settings || {}; const T = S.typePoints || {}; if (tt === 'complex') return `${T.complexMin || 10}–${T.complexMax || 15}`; if (tt === 'other') return (S.points || {})[prio || 'mid'] || 0; return T[tt] != null ? T[tt] : '—'; }

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
  // грузим все задачи всех магазинов один раз; фильтры — на клиенте (нужны и для карточек магазинов)
  try { const d = await atkApi('admin-list', null, `&wh=all&status=all${sync ? '' : '&sync=0'}`); ATK.all = d.tasks || []; ATK.shops = d.shops || []; }
  catch (e) { atkToast('Ошибка: ' + e.message); }
  if (!ATK.f.from) { const t = atkToday(); ATK.f.from = t.slice(0, 8) + '01'; ATK.f.to = t; }
}
function atkToday() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function atkLocalDay(iso) { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const atkActive = (t) => t.status === 'open' || t.status === 'review';
const atkOverdue = (t) => atkActive(t) && t.due && t.due < atkToday();
// задача попадает в период: активные — всегда; закрытые — по дате выполнения/закрытия
function atkInPeriod(t) {
  if (atkActive(t)) return true;
  const d = atkLocalDay(t.doneAt || t.closedAt || t.createdAt);
  return (!ATK.f.from || d >= ATK.f.from) && (!ATK.f.to || d <= ATK.f.to);
}
function atkShopStats(wh) {
  const L = ATK.all.filter(t => (wh === 'all' || t.wh === wh));
  const act = L.filter(atkActive), today = atkToday();
  const doneP = L.filter(t => t.status === 'done' && atkInPeriod(t));
  return {
    active: act.length, open: act.filter(t => t.status === 'open').length, review: act.filter(t => t.status === 'review').length,
    urgent: act.filter(t => t.prio === 'high').length, overdue: L.filter(t => atkOverdue(t) || (t.status === 'expired' && atkInPeriod(t))).length,
    doneToday: L.filter(t => t.status === 'done' && atkLocalDay(t.doneAt) === today).length,
    done: doneP.length, points: doneP.reduce((s2, t) => s2 + (Number(t.points) || 0), 0),
    restock: act.filter(t => t.kind === 'restock').length, ai: act.filter(t => t.kind === 'ai').length,
    pct: (doneP.length + act.length) ? Math.round(doneP.length / (doneP.length + act.length) * 100) : 0,
  };
}
function atkFiltered() {
  const f = ATK.f, q = (f.q || '').trim().toLowerCase();
  return ATK.all.filter(t => {
    if (f.wh !== 'all' && t.wh !== f.wh) return false;
    if (f.status === 'active' && !atkActive(t)) return false;
    if (f.status === 'overdue' && !(atkOverdue(t) || t.status === 'expired')) return false;
    if (!['active', 'all', 'overdue'].includes(f.status) && t.status !== f.status) return false;
    if (f.kind && t.kind !== f.kind) return false;
    if (f.prio && t.prio !== f.prio) return false;
    if (f.seller && !((t.assignee && t.assignee.ref === f.seller) || (t.doneBy && t.doneBy.ref === f.seller))) return false;
    if (!atkInPeriod(t)) return false;
    if (q && !(`${t.title} ${t.desc} ${(t.assignee || {}).name || ''} ${(t.doneBy || {}).name || ''} ${(t.place || {}).fixture || ''}`.toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => ((a.status === 'review') ? 0 : 1) - ((b.status === 'review') ? 0 : 1) || (atkActive(b) - atkActive(a)) || ({ high: 0, mid: 1, low: 2 }[a.prio] - { high: 0, mid: 1, low: 2 }[b.prio]) || String(b.doneAt || b.createdAt).localeCompare(String(a.doneAt || a.createdAt)));
}
// сотрудники: выполнено / всего (назначено + выполнено) за период
function atkEmpStats(wh) {
  const M = {};
  const add = (ref, name, k) => { if (!ref) return; const e = M[ref] = M[ref] || { ref, name, done: 0, active: 0, points: 0 }; e[k]++; if (name) e.name = name; };
  ATK.all.filter(t => (wh === 'all' || t.wh === wh) && atkInPeriod(t)).forEach(t => {
    if (t.status === 'done' && t.doneBy) { add(t.doneBy.ref, t.doneBy.name, 'done'); M[t.doneBy.ref].points += Number(t.points) || 0; }
    else if (atkActive(t) && t.assignee) add(t.assignee.ref, t.assignee.name, 'active');
  });
  const emp = Object.fromEntries((ATK.emps || []).map(e => [e.ref, e]));
  return Object.values(M).map(e => ({ ...e, shop: (emp[e.ref] || {}).shop || '', total: e.done + e.active, pct: (e.done + e.active) ? Math.round(e.done / (e.done + e.active) * 100) : 0 }))
    .sort((a, b) => b.done - a.done || b.points - a.points);
}
const ATK_KIND_UI = { restock: ['▦', 'Витрина', 'g'], check: ['⌕', 'Проверка', 'b'], manual: ['✎', 'Ручная', 'a'], ai: ['✦', 'ИИ', 'v'] };
const ATK_COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#14b8a6', '#ec4899', '#6366f1'];
function atkAva(name) { const n = String(name || '?').trim(); let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `<span class="atk-ava" style="background:${ATK_COLORS[h % ATK_COLORS.length]}1f;color:${ATK_COLORS[h % ATK_COLORS.length]}">${esc(n[0] || '?')}</span>`; }
function atkShopName(wh) { const s = ATK.shops.find(x => x.wh === wh); return s ? s.name : ''; }

function atkDraw() {
  const root = $('tasksBody'); if (!root) return;
  const rv = ATK.all.filter(t => t.status === 'review').length;
  const tabs = [['list', 'Все задачи' + (rv ? ` <i class="atk-badge">${rv}</i>` : '')], ['shops', 'По магазинам'], ['people', 'По сотрудникам'], ['rating', 'Рейтинг'], ['rewards', '🎁 Награды'], ['settings', 'Настройки']];
  const showSide = ['list', 'shops', 'people'].includes(ATK.tab);
  let body = '';
  if (ATK.tab === 'list' || ATK.tab === 'shops') body = atkListHtml();
  else if (ATK.tab === 'people') body = atkPeopleHtml();
  else if (ATK.tab === 'new') body = atkNewHtml();
  else if (ATK.tab === 'ai') body = atkAiHtml();
  else if (ATK.tab === 'rating') body = atkRatingHtml();
  else if (ATK.tab === 'rewards') body = typeof atkRwHtml === 'function' ? atkRwHtml() : '';
  else body = atkSettingsHtml();
  root.innerHTML = `<div class="sms-wrap atk atk2">
    <div class="atk-top">
      <div class="atk-top-l">Задачи по витринам, поручения администратора и ИИ-рекомендации</div>
      <div class="atk-top-r">
        <button class="atk-hbtn pri" data-atkgo="new">＋ Новая задача</button>
        <button class="atk-hbtn" data-atkgo="ai">✦ ИИ-генератор</button>
        <button class="atk-hbtn" id="atkRefresh" title="Обновить и пересчитать авто-задачи">↻ Обновить</button>
      </div>
    </div>
    ${atkShopCardsHtml()}
    <div class="sms-tabs atk-tabs">${tabs.map(([k, l]) => `<button class="sms-tab ${ATK.tab === k ? 'on' : ''}" data-atktab="${k}">${l}</button>`).join('')}</div>
    ${showSide ? `<div class="atk-grid"><div class="atk-main">${body}</div><aside class="atk-side">${atkSideHtml()}</aside></div>` : body}
  </div>`;
  root.querySelectorAll('[data-atktab]').forEach(b => b.addEventListener('click', () => { ATK.tab = b.dataset.atktab; if (ATK.tab === 'shops' && ATK.f.wh === 'all' && ATK.shops[0]) ATK.f.wh = ATK.shops[0].wh; atkDraw(); }));
  root.querySelectorAll('[data-atkgo]').forEach(b => b.addEventListener('click', () => { ATK.tab = b.dataset.atkgo; if (ATK.tab === 'new' && ATK.f.wh !== 'all') ATK.form.wh = ATK.f.wh; atkDraw(); }));
  root.querySelectorAll('[data-atkshop]').forEach(b => b.addEventListener('click', () => { const w = b.dataset.atkshop; ATK.f.wh = ATK.f.wh === w ? 'all' : w; ATK.f.seller = ''; if (!['list', 'shops', 'people'].includes(ATK.tab)) ATK.tab = 'shops'; if (ATK.f.wh === 'all' && ATK.tab === 'shops') ATK.tab = 'list'; atkDraw(); }));
  atkBind(root);
  if (ATK.tab === 'rating') atkRatingBind(root);
  if (ATK.tab === 'rewards' && typeof atkRwBind === 'function') atkRwBind(root);
}
function atkShopCardsHtml() {
  if (!ATK.shops.length) return '';
  return `<div class="atk-shops">${ATK.shops.map(sh => {
    const st = atkShopStats(sh.wh), on = ATK.f.wh === sh.wh;
    return `<button class="atk-shop ${on ? 'on' : ''}" data-atkshop="${sh.wh}">
      <div class="atk-shop-h"><span class="atk-shop-ic">🏬</span><b>${esc(sh.name)}</b>${on ? '<span class="atk-sel">✓ Выбран</span>' : ''}</div>
      <div class="atk-shop-n"><div><span>Активных задач</span><b>${st.active}</b></div><div><span>Срочных</span><b class="r">${st.urgent}</b></div><div><span>Выполнено сегодня</span><b class="g">${st.doneToday}</b></div></div>
      <div class="atk-prog"><i style="width:${st.pct}%"></i></div><div class="atk-prog-l"><span>выполнено за период ${st.done}</span><b>${st.pct}%</b></div>
    </button>`;
  }).join('')}</div>`;
}
function atkFiltersHtml() {
  const f = ATK.f;
  const sel = (id, cur, opts, lbl) => `<label class="atk-fsel"><span>${lbl}</span><select id="${id}">${opts.map(([k, l]) => `<option value="${k}"${cur === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
  const emps = (ATK.emps || []).filter(e => f.wh === 'all' || e.wh === f.wh);
  return `<div class="atk-fbar">
    <label class="atk-fdate">📅 <input type="date" id="atkFFrom" value="${esc(f.from)}"><span>—</span><input type="date" id="atkFTo" value="${esc(f.to)}"></label>
    ${ATK.tab === 'list' ? sel('atkFWh', f.wh, [['all', 'Все'], ...ATK.shops.map(s => [s.wh, s.name])], 'Магазин:') : ''}
    ${sel('atkFSt', f.status, [['active', 'Активные'], ['open', 'Открытые'], ['review', 'На проверке'], ['done', 'Выполненные'], ['overdue', 'Просроченные'], ['cancelled', 'Отменённые'], ['all', 'Все']], 'Статус:')}
    ${sel('atkFKind', f.kind, [['', 'Все'], ...Object.entries(ATK_KIND_UI).map(([k, v]) => [k, v[1]])], 'Вид:')}
    ${sel('atkFSel', f.seller, [['', 'Все'], ...emps.map(e => [e.ref, e.name])], 'Сотрудник:')}
    ${sel('atkFPr', f.prio, [['', 'Все'], ['high', 'Высокий'], ['mid', 'Средний'], ['low', 'Низкий']], 'Приоритет:')}
    <label class="atk-fsearch">⌕ <input id="atkFQ" placeholder="Поиск по задачам…" value="${esc(f.q)}"></label>
  </div>`;
}
function atkRowActs(t) {
  const a = [];
  if (t.status === 'review') { a.push(['approve', '✓ Принять']); a.push(['reject', '↩ Вернуть на доработку']); }
  else if (t.status === 'open') a.push(['cancel', '✕ Отменить']);
  else if (['cancelled', 'expired', 'rejected'].includes(t.status)) a.push(['reopen', '↻ Открыть снова']);
  if (t.kind !== 'restock' || t.status !== 'open') a.push(['delete', '🗑 Удалить']);
  return a;
}
function atkListHtml() {
  const rows = atkFiltered();
  const today = atkToday();
  const tr = rows.map(t => {
    const p = t.place || {}, K = ATK_KIND_UI[t.kind] || ['•', t.kind, 'a'];
    const loc = p.fixture ? `${esc(p.fixture)}<small>${[p.n ? 'Полка ' + p.n : '', p.k ? 'Место ' + p.k : ''].filter(Boolean).join(' · ') || 'Все полки'}</small>` : `<span class="muted">—</span>`;
    const person = t.doneBy || t.assignee;
    const who = person ? `<div class="atk-who">${atkAva(person.name)}<div><b>${esc(person.name || '')}</b><small>${t.doneBy ? 'выполнил ' + atkDT(t.doneAt) : 'назначено'}</small></div></div>` : `<div class="atk-who"><span class="atk-ava none">👤</span><div><span class="muted">Не назначен</span><small>любой в магазине</small></div></div>`;
    const acts = atkRowActs(t);
    const od = atkOverdue(t);
    const stLbl = t.status === 'review' ? '◔ На проверке' : t.status === 'done' ? '✓ Выполнена' : od ? '◷ Просрочена' : (ATK_ST[t.status] || t.status);
    return `<tr class="${t.status === 'review' ? 'rv' : ''}">
      <td><span class="atk-chip ${K[2]}">${K[0]} ${K[1]}</span></td>
      <td class="atk-tt"><b>${esc(t.title)}</b>${t.desc ? `<div class="atk-desc">${esc(t.desc.slice(0, 140))}</div>` : ''}${t.comment ? `<div class="atk-cmt">💬 ${esc(t.comment)}</div>` : ''}${t.note ? `<div class="atk-note">${esc(t.note)}</div>` : ''}</td>
      <td class="atk-loc">${ATK.f.wh === 'all' ? `<b>${esc(t.shop)}</b>` : ''}${loc}</td>
      <td>${who}</td>
      <td><span class="atk-pr ${t.prio}">${ATK_PRIO[t.prio]}</span></td>
      <td><span class="atk-st ${od ? 'expired' : t.status}">${stLbl}</span></td>
      <td>${t.status === 'done' && t.awarded != null && t.awarded !== t.points ? `<span class="atk-pts ${t.awarded ? '' : 'z'}">+${t.awarded} б.</span>` : `<span class="atk-pts">+${t.points} б.</span>`}${t.repeat ? '<div class="atk-pz">повтор — без баллов</div>' : ''}${t.awardRevoked ? '<div class="atk-pz">баллы отменены</div>' : ''}${t.ttypeLabel && t.ttype !== 'other' ? `<div class="atk-pz n">${esc(t.ttypeLabel)}</div>` : ''}</td>
      <td class="atk-due ${od ? 'od' : ''}">${t.due ? '📅 ' + atkDay(t.due) + '.' + t.due.slice(0, 4) : '<span class="muted">—</span>'}</td>
      <td class="atk-act">${t.status === 'review' ? `<button class="atk-ok" title="Принять" data-atkact="approve" data-id="${t.id}" data-wh="${t.wh}">✓</button>` : ''}${acts.length ? `<button class="atk-dots" data-atkmenu="${t.id}">⋯</button>${ATK.menu === t.id ? `<div class="atk-menu">${acts.map(([k, l]) => `<button class="${k === 'delete' || k === 'reject' ? 'red' : ''}" data-atkact="${k}" data-id="${t.id}" data-wh="${t.wh}">${l}</button>`).join('')}</div>` : ''}` : ''}</td>
    </tr>`;
  }).join('');
  let head = '';
  if (ATK.f.wh !== 'all') {
    const st = atkShopStats(ATK.f.wh), emps = (ATK.emps || []).filter(e => e.wh === ATK.f.wh).length;
    const k = (ic, cls, l, v) => `<div class="atk-hk"><span class="atk-hk-ic ${cls}">${ic}</span><div><span>${l}</span><b class="${cls}">${v}</b></div></div>`;
    head = `<div class="atk-shophead"><div class="atk-sh-t"><span class="atk-sh-ic">🏬</span><div><h3>Магазин «${esc(atkShopName(ATK.f.wh))}»</h3><small>${emps} сотрудников · ${ATK.shops.find(s => s.wh === ATK.f.wh && s.planogram) ? 'есть планограмма' : 'без планограммы'}</small></div></div>
      <div class="atk-hks">${k('▤', '', 'Открытых', st.open)}${k('◔', 'a', 'На проверке', st.review)}${k('✓', 'g', 'Выполнено', st.done)}${k('◷', 'r', 'Просрочено', st.overdue)}${k('★', 'y', 'Баллов', '+' + st.points + ' б.')}</div></div>`;
  }
  return `<div class="atk-card">
    ${atkFiltersHtml()}
    ${head}
    ${rows.length ? `<div class="atk-tblw"><table class="atk-t"><thead><tr><th>Вид</th><th>Задача</th><th>Локация</th><th>Сотрудник</th><th>Приоритет</th><th>Статус</th><th>Баллы</th><th>Срок</th><th>Действия</th></tr></thead><tbody>${tr}</tbody></table></div>` : '<div class="atk-empty">Задач по фильтрам нет</div>'}
    <div class="atk-foot">Найдено: ${rows.length}. Активные задачи показываются всегда, выполненные и закрытые — за выбранный период. Авто-задачи «Витрина» создаются сами, когда с места на планограмме уходит пара.</div>
  </div>`;
}
function atkPeopleHtml() {
  const list = atkEmpStats(ATK.f.wh);
  const emps = (ATK.emps || []).filter(e => e.receipts60 > 0 && (ATK.f.wh === 'all' || e.wh === ATK.f.wh));
  emps.forEach(e => { if (!list.find(x => x.ref === e.ref)) list.push({ ref: e.ref, name: e.name, shop: e.shop, done: 0, active: 0, points: 0, total: 0, pct: 0 }); });
  return `<div class="atk-card">${atkFiltersHtml()}
    <div class="atk-people">${list.map(e => `<div class="atk-person">
      <div class="atk-who">${atkAva(e.name)}<div><b>${esc(e.name)}</b><small>${esc(e.shop || '')}</small></div></div>
      <div class="atk-pn"><div><span>Выполнено</span><b class="g">${e.done}</b></div><div><span>В работе</span><b>${e.active}</b></div><div><span>Баллы</span><b>+${e.points}</b></div></div>
      <div class="atk-prog"><i style="width:${e.pct}%"></i></div><div class="atk-prog-l"><span>${e.done} из ${e.total}</span><b>${e.pct}%</b></div>
      <div class="atk-pa"><button class="sms-btn" data-atkemp="${e.ref}">Задачи сотрудника</button><button class="sms-btn" data-atkaiemp="${e.ref}">✦ ИИ-задачи</button></div>
    </div>`).join('') || '<div class="atk-empty">Нет сотрудников</div>'}</div></div>`;
}
function atkSideHtml() {
  const wh = ATK.f.wh, st = atkShopStats(wh), nm = wh === 'all' ? 'Все магазины' : `Магазин «${esc(atkShopName(wh))}»`;
  const row = (ic, l, v, cls, go) => `<button class="atk-srow" ${go ? `data-atkquick="${go}"` : ''}><span>${ic}</span><em>${l}</em><b class="${cls || ''}">${v}</b></button>`;
  const top = atkEmpStats(wh).filter(e => e.total > 0).slice(0, 5);
  const weak = (ATK.emps || []).filter(e => e.receipts60 > 0 && (wh === 'all' || e.wh === wh)).map(e => ({ ...e, a: atkEmpStats(wh).find(x => x.ref === e.ref) })).sort((a, b) => ((a.a || {}).done || 0) - ((b.a || {}).done || 0))[0];
  return `<div class="atk-scard"><h4>🏬 Сводка: ${nm}</h4>
      ${row('▤', 'Активные задачи', st.active, '', 'active')}
      ${row('⚠', 'Срочные (высокий приоритет)', st.urgent, 'r', 'urgent')}
      ${row('◔', 'На проверке', st.review, 'a', 'review')}
      ${row('▦', 'Пустые места на витрине', st.restock, '', 'restock')}
      ${row('◷', 'Просрочено', st.overdue, 'r', 'overdue')}
      ${row('✦', 'ИИ-задачи в работе', st.ai, 'v', 'ai')}
    </div>
    <div class="atk-scard"><h4>🏆 Топ сотрудники по задачам</h4>
      ${top.map(e => `<div class="atk-top-e">${atkAva(e.name)}<div class="atk-top-b"><div><b>${esc(e.name)}</b><span>${e.pct}%</span></div><small>Выполнено: ${e.done} из ${e.total}</small><div class="atk-prog sm"><i style="width:${e.pct}%"></i></div></div></div>`).join('') || '<div class="atk-empty sm">За период задач нет</div>'}
    </div>
    <div class="atk-scard ai"><h4>✦ ИИ рекомендует</h4>
      ${weak ? `<button class="atk-rec" data-atkaiemp="${weak.ref}"><span>👤</span><em>Сгенерировать задачи сотруднику <b>${esc(weak.name)}</b></em><i>›</i></button>` : ''}
      ${st.review ? `<button class="atk-rec" data-atkquick="review"><span>◔</span><em>Проверить выполненные задачи: <b>${st.review}</b></em><i>›</i></button>` : ''}
      ${st.restock ? `<button class="atk-rec" data-atkquick="restock"><span>▦</span><em>Пустых мест на витрине: <b>${st.restock}</b> — показать</em><i>›</i></button>` : ''}
      <button class="atk-rec" data-atkgo2="new"><span>＋</span><em>Поставить ручную задачу</em><i>›</i></button>
    </div>`;
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
      <div><label>Тип задачи (определяет баллы)</label><select class="sms-sel" id="atkNType">${Object.entries(ATK_TTYPE).map(([k, l]) => `<option value="${k}"${F.ttype === k ? ' selected' : ''}>${l} — ${atkTypePts(k, F.prio)} б.</option>`).join('')}</select></div>
      <div><label>Приоритет</label><select class="sms-sel" id="atkNPrio">${['low', 'mid', 'high'].map(p => `<option value="${p}"${F.prio === p ? ' selected' : ''}>${ATK_PRIO[p]}</option>`).join('')}</select></div>
      <div><label>Баллы (${F.ttype === 'complex' ? 'от ' + atkTypePts('complex').replace('–', ' до ') : 'пусто — по типу'})</label><input class="sms-in" id="atkNPts" type="number" min="0" value="${esc(F.points)}" placeholder="${esc(String(atkTypePts(F.ttype, F.prio)))}"></div>
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
// ── рейтинг (период выбирается: этот / прошлый месяц / свои даты) ──
function atkYmd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function atkMonthRange(shift) {
  const n = new Date(); const a = new Date(n.getFullYear(), n.getMonth() + shift, 1); const b = new Date(n.getFullYear(), n.getMonth() + shift + 1, 0);
  return { from: atkYmd(a), to: atkYmd(b) };
}
const ATK_MON = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
async function atkRatingLoad(from, to) {
  ATK.rt = { from, to, list: null, busy: true }; atkDraw();
  try { const d = await atkApi('employees', null, `&from=${from}&to=${to}`); if (ATK.rt.from === from && ATK.rt.to === to) ATK.rt.list = d.employees || []; }
  catch (e) { atkToast('Ошибка: ' + e.message); ATK.rt.list = []; }
  ATK.rt.busy = false; atkDraw();
}
function atkRatingBind(root) {
  if (!ATK.rt) { const r = atkMonthRange(0); atkRatingLoad(r.from, r.to); return; }
  root.querySelectorAll('[data-rtm]').forEach(b => b.addEventListener('click', () => { const r = atkMonthRange(Number(b.dataset.rtm)); atkRatingLoad(r.from, r.to); }));
  const f = root.querySelector('#atkRtFrom'), t = root.querySelector('#atkRtTo');
  const go = () => { if (f.value && t.value && f.value <= t.value) atkRatingLoad(f.value, t.value); };
  if (f) f.addEventListener('change', go); if (t) t.addEventListener('change', go);
}
function atkRatingHtml() {
  const R = ATK.rt || { list: null, busy: true, from: '', to: '' };
  const k = Number((ATK.settings || {}).somPerPoint) || 0;
  const cur = atkMonthRange(0), prev = atkMonthRange(-1);
  const isCur = R.from === cur.from && R.to === cur.to, isPrev = R.from === prev.from && R.to === prev.to;
  const mName = (r) => ATK_MON[Number(r.from.slice(5, 7)) - 1];
  const title = isCur ? `за ${mName(cur)} (текущий месяц)` : isPrev ? `за ${mName(prev)}` : (R.from ? `${atkDay(R.from)}.${R.from.slice(0, 4)} — ${atkDay(R.to)}.${R.to.slice(0, 4)}` : '');
  const list = [...(R.list || [])].filter(e => e.receipts60 > 0 || e.monthPoints > 0).sort((a, b) => (b.monthPoints || 0) - (a.monthPoints || 0) || (b.monthDone || 0) - (a.monthDone || 0));
  const totP = list.reduce((s2, e) => s2 + (e.monthPoints || 0), 0), totD = list.reduce((s2, e) => s2 + (e.monthDone || 0), 0);
  const bar = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:4px 0 12px">
      <button class="sms-tab ${isCur ? 'on' : ''}" data-rtm="0">Этот месяц (${mName(cur)})</button>
      <button class="sms-tab ${isPrev ? 'on' : ''}" data-rtm="-1">Прошлый месяц (${mName(prev)})</button>
      <span style="margin-left:8px;color:var(--tx3,#64748b)">или период:</span>
      <input class="sms-in" type="date" id="atkRtFrom" value="${esc(R.from || '')}" style="width:auto">
      <span>—</span>
      <input class="sms-in" type="date" id="atkRtTo" value="${esc(R.to || '')}" style="width:auto">
    </div>`;
  const body = R.busy || !R.list ? '<div class="loading">⏳ Загрузка…</div>' : `
    <table class="sms-tbl"><thead><tr><th>#</th><th>Сотрудник</th><th>Магазин</th><th>Выполнено</th><th>Баллы</th>${k ? '<th>Сумма</th>' : ''}<th>Открыто на нём сейчас</th></tr></thead><tbody>
    ${list.map((e, i) => `<tr><td>${i < 3 && e.monthPoints ? ['🥇', '🥈', '🥉'][i] : i + 1}</td><td><b>${esc(e.name)}</b></td><td>${esc(e.shop)}</td><td>${e.monthDone || 0}</td><td><b>${e.monthPoints || 0}</b></td>${k ? `<td>${((e.monthPoints || 0) * k).toLocaleString('ru-RU')} с.</td>` : ''}<td>${e.openAssigned || 0}</td></tr>`).join('') || '<tr><td colspan="7" class="atk-empty">Нет данных</td></tr>'}
    </tbody><tfoot><tr><td></td><td><b>Итого</b></td><td></td><td><b>${totD}</b></td><td><b>${totP}</b></td>${k ? `<td><b>${(totP * k).toLocaleString('ru-RU')} с.</b></td>` : ''}<td></td></tr></tfoot></table>`;
  return `<div class="sms-card"><h3>🏆 Рейтинг ${esc(title)}</h3>${bar}${body}</div>`;
}
// ── настройки ──
function atkSettingsHtml() {
  const S = ATK.settings || { points: {} };
  return `<div class="sms-card atk-form"><h3>⚙️ Настройки задач</h3>
    <div class="sms-f">
      <div class="full"><label style="font-weight:800;color:var(--tx)">Баллы за тип задачи</label></div>
      ${[['restock', 'Пополнение витрины'], ['check', 'Проверка витрины по планограмме'], ['arrival', 'Расстановка нового поступления'], ['storage', 'Проверка адресного хранения'], ['fix', 'Исправление расхождений'], ['complexMin', 'Сложное поручение: от'], ['complexMax', 'Сложное поручение: до']].map(([k, l]) => `<div><label>${l}</label><input class="sms-in" type="number" min="0" id="atkST_${k}" value="${(S.typePoints || {})[k] != null ? S.typePoints[k] : ''}"></div>`).join('')}
      <div><label>«Прочее»: низкий приоритет</label><input class="sms-in" type="number" min="0" id="atkSL" value="${S.points.low}"></div>
      <div><label>«Прочее»: средний</label><input class="sms-in" type="number" min="0" id="atkSM" value="${S.points.mid}"></div>
      <div><label>«Прочее»: высокий</label><input class="sms-in" type="number" min="0" id="atkSH" value="${S.points.high}"></div>
      <div><label>Премия «Лучший сотрудник месяца», с.</label><input class="sms-in" type="number" min="0" id="atkSBest" value="${S.bestPrize != null ? S.bestPrize : 300}"></div>
      <div><label>Повтор той же пары на месте без баллов, дней</label><input class="sms-in" type="number" min="0" id="atkSRep" value="${S.repeatDays != null ? S.repeatDays : 7}"></div>
      <div><label>1 балл = ? сомони (0 — только баллы)</label><input class="sms-in" type="number" min="0" step="0.1" id="atkSSom" value="${S.somPerPoint}"></div>
      <div><label>Проверок витрин в день</label><input class="sms-in" type="number" min="0" max="5" id="atkSDC" value="${S.dailyCheckCount}"></div>
      <div><label>«Отложить» на, мин</label><input class="sms-in" type="number" min="5" id="atkSSn" value="${S.snoozeMin}"></div>
      <div><label>Задач на кассе у продавца (0 — все)</label><input class="sms-in" type="number" min="0" max="50" id="atkSLim" value="${S.cashierLimit != null ? S.cashierLimit : 5}"></div>
      <div class="full"><label class="sms-chk"><input type="checkbox" id="atkSRe" ${S.restock ? 'checked' : ''}> Авто-задачи «Пополнить витрину» после продажи (по планограмме)</label></div>
      <div class="full"><label class="sms-chk"><input type="checkbox" id="atkSDaily" ${S.dailyCheck ? 'checked' : ''}> Ежедневная задача «Проверить витрину» (после 9:00, секции по кругу)</label></div>
      <div class="full"><label class="sms-chk"><input type="checkbox" id="atkSAp" ${S.needApproval ? 'checked' : ''}> Ручные, ИИ-задачи и проверки витрин — баллы после подтверждения администратором</label></div>
    </div>
    <p class="sms-sub" style="margin-top:10px">Задачи «Пополнить» подтверждаются сканом пары и начисляются сразу. Планограмма нужна для авто-задач и «Узнать место товара».</p>
    <button class="sms-btn pri big" id="atkSSave">Сохранить</button></div>`;
}

function atkBind(root) {
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  // список (фильтры на клиенте)
  const redraw = () => { ATK.menu = null; atkDraw(); };
  on('atkFWh', 'change', e => { ATK.f.wh = e.target.value; ATK.f.seller = ''; redraw(); });
  on('atkFSt', 'change', e => { ATK.f.status = e.target.value; redraw(); });
  on('atkFKind', 'change', e => { ATK.f.kind = e.target.value; redraw(); });
  on('atkFSel', 'change', e => { ATK.f.seller = e.target.value; redraw(); });
  on('atkFPr', 'change', e => { ATK.f.prio = e.target.value; redraw(); });
  on('atkFFrom', 'change', e => { ATK.f.from = e.target.value; redraw(); });
  on('atkFTo', 'change', e => { ATK.f.to = e.target.value; redraw(); });
  on('atkFQ', 'input', e => { ATK.f.q = e.target.value; clearTimeout(ATK._qt); ATK._qt = setTimeout(() => { atkDraw(); const q = $('atkFQ'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 300); });
  on('atkRefresh', 'click', async (e) => { e.target.disabled = true; e.target.textContent = '⏳ Обновляю…'; await atkLoad(true); atkDraw(); });
  root.querySelectorAll('[data-atkmenu]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); ATK.menu = ATK.menu === b.dataset.atkmenu ? null : b.dataset.atkmenu; atkDraw(); }));
  if (ATK.menu) setTimeout(() => document.addEventListener('click', function cl(ev) { if (!ev.target.closest('.atk-menu')) { document.removeEventListener('click', cl); if (ATK.menu) { ATK.menu = null; atkDraw(); } } }), 0);
  root.querySelectorAll('[data-atkemp]').forEach(b => b.addEventListener('click', () => { ATK.f.seller = b.dataset.atkemp; ATK.f.status = 'all'; ATK.tab = 'list'; atkDraw(); }));
  root.querySelectorAll('[data-atkaiemp]').forEach(b => b.addEventListener('click', () => { ATK.ai.ref = b.dataset.atkaiemp; ATK.ai.stats = null; ATK.ai.drafts = []; ATK.ai.summary = ''; ATK.tab = 'ai'; atkDraw(); }));
  root.querySelectorAll('[data-atkgo2]').forEach(b => b.addEventListener('click', () => { ATK.tab = b.dataset.atkgo2; if (ATK.f.wh !== 'all') ATK.form.wh = ATK.f.wh; atkDraw(); }));
  root.querySelectorAll('[data-atkquick]').forEach(b => b.addEventListener('click', () => {
    const q = b.dataset.atkquick; Object.assign(ATK.f, { status: 'active', kind: '', prio: '', seller: '' });
    if (q === 'urgent') ATK.f.prio = 'high'; else if (q === 'review') ATK.f.status = 'review'; else if (q === 'overdue') ATK.f.status = 'overdue'; else if (q === 'restock') ATK.f.kind = 'restock'; else if (q === 'ai') ATK.f.kind = 'ai';
    if (ATK.tab === 'people') ATK.tab = ATK.f.wh === 'all' ? 'list' : 'shops'; atkDraw();
  }));
  root.querySelectorAll('[data-atkact]').forEach(b => b.addEventListener('click', async () => {
    const act = b.dataset.atkact; const body = { act, id: b.dataset.id, wh: b.dataset.wh, by: atkBy() };
    if (act === 'reject') { const n = prompt('Что доделать? (увидит сотрудник)', 'доделать'); if (n == null) return; body.note = n; }
    if (act === 'delete' && !confirm('Удалить задачу?')) return;
    if (act === 'cancel' && !confirm('Отменить задачу?')) return;
    b.disabled = true;
    try { await atkApi('admin-act', body); atkToast('Готово'); ATK.menu = null; await atkLoad(false); atkDraw(); } catch (e) { atkToast('Ошибка: ' + e.message); b.disabled = false; }
  }));
  // новая
  const F = ATK.form;
  const keep = () => { const g = (id) => ($(id) || {}).value; F.title = g('atkNTitle') || ''; F.desc = g('atkNDesc') || ''; F.who = g('atkNWho') || ''; F.prio = g('atkNPrio') || 'mid'; F.ttype = g('atkNType') || 'complex'; F.points = g('atkNPts') || ''; F.due = g('atkNDue') || ''; };
  on('atkNWh', 'change', e => { keep(); F.wh = e.target.value; F.who = ''; atkDraw(); });
  on('atkNType', 'change', () => { keep(); atkDraw(); });
  on('atkNPrio', 'change', () => { keep(); atkDraw(); });
  on('atkNCreate', 'click', async (e) => {
    keep(); if (!F.title.trim()) { atkToast('Укажите название'); return; }
    const emp = (ATK.emps || []).find(x => x.ref === F.who);
    e.target.disabled = true;
    try {
      await atkApi('admin-create', { by: atkBy(), wh: F.wh, title: F.title, desc: F.desc, prio: F.prio, ttype: F.ttype, points: F.points, due: F.due, assignee: emp ? { ref: emp.ref, name: emp.name } : null });
      atkToast('Задача поставлена'); ATK.form = { title: '', desc: '', wh: F.wh, who: '', prio: 'mid', ttype: 'complex', points: '', due: '' };
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
      const d = await atkApi('settings-save', { settings: { points: { low: n('atkSL'), mid: n('atkSM'), high: n('atkSH') }, typePoints: Object.fromEntries(['restock', 'check', 'arrival', 'storage', 'fix', 'complexMin', 'complexMax'].map(k => [k, n('atkST_' + k)])), bestPrize: n('atkSBest'), repeatDays: n('atkSRep'), somPerPoint: n('atkSSom'), dailyCheckCount: n('atkSDC'), snoozeMin: n('atkSSn'), cashierLimit: n('atkSLim'), restock: c('atkSRe'), dailyCheck: c('atkSDaily'), needApproval: c('atkSAp') } });
      ATK.settings = d.settings; if (typeof RW !== 'undefined') RW.d = null; atkToast('Настройки сохранены'); atkDraw();
    } catch (err) { atkToast('Ошибка: ' + err.message); e.target.disabled = false; }
  });
}
