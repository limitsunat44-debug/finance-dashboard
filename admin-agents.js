// ══════════════════════════════════════════════════════════
//  ИИ-АГЕНТЫ (v1.5.0) — backend /api/agents
//  Лента находок, отметки (верно/неверно/задача/скрыть), настройки, точность,
//  «Запустить сейчас», история экземпляра по штрихкоду.
//  Хелперы admin-rmk.js: $, esc, svcFetch, BARCODE_SVC_URL, BARCODE_SVC_SECRET, fmtNum, dushTime, errBar.
// ══════════════════════════════════════════════════════════
const AG = { data: null, feed: null, tab: 'feed', fAgent: '', fStatus: '', fSev: '', open: null, busy: {} };
async function agApi(action, body, timeoutMs) {
  const res = await svcFetch(`${BARCODE_SVC_URL}/api/agents?action=${action}`, {
    method: 'POST', timeoutMs: timeoutMs || 120000, retries: 0,
    headers: { 'X-Provision-Secret': BARCODE_SVC_SECRET, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.ok === false) throw new Error(d.error || `HTTP ${res.status}`);
  return d;
}
const agUser = () => { try { return (JSON.parse(localStorage.getItem('orto_admin_rmk_auth') || '{}').user) || 'Админ'; } catch { return 'Админ'; } };
const AG_SEV = { urgent: ['🔴', 'Срочно'], important: ['🟠', 'Важно'], info: ['🔵', 'К сведению'] };
const AG_ST = { new: ['Новая', ''], ok: ['Верно', 'ok'], bad: ['Неверно', 'bad'], muted: ['Скрыта', 'mu'] };
const agDay = (d) => d ? d.split('-').reverse().slice(0, 2).join('.') : '';

async function renderAgents(force) {
  const root = $('agBody'); if (!root) return;
  if (!AG.data || force) {
    root.innerHTML = '<div class="loading">⏳ Загружаю агентов…</div>';
    try { [AG.data, AG.feed] = await Promise.all([agApi('list'), agApi('feed', {})]); }
    catch (e) { root.innerHTML = errBar('Агенты: ' + e.message); return; }
  }
  agDraw();
}
function agDraw() {
  const root = $('agBody'); const d = AG.data; if (!root || !d) return;
  const S = d.settings; const F = AG.feed || { findings: [], runs: [] };
  const acc = d.agents.reduce((a, x) => { const c = x.acc || {}; a.ok += c.ok || 0; a.bad += c.bad || 0; a.f += c.findings || 0; a.t += c.tasks || 0; return a; }, { ok: 0, bad: 0, f: 0, t: 0 });
  const on = d.agents.filter(a => a.cfg && a.cfg.on).length;
  const chat = d.chat;
  root.innerHTML = `<div class="ag">
    <div class="ag-top">
      <div class="ag-status">
        <span class="ag-dot ${S.enabled ? '' : 'off'}"></span><b>${S.enabled ? 'Агенты работают' : 'Агенты выключены'}</b>
        <span class="muted">· Telegram: ${chat ? `<b>${esc(chat.title || 'группа')}</b>${chat.isForum ? ` · тем: ${chat.topics}` : ''}${chat.topicError ? ` · <span class="red">${esc(chat.topicError)}</span>` : ''}` : '<span class="red">группа не подключена — напишите /agents в группе агентов</span>'}</span>
        ${d.lastTick ? `<span class="muted">· проверка ${esc(d.lastTick.local || '')}${d.lastTick.urgent ? `, срочных: ${d.lastTick.urgent}` : ''}</span>` : ''}
      </div>
      <div class="ag-tabs">${[['feed', '📰 Лента'], ['runs', '🧠 Сводки и идеи'], ['agents', '🤖 Агенты'], ['unit', '🔎 История товара'], ['settings', '⚙ Настройки']].map(([k, l]) => `<button class="ag-tab ${AG.tab === k ? 'on' : ''}" data-agtab="${k}">${l}</button>`).join('')}</div>
    </div>
    <div class="an-kpis">
      <div class="an-kpi"><div class="an-kic">🤖</div><div><div class="an-kl">Агентов включено</div><div class="an-kv">${on} из ${d.agents.length}</div><div class="an-ks">срочное сразу · сводка ${esc(S.digest)} · неделя пн ${esc(S.weeklyTime)}</div></div></div>
      <div class="an-kpi"><div class="an-kic b">📰</div><div><div class="an-kl">Находок за 30 дней</div><div class="an-kv">${acc.f}</div><div class="an-ks">за 7 дней: ${F.findings.length}</div></div></div>
      <div class="an-kpi"><div class="an-kic">🎯</div><div><div class="an-kl">Точность (ваши отметки)</div><div class="an-kv">${acc.ok + acc.bad ? Math.round(acc.ok / (acc.ok + acc.bad) * 100) + '%' : '—'}</div><div class="an-ks">верно ${acc.ok} · неверно ${acc.bad}</div></div></div>
      <div class="an-kpi"><div class="an-kic am">📋</div><div><div class="an-kl">Задач создано</div><div class="an-kv">${acc.t}</div><div class="an-ks">из находок агентов</div></div></div>
    </div>
    <div id="agTabBody"></div>
  </div>`;
  root.querySelectorAll('[data-agtab]').forEach(b => b.addEventListener('click', () => { AG.tab = b.dataset.agtab; agDraw(); }));
  ({ feed: agDrawFeed, runs: agDrawRuns, agents: agDrawAgents, unit: agDrawUnit, settings: agDrawSettings }[AG.tab] || agDrawFeed)();
}
const agName = (id) => { const a = (AG.data.agents || []).find(x => x.id === id); return a ? `${a.icon} ${esc(a.name)}` : esc(id); };

// ══════════ ЛЕНТА ══════════
function agDrawFeed() {
  const box = $('agTabBody'); const F = AG.feed || { findings: [] };
  let list = F.findings.slice();
  if (AG.fAgent) list = list.filter(f => f.agent === AG.fAgent);
  if (AG.fStatus) list = list.filter(f => (f.status || 'new') === AG.fStatus);
  if (AG.fSev) list = list.filter(f => f.severity === AG.fSev);
  box.innerHTML = `<div class="card card-pad">
    <div class="ag-filters">
      <select class="fselect" id="agFA"><option value="">Все агенты</option>${AG.data.agents.map(a => `<option value="${a.id}" ${AG.fAgent === a.id ? 'selected' : ''}>${a.icon} ${esc(a.name)}</option>`).join('')}</select>
      <select class="fselect" id="agFS"><option value="">Любой статус</option>${Object.entries(AG_ST).map(([k, [l]]) => `<option value="${k}" ${AG.fStatus === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select class="fselect" id="agFV"><option value="">Любая важность</option>${Object.entries(AG_SEV).map(([k, [i, l]]) => `<option value="${k}" ${AG.fSev === k ? 'selected' : ''}>${i} ${l}</option>`).join('')}</select>
      <span class="muted sm">${list.length} находок · ${agDay(F.from)}–${agDay(F.to)}</span>
      <button class="btn" id="agReload">↻ Обновить</button>
    </div>
    ${list.length ? `<div class="ag-list">${list.map(agItem).join('')}</div>` : `<div class="ag-empty">Пока нет находок. Первые сводки придут вечером в ${esc(AG.data.settings.digest)}, срочные — сразу. Можно запустить агента вручную во вкладке «Агенты».</div>`}
  </div>`;
  $('agFA').addEventListener('change', e => { AG.fAgent = e.target.value; agDrawFeed(); });
  $('agFS').addEventListener('change', e => { AG.fStatus = e.target.value; agDrawFeed(); });
  $('agFV').addEventListener('change', e => { AG.fSev = e.target.value; agDrawFeed(); });
  $('agReload').addEventListener('click', () => renderAgents(true));
  box.querySelectorAll('[data-agopen]').forEach(el => el.addEventListener('click', () => { AG.open = AG.open === el.dataset.agopen ? null : el.dataset.agopen; agDrawFeed(); }));
  box.querySelectorAll('[data-agact]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); agAct(b.dataset.fid, b.dataset.agact); }));
}
function agItem(f) {
  const [si, sl] = AG_SEV[f.severity] || AG_SEV.info; const [stl, stc] = AG_ST[f.status || 'new'] || AG_ST.new;
  const open = AG.open === f.id;
  const ver = f.source === 'code' ? '✓ найдено по базе' : [f.numbersOk === false ? '⚠ не все цифры подтверждены' : '✓ цифры сверены', f.verifier ? (f.verifier.verdict === 'ok' ? '✓ проверяющий согласен' : `⚠ проверяющий: ${esc(f.verifier.note || 'сомневается')}`) : ''].filter(Boolean).join(' · ');
  return `<div class="ag-item ${open ? 'open' : ''} sev-${f.severity}" data-agopen="${f.id}">
    <div class="ag-ih"><span class="ag-sev" title="${sl}">${si}</span><div class="ag-it"><b>${esc(f.title)}</b><div class="muted sm">${agName(f.agent)} · ${agDay(f.day)} ${f.at ? dushTime(f.at).slice(-5) : ''}${f.mode === 'weekly' ? ' · неделя' : f.mode === 'urgent' ? ' · срочно' : ''}</div></div>
      <span class="ag-st ${stc}">${stl}</span>${f.taskCreated ? '<span class="ag-st task">📋 задача</span>' : ''}</div>
    ${open ? `<div class="ag-ib">
      ${f.text ? `<p>${esc(f.text)}</p>` : ''}
      ${(f.evidence || []).length ? `<div class="ag-ev">🔎 ${f.evidence.map(e => `<span>${esc(e)}</span>`).join('')}</div>` : ''}
      ${f.advice ? `<div class="ag-adv">👉 ${esc(f.advice)}</div>` : ''}
      ${f.task && f.task.title ? `<div class="muted sm">Задача: ${esc(f.task.title)} · ${esc(f.task.shop || '')}${f.taskCreated ? ' — создана' : ''}</div>` : ''}
      ${f.note ? `<div class="muted sm">Ваш комментарий: ${esc(f.note)}</div>` : ''}
      <div class="muted sm">${ver}</div>
      <div class="ag-btns">
        <button class="btn sm" data-agact="ok" data-fid="${f.id}">✅ Верно</button>
        <button class="btn sm" data-agact="bad" data-fid="${f.id}">❌ Неверно</button>
        ${f.task && f.task.title && !f.taskCreated ? `<button class="btn sm" data-agact="task" data-fid="${f.id}">📋 Создать задачу</button>` : ''}
        <button class="btn sm" data-agact="mute" data-fid="${f.id}">🔕 Не показывать такое</button>
      </div></div>` : ''}
  </div>`;
}
async function agAct(fid, verb) {
  let note = '';
  if (verb === 'bad') { note = prompt('Что не так? (агент учтёт в следующий раз)', '') || ''; }
  try {
    const r = await agApi('act', { fid, verb, note, by: agUser() });
    const f = (AG.feed.findings || []).find(x => x.id === fid); if (f) Object.assign(f, r.finding);
    agDraw();
  } catch (e) { alert('Ошибка: ' + e.message); }
}

// ══════════ СВОДКИ И ИДЕИ ══════════
function agDrawRuns() {
  const box = $('agTabBody'); const runs = (AG.feed && AG.feed.runs) || [];
  const list = AG.fAgent ? runs.filter(r => r.agent === AG.fAgent) : runs;
  box.innerHTML = `<div class="card card-pad">
    <div class="ag-filters"><select class="fselect" id="agRA"><option value="">Все агенты</option>${AG.data.agents.map(a => `<option value="${a.id}" ${AG.fAgent === a.id ? 'selected' : ''}>${a.icon} ${esc(a.name)}</option>`).join('')}</select><span class="muted sm">${list.length} сводок за 7 дней</span></div>
    ${list.length ? list.map(r => `<div class="ag-run">
      <div class="ag-rh"><b>${agName(r.agent)}</b><span class="muted sm">${r.mode === 'weekly' ? 'недельный разбор' : 'вечерняя сводка'} · ${esc(r.period || agDay(r.day))} · ${r.at ? dushTime(r.at) : ''} · ${Math.round((r.ms || 0) / 1000)} с</span></div>
      <p>${esc(r.summary || '')}</p>
      ${(r.ideas || []).length ? `<div class="ag-ideas">${r.ideas.map(i => `<div class="ag-idea">💡 <b>${esc(i.title)}</b> — ${esc(i.text)}${i.effect ? `<div class="muted sm">Эффект: ${esc(i.effect)}</div>` : ''}</div>`).join('')}</div>` : ''}
      ${(r.rejected || []).length ? `<div class="muted sm">Проверяющий отклонил: ${r.rejected.map(x => esc(x.title)).join('; ')}</div>` : ''}
    </div>`).join('') : '<div class="ag-empty">Сводок пока нет.</div>'}
  </div>`;
  $('agRA').addEventListener('change', e => { AG.fAgent = e.target.value; agDrawRuns(); });
}

// ══════════ АГЕНТЫ ══════════
function agDrawAgents() {
  const box = $('agTabBody'); const d = AG.data;
  box.innerHTML = `<div class="ag-grid">${d.agents.map(a => { const c = a.acc || {}; const cfg = a.cfg || {}; const b = AG.busy[a.id];
    return `<div class="card card-pad ag-card ${cfg.on ? '' : 'off'}">
      <div class="ag-ch"><span class="ag-ic">${a.icon}</span><div><b>${esc(a.name)}</b><div class="muted sm">${a.daily ? 'каждый вечер' : ''}${a.daily && a.weekly ? ' · ' : ''}${a.weekly ? 'недельный разбор' : ''}${!a.daily && !a.weekly ? 'по запросу (касса / Telegram)' : ''}${a.owner ? ' · видит только владелец' : ''}</div></div>
        <label class="ag-sw"><input type="checkbox" data-agon="${a.id}" ${cfg.on ? 'checked' : ''}><span></span></label></div>
      <div class="ag-role">${esc(a.role)}</div>
      <div class="ag-stats"><span>находок <b>${c.findings || 0}</b></span><span>верно <b>${c.ok || 0}</b></span><span>неверно <b>${c.bad || 0}</b></span><span>точность <b>${c.accuracy != null ? c.accuracy + '%' : '—'}</b></span></div>
      <div class="muted sm">Последний запуск: ${a.lastDaily ? 'сводка ' + agDay(a.lastDaily) : '—'}${a.lastWeekly ? ' · неделя ' + agDay(a.lastWeekly) : ''}</div>
      ${a.daily || a.weekly ? `<div class="ag-btns">
        ${a.daily ? `<button class="btn sm" data-agrun="${a.id}" data-mode="daily" ${b ? 'disabled' : ''}>▶ Сводка сейчас</button>` : ''}
        ${a.weekly ? `<button class="btn sm" data-agrun="${a.id}" data-mode="weekly" ${b ? 'disabled' : ''}>▶ Недельный разбор</button>` : ''}
      </div>` : ''}
      ${b ? `<div class="muted sm">${esc(b)}</div>` : ''}
    </div>`; }).join('')}</div>`;
  box.querySelectorAll('[data-agon]').forEach(i => i.addEventListener('change', async () => {
    const id = i.dataset.agon; const s = { agents: { ...AG.data.settings.agents } }; s.agents[id] = { ...s.agents[id], on: i.checked };
    try { const r = await agApi('save', { settings: s, by: agUser() }); AG.data.settings = r.settings; AG.data.agents.forEach(a => { a.cfg = r.settings.agents[a.id]; }); agDraw(); } catch (e) { alert(e.message); i.checked = !i.checked; }
  }));
  box.querySelectorAll('[data-agrun]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.agrun, mode = btn.dataset.mode;
    if (!confirm(`Запустить «${(AG.data.agents.find(a => a.id === id) || {}).name}» сейчас? Результат придёт в Telegram-группу агентов.`)) return;
    AG.busy[id] = '⏳ Агент собирает данные и думает (до 2 минут)…'; agDrawAgents();
    try { const r = await agApi('run', { agent: id, mode, send: true }, 290000); AG.busy[id] = `✅ Готово: находок ${r.findings.length}${r.sent ? ', отправлено в Telegram' : ' (группа не подключена)'}`; AG.feed = await agApi('feed', {}); }
    catch (e) { AG.busy[id] = '❌ ' + e.message; }
    agDrawAgents(); setTimeout(() => { delete AG.busy[id]; }, 30000);
  }));
}

// ══════════ ИСТОРИЯ ТОВАРА ══════════
function agDrawUnit() {
  const box = $('agTabBody');
  box.innerHTML = `<div class="card card-pad">
    <div class="ag-filters"><input class="finput" id="agBc" placeholder="Штрихкод экземпляра, например 2000000056036" inputmode="numeric" style="min-width:320px"><button class="btn btn-primary" id="agBcGo">🔎 Показать историю</button></div>
    <div class="muted sm" style="margin:6px 0 12px">Восстановить списанную пару можно в Telegram-группе агентов: «верни &lt;штрихкод&gt; в &lt;склад&gt;» → «Подтвердить».</div>
    <div id="agBcRes"></div></div>`;
  const go = async () => {
    const bc = $('agBc').value.replace(/\D/g, ''); if (!bc) return;
    $('agBcRes').innerHTML = '<div class="loading">⏳ Ищу…</div>';
    try {
      const r = await agApi('unit-history', { barcode: bc });
      if (!r.ok) { $('agBcRes').innerHTML = errBar(r.error); return; }
      const s = r.summary;
      $('agBcRes').innerHTML = `<div class="ag-unit"><div class="ag-uh"><b>${esc(s.product)}</b>${s.size ? ` · р. ${esc(s.size)}` : ''}${s.price ? ` · ${fmtNum(s.price)} с.` : ''}<span class="ag-st ${s.status === 'in_stock' ? 'ok' : s.status === 'written_off' ? 'bad' : ''}">${esc(s.status_ru)}</span><span class="muted">склад: ${esc(s.warehouse)}</span></div>
        ${s.status === 'written_off' ? `<div class="ag-adv ag-wo">Списан ${esc(s.written_off_at || '')}${s.written_off_by ? `, кто: ${esc(s.written_off_by)}` : ''}${s.written_off_reason ? `<br>Причина: ${esc(s.written_off_reason)}` : ''}${s.written_off_in ? `<br>${esc(s.written_off_in)}` : ''}</div>` : ''}
        <div class="ag-tl">${r.events.map(e => `<div class="ag-ev-row k-${esc(e.kind)}"><span class="tnum">${esc(e.at)}</span><span>${esc(e.text)}</span></div>`).join('')}</div></div>`;
    } catch (e) { $('agBcRes').innerHTML = errBar(e.message); }
  };
  $('agBcGo').addEventListener('click', go); $('agBc').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

// ══════════ НАСТРОЙКИ ══════════
function agDrawSettings() {
  const box = $('agTabBody'); const S = AG.data.settings;
  const days = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  box.innerHTML = `<div class="card card-pad ag-set">
    <label class="ag-chk"><input type="checkbox" id="agEn" ${S.enabled ? 'checked' : ''}> Агенты включены</label>
    <label class="ag-chk"><input type="checkbox" id="agUr" ${S.urgent ? 'checked' : ''}> Срочные сообщения сразу (расхождение инкассации, аннулирование, исправление чека, скидка, массовое списание)</label>
    <label class="ag-chk"><input type="checkbox" id="agVe" ${S.verifier ? 'checked' : ''}> Проверяющий ИИ для важных находок (второе мнение, модель — в «Настройки РМК → ИИ-модель»)</label>
    <div class="ag-row"><label>Вечерняя сводка</label><input class="finput" id="agDg" type="time" value="${esc(S.digest)}"></div>
    <div class="ag-row"><label>Недельный разбор</label><select class="fselect" id="agWd">${days.map((d, i) => `<option value="${i}" ${Number(S.weeklyDow) === i ? 'selected' : ''}>${d}</option>`).join('')}</select><input class="finput" id="agWt" type="time" value="${esc(S.weeklyTime)}"></div>
    <div class="ag-row"><label>Тихие часы (без срочных)</label><input class="finput" id="agQf" type="time" value="${esc(S.quietFrom)}"><span class="muted">—</span><input class="finput" id="agQt" type="time" value="${esc(S.quietTo)}"></div>
    <div class="ag-row"><label>Расхождение инкассации от, с.</label><input class="finput" id="agT1" type="number" min="0" value="${S.th.cashDiff}"></div>
    <div class="ag-row"><label>Скидка в чеке от, %</label><input class="finput" id="agT2" type="number" min="0" value="${S.th.discountPct}"></div>
    <div class="ag-row"><label>Массовое списание за 2 часа от, пар</label><input class="finput" id="agT3" type="number" min="1" value="${S.th.writeoffBurst}"></div>
    <div class="ag-row"><label>Нет квитанции инкассации через, мин</label><input class="finput" id="agT4" type="number" min="10" value="${S.th.noIncassMin}"></div>
    <div class="ag-btns"><button class="btn btn-primary" id="agSave">💾 Сохранить</button><span id="agSMsg" class="muted sm"></span></div>
  </div>`;
  $('agSave').addEventListener('click', async () => {
    const s = { enabled: $('agEn').checked, urgent: $('agUr').checked, verifier: $('agVe').checked, digest: $('agDg').value, weeklyDow: Number($('agWd').value), weeklyTime: $('agWt').value, quietFrom: $('agQf').value, quietTo: $('agQt').value, th: { cashDiff: $('agT1').value, discountPct: $('agT2').value, writeoffBurst: $('agT3').value, noIncassMin: $('agT4').value } };
    try { const r = await agApi('save', { settings: s, by: agUser() }); AG.data.settings = r.settings; $('agSMsg').textContent = '✅ Сохранено'; } catch (e) { $('agSMsg').textContent = '❌ ' + e.message; }
  });
}
