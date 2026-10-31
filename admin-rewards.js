// ══════════════════════════════════════════════════════════
//  ЗАДАЧИ СОТРУДНИКОВ → «Награды» (v1.7.1)
//  Баланс баллов (уменьшается при обмене) и рейтинг заработанного за месяц (не уменьшается),
//  каталог наград, заявки, журнал начислений/списаний, «Лучший сотрудник по задачам».
//  Backend: /api/tasks?action=rewards-overview | points-journal | reward-save | reward-delete |
//           claim-create | claim-act | points-revoke | points-adjust | best-award
//  Использует ATK, atkApi, atkToast, atkBy, atkAva, atkDT, esc, $ из admin-tasks.js / admin-rmk.js
// ══════════════════════════════════════════════════════════
const RW = { per: 'month', from: '', to: '', wh: 'all', ref: '', status: '', d: null, busy: false, err: '', modal: null, jr: null };
const RW_ST = { pending: ['На рассмотрении', 'p'], approved: ['Выдано', 'ok'], rejected: ['Отклонено', 'no'], cancelled: ['Отменено', 'off'] };
const RW_KIND = { gift: 'Подарок / компенсация', money: 'Денежная премия', dayoff: 'Выходной' };
const RW_TT_IC = { restock: '🧩', check: '📋', arrival: '📦', storage: '🗄️', fix: '🛠️', complex: '🎯' };
const rwN = (n) => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
function rwRange() {
  const t = new Date(Date.now() + 5 * 3600e3), d = new Date(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()), y = d.getFullYear(), m = d.getMonth(); // Asia/Tashkent
  const f = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  if (RW.per === 'prev') return { from: f(new Date(y, m - 1, 1)), to: f(new Date(y, m, 0)) };
  if (RW.per === 'year') return { from: f(new Date(y, 0, 1)), to: f(d) };
  if (RW.per === 'custom' && RW.from && RW.to) return { from: RW.from, to: RW.to };
  return { from: f(new Date(y, m, 1)), to: f(d) };
}
async function rwLoad() {
  RW.busy = true; RW.err = ''; atkDraw();
  const r = rwRange();
  try { RW.d = await atkApi('rewards-overview', null, `&from=${r.from}&to=${r.to}&wh=${encodeURIComponent(RW.wh)}&ref=${encodeURIComponent(RW.ref)}&status=${RW.status}`); }
  catch (e) { RW.err = e.message; }
  RW.busy = false; atkDraw();
}
function rwPct(cur, prev) { if (!prev) return cur ? '<span class="rw-up">новое</span>' : ''; const p = Math.round((cur - prev) / prev * 100); return `<span class="${p >= 0 ? 'rw-up' : 'rw-dn'}">${p >= 0 ? '↑ +' : '↓ '}${p}%</span> к прошлому периоду`; }
function rwStatus(st) { const s = RW_ST[st] || [st, 'off']; return `<span class="rw-st ${s[1]}">${s[0]}</span>`; }

function atkRwHtml() {
  if (!RW.d && !RW.busy && !RW.err) { setTimeout(rwLoad, 0); return '<div class="atk-card"><div class="loading">⏳ Загрузка…</div></div>'; }
  const D = RW.d;
  const shops = ATK.shops || [];
  const emps = (D && D.employees) || [];
  const sel = (id, cur, opts, lbl) => `<label class="rw-fl"><span>${lbl}</span><select id="${id}">${opts.map(([k, l]) => `<option value="${esc(k)}"${String(cur) === String(k) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const empOpts = (ATK.emps || []).filter(e => RW.wh === 'all' || e.wh === RW.wh).map(e => [e.ref, e.name]);
  const bar = `<div class="rw-head">
      <div class="rw-title"><span class="rw-hic">🎁</span><div><h2>Вознаграждения сотрудников</h2><small>Баллы за задачи, каталог наград и заявки на их получение</small></div></div>
      <div class="rw-filters">
        ${sel('rwPer', RW.per, [['month', 'Этот месяц'], ['prev', 'Прошлый месяц'], ['year', 'С начала года'], ['custom', 'Свои даты']], 'Период')}
        ${RW.per === 'custom' ? `<label class="rw-fl"><span>С — по</span><div class="rw-dd"><input type="date" id="rwFrom" value="${esc(RW.from)}"><input type="date" id="rwTo" value="${esc(RW.to)}"></div></label>` : ''}
        ${sel('rwWh', RW.wh, [['all', 'Все магазины'], ...shops.map(s => [s.wh, s.name])], 'Магазин')}
        ${sel('rwRef', RW.ref, [['', 'Все сотрудники'], ...empOpts], 'Сотрудник')}
        ${sel('rwSt', RW.status, [['', 'Все статусы'], ['pending', 'На рассмотрении'], ['approved', 'Выдано'], ['rejected', 'Отклонено'], ['cancelled', 'Отменено']], 'Статус заявок')}
      </div></div>`;
  if (RW.err) return bar + `<div class="atk-card"><div class="atk-empty">Ошибка: ${esc(RW.err)} <button class="sms-btn" id="rwRetry">Повторить</button></div></div>`;
  if (!D) return bar + '<div class="atk-card"><div class="loading">⏳ Загрузка…</div></div>';
  const K = D.kpi;
  const kpi = `<div class="rw-kpis">
      <div class="rw-kpi"><span class="rw-kic g">🪙</span><div><span>Всего баллов начислено</span><b>${rwN(K.earned)}</b><small>${rwPct(K.earned, K.earnedPrev)}</small></div></div>
      <div class="rw-kpi"><span class="rw-kic g">👥</span><div><span>Активных сотрудников</span><b>${K.activeEmployees}</b><small>из ${K.totalEmployees} · заработали баллы за период</small></div></div>
      <div class="rw-kpi"><span class="rw-kic o">🎁</span><div><span>Заявок на награды</span><b>${K.claims}</b><small>${K.pending ? `<span class="rw-dn">${K.pending} ждут решения</span>` : 'нет ожидающих'}</small></div></div>
      <div class="rw-kpi"><span class="rw-kic y">🏅</span><div><span>Выдано в этом месяце</span><b>${K.issuedMonth} ${K.issuedMonth % 10 === 1 && K.issuedMonth % 100 !== 11 ? 'награда' : 'наград'}</b><small>на ${rwN(K.issuedMonthPts)} баллов · на балансах ${rwN(K.balanceTotal)}</small></div></div>
    </div>`;
  // каталог
  const cat = `<div class="atk-card rw-cat"><div class="rw-ch"><h3>🎁 Каталог наград</h3><small>Сотрудники обменивают накопленные баллы на награды в РМК кассы → «Задачи» → «Награды».</small><button class="sms-btn pri" data-rwedit="">＋ Добавить</button></div>
    <div class="rw-cards">${D.rewards.map(r => {
      const badge = r.active === false ? '<span class="rw-b off">Скрыта</span>' : r.popular ? '<span class="rw-b hot">☆ Популярно</span>' : '<span class="rw-b ok">✓ Доступно</span>';
      return `<button class="rw-card ${r.active === false ? 'off' : ''}" data-rwedit="${esc(r.id)}" title="Изменить награду">
        <span class="rw-ic">${esc(r.icon || '🎁')}</span>
        <div class="rw-cb">${badge}<b>${esc(r.title)}</b><small>${esc(r.desc || '')}${r.terms ? ` · ${esc(r.terms)}` : ''}</small><span class="rw-cost">🪙 ${rwN(r.cost)} баллов</span>${r.claims ? `<em>заявок: ${r.claims}</em>` : ''}</div>
      </button>`;
    }).join('')}</div></div>`;
  // заявки
  const cl = D.claims.slice(0, 12);
  const claims = `<div class="atk-card rw-claims"><div class="rw-ch"><h3>📄 Заявки на награды</h3>${K.pending ? `<span class="rw-pill">${K.pending} новых</span>` : ''}</div>
    ${cl.length ? `<table class="rw-t"><thead><tr><th>Сотрудник</th><th>Награда</th><th>Списание</th><th>Дата</th><th>Действия</th></tr></thead><tbody>${cl.map(c => `<tr>
      <td><div class="atk-who">${atkAva(c.name)}<div><b>${esc(c.name)}</b><small>${esc(c.shop || '')}</small></div></div></td>
      <td><span class="rw-cl-ic">${esc(c.icon || '🎁')}</span> ${esc(c.title)}${c.payoutId ? '<div class="rw-mini">проведено в выплаты</div>' : c.payoutError ? `<div class="rw-mini red">выплата: ${esc(c.payoutError)}</div>` : ''}</td>
      <td class="tnum"><b>${rwN(c.cost)}</b></td><td>${atkDT(c.at)}</td>
      <td class="rw-acts">${c.status === 'pending' ? `<button class="rw-ok" data-rwclaim="approve" data-id="${c.id}">✓ Подтвердить</button><button class="rw-no" data-rwclaim="reject" data-id="${c.id}">✕ Отклонить</button>` : `${rwStatus(c.status)}${c.status === 'approved' ? `<button class="rw-lnk" data-rwclaim="revert" data-id="${c.id}">вернуть баллы</button>` : ''}`}</td></tr>`).join('')}</tbody></table>` : '<div class="atk-empty sm">Заявок нет</div>'}
    ${D.claims.length > 12 ? `<div class="rw-mini">Показаны последние 12 из ${D.claims.length}. Отфильтруйте по статусу или сотруднику.</div>` : ''}</div>`;
  // сотрудники
  const people = `<div class="atk-card"><div class="rw-ch"><h3>👥 Сотрудники и их баллы</h3><small>Баланс уменьшается при обмене; «заработано» — не уменьшается и идёт в рейтинг.</small><button class="sms-btn" data-rwadj="">± Корректировка</button></div>
    <div class="atk-tblw"><table class="rw-t rw-pt"><thead><tr><th>Сотрудник</th><th>Магазин</th><th class="r">Текущие баллы</th><th class="r">Заработано за период</th><th class="r">Уже потрачено</th><th>Прогресс до следующей награды</th><th class="c">Доступно наград</th><th>Последняя заявка</th><th></th></tr></thead><tbody>
    ${emps.map(e => `<tr>
      <td><div class="atk-who">${atkAva(e.name)}<div><b>${esc(e.name)}</b><small>${e.tasksPeriod} задач за период</small></div></div></td>
      <td>${esc(e.shop || '—')}</td>
      <td class="r tnum"><b>${rwN(e.balance)}</b>${e.pending ? `<div class="rw-mini">в заявках ${rwN(e.pending)}</div>` : ''}</td>
      <td class="r tnum rw-g">+${rwN(e.earnedPeriod)}</td>
      <td class="r tnum">${rwN(e.spent)}</td>
      <td class="rw-prog-c">${e.next ? `<div class="rw-pl"><span>${rwN(Math.max(0, e.available))} / ${rwN(e.next.cost)}</span><b>${e.next.pct}%</b></div><div class="atk-prog sm"><i style="width:${e.next.pct}%"></i></div><small>${esc(e.next.title)}</small>` : '<span class="rw-g">доступны все награды</span>'}</td>
      <td class="c tnum"><b>${e.availableCount}</b></td>
      <td>${e.lastClaim ? `<div class="rw-mini">${atkDT(e.lastClaim.at)}</div>${esc(e.lastClaim.title)}<div>${rwStatus(e.lastClaim.status)}</div>` : '—'}</td>
      <td class="rw-acts"><button class="sms-btn" data-rwjr="${esc(e.ref)}">Журнал</button>${e.availableCount ? `<button class="sms-btn pri" data-rwissue="${esc(e.ref)}">Оформить награду</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="9" class="atk-empty">Нет сотрудников</td></tr>'}
    </tbody></table></div></div>`;
  // лучшие
  const B = D.best;
  const medal = (i) => i < 3 ? `<span class="rw-med m${i}">${i + 1}</span>` : `<span class="rw-med">${i + 1}</span>`;
  const prevSaved = B.saved[B.prevMonth];
  const mName = (ym) => { const M = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']; return M[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4); };
  const best = `<div class="atk-card"><div class="rw-ch"><h3>🏆 Лучшие сотрудники по задачам</h3><small>Рейтинг за ${mName(B.month)}: подтверждённые задачи с учётом сложности (баллы). Обмен на награды рейтинг не уменьшает.</small></div>
      <table class="rw-t"><thead><tr><th>#</th><th>Сотрудник</th><th>Магазин</th><th class="r">Задач</th><th class="r">Баллы за месяц</th></tr></thead><tbody>
      ${B.current.map((x, i) => `<tr><td>${medal(i)}</td><td><div class="atk-who">${atkAva(x.name)}<b>${esc(x.name)}</b></div></td><td>${esc(x.shop || '')}</td><td class="r tnum">${x.tasks}</td><td class="r tnum rw-g"><b>${rwN(x.points)}</b></td></tr>`).join('') || '<tr><td colspan="5" class="atk-empty sm">В этом месяце ещё нет подтверждённых задач</td></tr>'}
      </tbody></table>
      <div class="rw-best">
        <div class="rw-best-h"><span>🥇</span><div><b>«Лучший сотрудник по задачам» — ${rwN(B.prize)} с.</b><small>Отдельная премия раз в месяц, после окончания месяца.</small></div></div>
        ${prevSaved ? `<div class="rw-best-w">За ${mName(B.prevMonth)}: <b>${esc(prevSaved.name)}</b> — ${rwN(prevSaved.points)} б., премия ${rwN(prevSaved.prize)} с.${prevSaved.payoutId ? ' · проведено в выплаты' : ''}</div>`
          : B.prev.length ? `<div class="rw-best-w">За ${mName(B.prevMonth)} лидирует <b>${esc(B.prev[0].name)}</b> — ${rwN(B.prev[0].points)} б., ${B.prev[0].tasks} задач</div><label class="sms-chk"><input type="checkbox" id="rwBestPay" checked> провести ${rwN(B.prize)} с. в «Бонусы сотрудникам» (выплата → расходы)</label><button class="sms-btn pri" data-rwbest="${B.prevMonth}" data-ref="${esc(B.prev[0].ref)}">Наградить ${esc(B.prev[0].name)}</button>`
          : `<div class="rw-mini">За ${mName(B.prevMonth)} подтверждённых задач нет.</div>`}
        ${B.current[0] ? `<div class="rw-mini">Сейчас (${mName(B.month)}) лидирует: ${esc(B.current[0].name)} — ${rwN(B.current[0].points)} б.</div>` : ''}
      </div></div>`;
  // правила
  const T = D.settings.typePoints || {};
  const rules = `<div class="atk-card"><div class="rw-ch"><h3>✅ Правила начисления</h3><small>Баллы начисляются после выполнения и подтверждения задачи. Одна задача — одно начисление.</small><button class="sms-btn" data-atktab="settings">Изменить баллы</button></div>
    <div class="rw-rules">${['restock', 'check', 'arrival', 'storage', 'fix', 'complex'].map(k => `<div class="rw-rule"><span class="rw-ric">${RW_TT_IC[k]}</span><div><b>${esc(D.ttypes[k])}</b></div><span class="rw-rpts">+${k === 'complex' ? `${T.complexMin}–${T.complexMax}` : T[k]}<small>балла</small></span></div>`).join('')}</div>
    <div class="rw-mini" style="margin-top:8px">Защита от накрутки: повторное начисление за одну задачу невозможно; если ту же пару ставят на то же место в течение ${D.settings.repeatDays} дн., баллы не начисляются. Ошибочное начисление отменяется в «Журнале» сотрудника — история сохраняется.</div></div>`;
  return bar + kpi + `<div class="rw-grid"><div class="rw-col">${cat}</div><div class="rw-col">${claims}${best}</div></div>` + people + rules + rwModalHtml();
}

function rwModalHtml() {
  const M = RW.modal; if (!M) return '';
  let h = '';
  if (M.type === 'edit') {
    const r = M.r;
    h = `<h3>${r.id ? 'Изменить награду' : 'Новая награда'}</h3>
      <div class="sms-f">
        <div class="full"><label>Название</label><input class="sms-in" id="rwETitle" maxlength="80" value="${esc(r.title || '')}"></div>
        <div class="full"><label>Описание</label><input class="sms-in" id="rwEDesc" maxlength="300" value="${esc(r.desc || '')}"></div>
        <div class="full"><label>Условия получения</label><input class="sms-in" id="rwETerms" maxlength="300" value="${esc(r.terms || '')}" placeholder="например: до 100 с., по согласованию"></div>
        <div><label>Стоимость, баллов</label><input class="sms-in" type="number" min="1" id="rwECost" value="${esc(r.cost || '')}"></div>
        <div><label>Сумма, с. (0 — не деньги)</label><input class="sms-in" type="number" min="0" id="rwESom" value="${esc(r.som || 0)}"></div>
        <div><label>Вид</label><select class="sms-sel" id="rwEKind">${Object.entries(RW_KIND).map(([k, l]) => `<option value="${k}"${r.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label>Иконка (эмодзи)</label><input class="sms-in" id="rwEIcon" maxlength="8" value="${esc(r.icon || '🎁')}"></div>
        <div class="full"><label class="sms-chk"><input type="checkbox" id="rwEAct" ${r.active !== false ? 'checked' : ''}> Показывать сотрудникам</label></div>
      </div>
      <div class="rw-mf">${r.id ? '<button class="sms-btn red" id="rwEDel">Удалить</button>' : ''}<span></span><button class="sms-btn" data-rwclose="1">Отмена</button><button class="sms-btn pri" id="rwESave">Сохранить</button></div>`;
  } else if (M.type === 'issue') {
    const e = M.e; const list = (RW.d.rewards || []).filter(r => r.active !== false && r.cost <= e.available);
    h = `<h3>Оформить награду: ${esc(e.name)}</h3><p class="sms-sub">Доступно ${rwN(e.available)} баллов. Баллы спишутся сразу, запись попадёт в журнал.</p>
      <div class="rw-pick">${list.map((r, i) => `<label class="rw-pk"><input type="radio" name="rwPick" value="${esc(r.id)}" ${i === 0 ? 'checked' : ''}><span>${esc(r.icon)}</span><b>${esc(r.title)}</b><em>${rwN(r.cost)} б.</em></label>`).join('')}</div>
      <label class="sms-chk"><input type="checkbox" id="rwIPay" checked> денежную премию провести в «Бонусы сотрудникам» (выплата → расходы)</label>
      <div class="sms-f"><div class="full"><label>Комментарий</label><input class="sms-in" id="rwINote" maxlength="300"></div></div>
      <div class="rw-mf"><span></span><button class="sms-btn" data-rwclose="1">Отмена</button><button class="sms-btn pri" id="rwIGo">Оформить и списать</button></div>`;
  } else if (M.type === 'approve') {
    const c = M.c;
    h = `<h3>Подтвердить заявку</h3><p><b>${esc(c.name)}</b> → ${esc(c.icon)} ${esc(c.title)}, списание <b>${rwN(c.cost)}</b> баллов.</p>
      ${c.kind === 'money' && c.som > 0 ? `<label class="sms-chk"><input type="checkbox" id="rwAPay" checked> провести ${rwN(c.som)} с. в «Бонусы сотрудникам» (выплата → расходы)</label>` : ''}
      <div class="sms-f"><div class="full"><label>Комментарий (увидит сотрудник)</label><input class="sms-in" id="rwANote" maxlength="300"></div></div>
      <div class="rw-mf"><span></span><button class="sms-btn" data-rwclose="1">Отмена</button><button class="sms-btn pri" id="rwAGo">Подтвердить и списать</button></div>`;
  } else if (M.type === 'adj') {
    h = `<h3>Корректировка баллов</h3><p class="sms-sub">Ручное начисление (+) или списание (−) с обязательной причиной. Попадает в журнал.</p>
      <div class="sms-f"><div class="full"><label>Сотрудник</label><select class="sms-sel" id="rwJRef">${(RW.d.employees || []).map(e => `<option value="${esc(e.ref)}"${M.ref === e.ref ? ' selected' : ''}>${esc(e.name)} — ${rwN(e.balance)} б.</option>`).join('')}</select></div>
      <div><label>Баллы (+ или −)</label><input class="sms-in" type="number" id="rwJPts"></div><div><label>Причина</label><input class="sms-in" id="rwJNote" maxlength="300"></div></div>
      <div class="rw-mf"><span></span><button class="sms-btn" data-rwclose="1">Отмена</button><button class="sms-btn pri" id="rwJGo">Сохранить</button></div>`;
  } else if (M.type === 'journal') {
    const J = M.j; const e = M.e;
    const TT = { earn: ['Начисление', 'ok'], revoke: ['Отмена начисления', 'no'], adjust: ['Корректировка', 'p'], spend: ['Обмен на награду', 'off'], refund: ['Возврат баллов', 'ok'], best: ['Лучший сотрудник', 'p'], log: ['Событие', 'off'] };
    h = `<h3>Журнал баллов: ${esc(e.name)}</h3>
      <div class="rw-jk"><div><span>Текущие баллы</span><b>${rwN(e.balance)}</b></div><div><span>Заработано всего</span><b class="rw-g">+${rwN(e.earnedAll)}</b></div><div><span>Потрачено</span><b>${rwN(e.spent)}</b></div><div><span>В заявках</span><b>${rwN(e.pending)}</b></div></div>
      ${!J ? '<div class="loading">⏳ Загрузка…</div>' : `<div class="rw-jl"><table class="rw-t"><thead><tr><th>Когда</th><th>Операция</th><th>Описание</th><th class="r">Баллы</th><th>Кто</th><th></th></tr></thead><tbody>
      ${J.entries.map(x => { const t = TT[x.type] || [x.type, 'off']; return `<tr class="${x.revoked ? 'rw-rev' : ''}"><td>${atkDT(x.at)}</td><td><span class="rw-st ${t[1]}">${t[0]}</span></td><td>${esc(x.title || '')}${x.title && x.note ? '<br>' : ''}<span class="rw-mini">${esc(x.note || '')}</span>${x.revoked ? `<div class="rw-mini red">отменено ${atkDT(x.revoked.at)} · ${esc(x.revoked.by || '')}${x.revoked.note ? ' · ' + esc(x.revoked.note) : ''}</div>` : ''}</td><td class="r tnum ${x.pts > 0 ? 'rw-g' : x.pts < 0 ? 'rw-r' : ''}"><b>${x.pts > 0 ? '+' : ''}${x.pts || 0}</b></td><td>${esc(x.by || '')}</td><td>${(x.type === 'earn' || x.type === 'adjust') && !x.revoked && x.pts > 0 ? `<button class="rw-lnk red" data-rwrev="${x.id}">отменить</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="6" class="atk-empty sm">Записей нет</td></tr>'}
      </tbody></table></div>`}
      <div class="rw-mf"><button class="sms-btn" data-rwadj="${esc(e.ref)}">± Корректировка</button><span></span><button class="sms-btn" data-rwclose="1">Закрыть</button></div>`;
  }
  return `<div class="rw-ov" data-rwclose="1"><div class="rw-m ${M.type === 'journal' ? 'wide' : ''}" onclick="event.stopPropagation()">${h}</div></div>`;
}

function atkRwBind(root) {
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  on('rwPer', 'change', e => { RW.per = e.target.value; if (RW.per === 'custom' && !RW.from) { const r = rwRange(); RW.from = r.from; RW.to = r.to; } rwLoad(); });
  on('rwFrom', 'change', e => { RW.from = e.target.value; if (RW.from && RW.to) rwLoad(); });
  on('rwTo', 'change', e => { RW.to = e.target.value; if (RW.from && RW.to) rwLoad(); });
  on('rwWh', 'change', e => { RW.wh = e.target.value; RW.ref = ''; rwLoad(); });
  on('rwRef', 'change', e => { RW.ref = e.target.value; rwLoad(); });
  on('rwSt', 'change', e => { RW.status = e.target.value; rwLoad(); });
  on('rwRetry', 'click', rwLoad);
  const D = RW.d; if (!D) return;
  const emp = (ref) => (D.employees || []).find(x => x.ref === ref);
  root.querySelectorAll('[data-rwclose]').forEach(b => b.addEventListener('click', (ev) => { if (ev.target === b) { RW.modal = null; atkDraw(); } }));
  root.querySelectorAll('[data-rwedit]').forEach(b => b.addEventListener('click', () => { const r = b.dataset.rwedit ? D.rewards.find(x => x.id === b.dataset.rwedit) : { kind: 'gift', icon: '🎁', active: true }; RW.modal = { type: 'edit', r: { ...r } }; atkDraw(); }));
  root.querySelectorAll('[data-rwissue]').forEach(b => b.addEventListener('click', () => { RW.modal = { type: 'issue', e: emp(b.dataset.rwissue) }; atkDraw(); }));
  root.querySelectorAll('[data-rwadj]').forEach(b => b.addEventListener('click', () => { RW.modal = { type: 'adj', ref: b.dataset.rwadj || (D.employees[0] || {}).ref }; atkDraw(); }));
  root.querySelectorAll('[data-rwjr]').forEach(b => b.addEventListener('click', async () => {
    const e = emp(b.dataset.rwjr); RW.modal = { type: 'journal', e, j: null }; atkDraw();
    try { const j = await atkApi('points-journal', null, `&ref=${encodeURIComponent(e.ref)}`); if (RW.modal && RW.modal.e === e) { RW.modal.j = j; atkDraw(); } } catch (er) { atkToast('Ошибка: ' + er.message); }
  }));
  const run = async (btn, action, body, okMsg) => {
    if (btn) btn.disabled = true;
    try { const r = await atkApi(action, { by: atkBy(), ...body }); atkToast(okMsg); return r; }
    catch (er) { atkToast('Ошибка: ' + er.message); if (btn) btn.disabled = false; return null; }
  };
  root.querySelectorAll('[data-rwrev]').forEach(b => b.addEventListener('click', async () => {
    const note = prompt('Причина отмены начисления (сохранится в журнале):', 'ошибочное начисление'); if (note == null) return;
    if (await run(b, 'points-revoke', { entryId: b.dataset.rwrev, note }, 'Начисление отменено')) { const e = RW.modal.e; RW.modal = null; await rwLoad(); const e2 = (RW.d.employees || []).find(x => x.ref === e.ref) || e; RW.modal = { type: 'journal', e: e2, j: await atkApi('points-journal', null, `&ref=${encodeURIComponent(e.ref)}`) }; atkDraw(); }
  }));
  root.querySelectorAll('[data-rwclaim]').forEach(b => b.addEventListener('click', async () => {
    const act = b.dataset.rwclaim, c = D.claims.find(x => x.id === b.dataset.id);
    if (act === 'approve') { RW.modal = { type: 'approve', c }; atkDraw(); return; }
    const note = prompt(act === 'reject' ? 'Причина отказа (увидит сотрудник):' : 'Вернуть баллы и отменить выданную награду? Причина:', ''); if (note == null) return;
    if (await run(b, 'claim-act', { id: c.id, act, note }, act === 'reject' ? 'Заявка отклонена' : 'Баллы возвращены')) rwLoad();
  }));
  on('rwAGo', 'click', async (ev) => { const c = RW.modal.c; if (await run(ev.target, 'claim-act', { id: c.id, act: 'approve', note: ($('rwANote') || {}).value || '', payout: !!($('rwAPay') || {}).checked }, 'Награда выдана, баллы списаны')) { RW.modal = null; rwLoad(); } });
  on('rwIGo', 'click', async (ev) => {
    const e = RW.modal.e, pick = root.querySelector('input[name=rwPick]:checked'); if (!pick) { atkToast('Нет доступных наград'); return; }
    if (await run(ev.target, 'claim-create', { admin: true, approve: true, ref: e.ref, name: e.name, wh: e.wh || undefined, rewardId: pick.value, note: ($('rwINote') || {}).value || '', payout: !!($('rwIPay') || {}).checked }, 'Награда оформлена')) { RW.modal = null; rwLoad(); }
  });
  on('rwJGo', 'click', async (ev) => {
    const ref = $('rwJRef').value, e = emp(ref);
    if (await run(ev.target, 'points-adjust', { ref, name: e ? e.name : '', pts: $('rwJPts').value, note: $('rwJNote').value }, 'Сохранено')) { RW.modal = null; rwLoad(); }
  });
  on('rwESave', 'click', async (ev) => {
    const g = (id) => ($(id) || {}).value;
    const r = { id: RW.modal.r.id, title: g('rwETitle'), desc: g('rwEDesc'), terms: g('rwETerms'), cost: g('rwECost'), som: g('rwESom'), kind: g('rwEKind'), icon: g('rwEIcon'), active: !!($('rwEAct') || {}).checked, order: RW.modal.r.order };
    if (await run(ev.target, 'reward-save', { reward: r }, 'Награда сохранена')) { RW.modal = null; rwLoad(); }
  });
  on('rwEDel', 'click', async (ev) => { if (!confirm('Удалить награду из каталога? История заявок сохранится.')) return; if (await run(ev.target, 'reward-delete', { id: RW.modal.r.id }, 'Награда удалена')) { RW.modal = null; rwLoad(); } });
  root.querySelectorAll('[data-rwbest]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(`Наградить «Лучший сотрудник по задачам» за ${b.dataset.rwbest}?`)) return;
    if (await run(b, 'best-award', { ym: b.dataset.rwbest, ref: b.dataset.ref, payout: !!($('rwBestPay') || {}).checked }, 'Премия назначена')) rwLoad();
  }));
}
