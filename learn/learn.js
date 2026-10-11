/* Обучение Ortosalon — маленькое SPA без сборки. Прогресс: localStorage + backend (app_state learn:<ref>). */
(function () {
  'use strict';
  const C = window.LEARN;
  const API = 'https://1c-sync-barcodes.vercel.app/api/pos';
  const SECRET = 'TySog2bN1bMJHsssoTvyCZO3IKOef1z0'; // тот же ключ, что у кассы (app.js)
  const $app = document.getElementById('app');
  const $tab = document.getElementById('tabbar');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ─── иконки ───
  const IC = {
    heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
    kassa: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M8 18h8"/>',
    foot: '<path d="M8 21c-2-3-2-7 0-10 1.5-2.3 1-5 3-6.5S16 4 16 7c0 3-3 4-3 7 0 2 1 3 1 5"/><circle cx="17.5" cy="4" r="1"/><circle cx="19.5" cy="7" r="1"/>',
    dx: '<path d="M4 19V5M4 19h16"/><path d="M7 15l4-5 3 3 5-7"/>',
    shoe: '<path d="M3 16h18v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 16V7l5 1 2 4 6 1c3 .5 5 1.5 5 3"/>',
    money: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9v0M18 15v0"/>',
    quiz: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M9 7h6"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    right: '<path d="M9 5l7 7-7 7"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    q: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h0"/>',
  };
  const shagi = (n) => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'шаг' : [2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100) ? 'шага' : 'шагов');
  const svg = (k) => `<svg viewBox="0 0 24 24">${IC[k] || ''}</svg>`;
  const LOGO = `<svg viewBox="0 0 40 40" aria-label="Ortosalon"><rect width="40" height="40" rx="12" fill="#22A861"/><path d="M14 30c-3-5-1-15 7-17.5 4-1.2 6.5 1.4 5 5-1.5 4.5-7 5-7 9.5 0 2.2 2 3.5 2 3.5" stroke="#fff" stroke-width="3.2" fill="none" stroke-linecap="round"/><circle cx="27.5" cy="9" r="1.8" fill="#fff"/><circle cx="31" cy="13" r="1.5" fill="#fff"/></svg>`;
  const AVA_COLORS = ['#22C17A', '#3A9BF0', '#9B6BF2', '#FF8A3D', '#1EC2B5', '#FF6B6B', '#E6A800', '#7ACC3A'];
  const avaColor = (s) => AVA_COLORS[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % AVA_COLORS.length];
  const initials = (n) => String(n || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const firstName = (n) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[p.length - 1] : p[0]; };

  // ─── состояние ───
  const LS_ME = 'learn:me';
  let me = null; try { me = JSON.parse(localStorage.getItem(LS_ME) || 'null'); } catch (_) {}
  let prog = { lessons: {}, quiz: {} };
  const progKey = () => 'learn:prog:' + (me ? me.ref : 'guest');
  function loadProg() { try { prog = JSON.parse(localStorage.getItem(progKey()) || 'null') || { lessons: {}, quiz: {} }; } catch (_) { prog = { lessons: {}, quiz: {} }; } prog.lessons ||= {}; prog.quiz ||= {}; }
  function saveProg() { localStorage.setItem(progKey(), JSON.stringify(prog)); }
  loadProg();

  async function api(path, opt = {}) {
    const r = await fetch(API + path, { ...opt, headers: { 'X-Provision-Secret': SECRET, 'Content-Type': 'application/json', ...(opt.headers || {}) } });
    return r.json();
  }
  let pushTimer = null, pending = { lessons: {}, quiz: {} };
  function pushLater() {
    if (!me || me.guest) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      const body = { sellerRef: me.ref, sellerName: me.name, ...pending };
      pending = { lessons: {}, quiz: {} };
      try { await api('?action=learn-progress', { method: 'POST', body: JSON.stringify(body) }); } catch (_) { Object.assign(pending.lessons, body.lessons); Object.assign(pending.quiz, body.quiz); }
    }, 800);
  }
  async function pullProg() {
    if (!me || me.guest) return;
    try {
      const d = await api('?action=learn-progress&sellerRef=' + encodeURIComponent(me.ref));
      const srv = d && d.progress;
      if (!srv) { if (Object.keys(prog.lessons).length) { pending.lessons = { ...prog.lessons }; pending.quiz = { ...prog.quiz }; pushLater(); } return; }
      let changed = false;
      for (const [id, st] of Object.entries(srv.lessons || {})) { const l = prog.lessons[id]; if (!l || (st.at || '') > (l.at || '')) { prog.lessons[id] = st; changed = true; } }
      for (const [id, q] of Object.entries(srv.quiz || {})) { const l = prog.quiz[id]; if (!l || (q.at || '') > (l.at || '')) { prog.quiz[id] = q; changed = true; } }
      if (changed) { saveProg(); route(); }
    } catch (_) {}
  }
  function mark(id, s) {
    const st = { s, at: new Date().toISOString() };
    prog.lessons[id] = st; pending.lessons[id] = st; saveProg(); pushLater();
  }

  // ─── единицы обучения ───
  const units = () => [
    ...C.lessons.map((l) => ({ id: l.id, sec: l.sec })),
    ...C.diagnoses.map((d) => ({ id: 'dx:' + d.id, sec: 'dx' })),
    ...C.products.map((p) => ({ id: 'p:' + p.id, sec: 'prod' })),
  ];
  const secUnits = (sec) => units().filter((u) => u.sec === sec);
  const doneCount = (arr) => arr.filter((u) => prog.lessons[u.id] && prog.lessons[u.id].s === 'ok').length;
  const secById = (id) => C.sections.find((s) => s.id === id);

  function toast(t) { const el = document.createElement('div'); el.className = 'toast'; el.textContent = t; document.body.appendChild(el); setTimeout(() => el.remove(), 1800); }
  function setTab(name, show = true) {
    $tab.hidden = !show; $app.classList.toggle('no-tab', !show);
    $tab.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.tab === name));
  }
  const topBar = (title, back = '#/home') => `<div class="top"><a class="icon-btn" href="${back}" aria-label="Назад">${svg('back')}</a><div class="ttl">${esc(title)}</div></div>`;
  function actbar(html) { removeActbar(); const el = document.createElement('div'); el.className = 'actbar'; el.id = 'actbar'; el.innerHTML = `<div class="in">${html}</div>`; document.body.appendChild(el); return el; }
  function removeActbar() { const a = document.getElementById('actbar'); if (a) a.remove(); }
  function pill(id) {
    const st = prog.lessons[id];
    if (st && st.s === 'ok') return '<span class="pill done">Понял ✓</span>';
    if (st && st.s === 'help') return '<span class="pill help">Не понял</span>';
    return '<span class="pill">Начать</span>';
  }

  // ═════════════ ЭКРАНЫ ═════════════
  let sellersCache = null;
  async function viewWho() {
    setTab('', false); removeActbar();
    $app.innerHTML = `
      <div class="hero-who">
        <div class="logo">${LOGO}<div>Ortosalon<small>Обучение сотрудников</small></div></div>
        <h1>Кто вы?</h1>
        <p>Выберите своё имя. Пароль не нужен.</p>
      </div>
      <label class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input id="q" placeholder="Поиск по имени" autocomplete="off"></label>
      <div class="people" id="people"><div class="note">Загружаем список…</div></div>
      <p class="note">Нет вашего имени? Скажите администратору.<br><button class="link-btn" id="guest">Смотреть без имени</button></p>`;
    document.getElementById('guest').onclick = () => choose({ ref: 'guest', name: 'Гость', guest: true });
    try {
      if (!sellersCache) { const d = await api('?action=sellers'); sellersCache = (d.sellers || []).filter((s) => s.name); }
    } catch (_) { sellersCache = sellersCache || []; }
    const draw = (f = '') => {
      const list = sellersCache.filter((s) => s.name.toLowerCase().includes(f.toLowerCase()));
      document.getElementById('people').innerHTML = list.length ? list.map((s) => `
        <button class="person" data-ref="${esc(s.ref)}" data-name="${esc(s.name)}">
          <span class="ava" style="background:${avaColor(s.name)}">${esc(initials(s.name))}</span>
          <span><b>${esc(s.name)}</b><span>${localProgText(s.ref)}</span></span>
          <span class="go">${svg('right')}</span>
        </button>`).join('') : '<div class="note">Никого не нашли. Проверьте интернет или напишите имя иначе.</div>';
      document.querySelectorAll('.person').forEach((b) => (b.onclick = () => choose({ ref: b.dataset.ref, name: b.dataset.name })));
    };
    draw();
    document.getElementById('q').oninput = (e) => draw(e.target.value);
  }
  function localProgText(ref) {
    try { const p = JSON.parse(localStorage.getItem('learn:prog:' + ref) || 'null'); if (p) { const n = Object.values(p.lessons || {}).filter((x) => x.s === 'ok').length; if (n) return `Пройдено: ${n}`; } } catch (_) {}
    return 'Сотрудник';
  }
  function choose(person) {
    me = person; localStorage.setItem(LS_ME, JSON.stringify(me)); loadProg(); pullProg();
    location.hash = '#/home';
  }

  function ring(pct) {
    const r = 27, c = 2 * Math.PI * r;
    return `<div class="ring"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="${r}" stroke="#E1F1E7" stroke-width="8" fill="none"/><circle cx="32" cy="32" r="${r}" stroke="#22A861" stroke-width="8" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}"/></svg><b>${pct}%</b></div>`;
  }
  function nextLesson() {
    const order = [...C.lessons.map((l) => ({ id: l.id, href: '#/l/' + l.id, title: l.title, img: l.img, sec: l.sec })),
      ...C.diagnoses.map((d) => ({ id: 'dx:' + d.id, href: '#/dx/' + d.id, title: d.name, img: d.img, sec: 'dx' }))];
    order.sort((a, b) => C.sections.findIndex((s) => s.id === a.sec) - C.sections.findIndex((s) => s.id === b.sec));
    return order.find((u) => !(prog.lessons[u.id] && prog.lessons[u.id].s === 'ok'));
  }
  function secHref(s) { return s.id === 'quiz' ? '#/quiz' : s.id === 'words' ? '#/words' : '#/s/' + s.id; }

  function viewHome() {
    setTab('home'); removeActbar();
    const all = units(), done = doneCount(all), pct = Math.round((done / all.length) * 100);
    const nx = nextLesson();
    const tops = C.products.filter((p) => p.top);
    $app.innerHTML = `
      <div class="hello">
        <span class="ava" style="background:${avaColor(me.name)}">${esc(initials(me.name))}</span>
        <div><small>Ассалому алейкум,</small><h2>${esc(firstName(me.name))}</h2></div>
        <a class="icon-btn" href="#/me" aria-label="Профиль"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg></a>
      </div>
      <div class="mission">
        <span class="tag">НАША ЦЕЛЬ</span>
        <h3>Помочь пациенту решить его проблему</h3>
        <p>Слушаем, проверяем стопу, подбираем правильно.</p>
        <svg class="deco" viewBox="0 0 120 120" fill="none"><circle cx="70" cy="70" r="50" fill="rgba(255,255,255,.14)"/><path d="M55 100c-8-13-6-38 14-45 10-3 17 3 13 12-4 11-18 12-18 24 0 6 5 9 5 9" stroke="#fff" stroke-width="7" stroke-linecap="round"/><circle cx="88" cy="40" r="5" fill="#fff"/><circle cx="98" cy="52" r="4" fill="#fff"/><circle cx="76" cy="34" r="4" fill="#fff"/></svg>
      </div>
      <div class="prog-card">${ring(pct)}<div><h4>Ваш прогресс</h4><p>Пройдено ${done} из ${all.length} уроков</p></div></div>
      <div class="grid-ic">${C.sections.map((s) => {
        const su = secUnits(s.id); const left = su.length - doneCount(su);
        return `<a class="ic" href="${secHref(s)}"><i class="bg-${s.color}">${svg(s.icon)}${su.length && left === 0 ? '<em>✓</em>' : ''}</i><span>${esc(s.title)}</span></a>`;
      }).join('')}</div>
      ${nx ? `<div class="h-sec"><h3>Продолжить</h3></div>
      <a class="cont" href="${nx.href}"><div class="th">${nx.img ? `<img src="${nx.img}" alt="">` : ''}</div><div class="tx"><small>${esc(secById(nx.sec).title)}</small><b>${esc(nx.title)}</b></div><span class="play"><svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg></span></a>` : `<div class="card" style="margin-top:18px"><h3>Все уроки пройдены 🎉</h3><p>Пройдите тест, чтобы проверить себя.</p></div>`}
      <div class="h-sec"><h3>Касса — главное</h3><a href="#/s/kassa">Все</a></div>
      <div class="hscroll">${C.lessons.filter((l) => l.sec === 'kassa').slice(0, 6).map((l) => `
        <a class="hcard" href="#/l/${l.id}"><div class="pic"><img src="${l.img || 'img/scr/cart.jpg'}" alt="" style="object-position:top"></div><div class="bd"><b>${esc(l.title)}</b><small>${shagi(l.steps.length)} · ${l.min} мин</small></div></a>`).join('')}</div>
      <div class="h-sec"><h3>Частые диагнозы</h3><a href="#/s/dx">Все</a></div>
      <div class="hscroll">${C.diagnoses.slice(0, 6).map((d) => `
        <a class="hcard" href="#/dx/${d.id}"><div class="pic"><img src="${d.img}" alt=""></div><div class="bd"><b>${esc(d.name)}</b><small>${esc(d.short)}</small></div></a>`).join('')}</div>
      <div class="h-sec"><h3>Топ товаров</h3><a href="#/s/prod">Все</a></div>
      <div class="hscroll">${tops.map((p) => `
        <a class="hcard" href="#/p/${p.id}"><div class="pic contain"><img src="${p.img}" alt=""></div><div class="bd"><b>${esc(p.name)}</b><small>${esc(p.for)}</small></div></a>`).join('')}</div>`;
  }

  function viewAll() {
    setTab('all'); removeActbar();
    $app.innerHTML = `<div class="top"><div class="ttl" style="font-size:24px;font-weight:900">Разделы</div></div>
      <div class="list">${C.sections.map((s) => {
        const su = secUnits(s.id); const d = doneCount(su);
        return `<a class="secbar" href="${secHref(s)}"><i class="bg-${s.color}">${svg(s.icon)}</i><div class="tx"><b>${esc(s.title)}</b><div style="font-size:13px;color:var(--muted)">${esc(s.sub)}</div>${su.length ? `<div class="bar"><u style="width:${Math.round((d / su.length) * 100)}%"></u></div>` : ''}</div>${su.length ? `<small>${d}/${su.length}</small>` : ''}</a>`;
      }).join('')}</div>`;
  }

  function secHero(s, su) {
    const d = doneCount(su);
    return `<div class="sec-hero bg-${s.color}"><i>${svg(s.icon)}</i><div style="flex:1"><h2>${esc(s.title)}</h2><p>${esc(s.sub)} · ${d} из ${su.length}</p><div class="bar"><u style="width:${su.length ? Math.round((d / su.length) * 100) : 0}%"></u></div></div></div>`;
  }
  function viewSection(id) {
    const s = secById(id); if (!s) return go('#/home');
    setTab('all'); removeActbar();
    const su = secUnits(id);
    let body = '';
    if (id === 'dx') {
      body = `<div class="disclaimer">Мы делаем скрининг стопы, а не ставим медицинский диагноз. Сложные случаи — к врачу-ортопеду. Цифры — сколько раз диагноз был в наших диагностиках.</div>
        <div class="list">${C.diagnoses.map((d) => `<a class="row" href="#/dx/${d.id}"><span class="th"><img src="${d.img}" alt=""></span><span class="tx"><b>${esc(d.name)}</b><small>${esc(d.short)} · ${d.count} раз</small></span>${pill('dx:' + d.id)}</a>`).join('')}</div>`;
    } else if (id === 'prod') {
      return viewProducts();
    } else {
      body = `<div class="list">${C.lessons.filter((l) => l.sec === id).map((l, i) => `<a class="row" href="#/l/${l.id}"><span class="th">${l.img ? `<img src="${l.img}" alt="" style="object-position:top">` : `<span class="n">${i + 1}</span>`}</span><span class="tx"><b>${esc(l.title)}</b><small>${shagi(l.steps.length)} · ${l.min} мин</small></span>${pill(l.id)}</a>`).join('')}</div>
        <div style="margin-top:16px"><a class="btn pri" href="#/quiz/${id}" style="height:50px">${svg('quiz')} Тест по разделу</a></div>`;
    }
    $app.innerHTML = topBar(s.title) + secHero(s, su) + body;
  }

  let prodFilter = 'all';
  function viewProducts() {
    const s = secById('prod');
    setTab('all'); removeActbar();
    const list = C.products.filter((p) => prodFilter === 'all' || (prodFilter === 'top' ? p.top : p.g === prodFilter));
    $app.innerHTML = topBar('Товары') + secHero(s, secUnits('prod')) + `
      <div class="chips">${[['all', 'Все'], ['top', 'Топ'], ...C.prodGroups.map((g) => [g.id, g.title])].map(([k, t]) => `<button class="chip ${prodFilter === k ? 'on' : ''}" data-f="${k}">${esc(t)}</button>`).join('')}</div>
      <div class="pgrid">${list.map((p) => `<a class="pcard" href="#/p/${p.id}"><div class="pic"><img src="${p.img}" alt="" loading="lazy"></div><div class="bd">${p.top ? '<span class="badge-top">ТОП продаж</span>' : ''}<b>${esc(p.name)}</b><small>${esc(p.for)}</small></div></a>`).join('')}</div>`;
    $app.querySelectorAll('.chip').forEach((b) => (b.onclick = () => { prodFilter = b.dataset.f; viewProducts(); }));
  }

  function stepHtml(l, i) {
    const st = l.steps[i];
    let media = '';
    if (st.img) {
      media = st.kind === 'phone'
        ? `<div class="media"><div class="phone"><img src="${st.img}" alt="${esc(st.t)}" data-zoom></div></div><div class="zoom-hint">Нажмите на экран, чтобы увеличить</div>`
        : `<div class="media photo"><img src="${st.img}" alt="${esc(st.t)}" data-zoom></div>`;
    } else if (st.visual === 'card') {
      media = `<div class="media"><div style="width:min(300px,80vw);aspect-ratio:1.6;border-radius:18px;background:linear-gradient(135deg,#1FA65C,#2CC07A);color:#fff;padding:16px;display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 12px 24px rgba(34,168,97,.3)"><b style="font-size:18px">Ortosalon</b><div style="background:#fff;border-radius:8px;height:46px;display:flex;align-items:center;justify-content:center;gap:2px;padding:6px">${Array.from({ length: 34 }, (_, k) => `<span style="width:${k % 3 ? 2 : 4}px;height:100%;background:#15261C"></span>`).join('')}</div><span style="font-size:13px;font-weight:800">−10% · 120 баллов</span></div></div>`;
    } else if (st.visual === 'steps') {
      media = `<div class="media"><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">${['Пациент', 'Диагностика', 'Товары', 'Отчёт'].map((t, k) => `<div style="background:#fff;border-radius:14px;padding:10px 12px;text-align:center;box-shadow:var(--sh-s);min-width:70px"><div style="width:30px;height:30px;border-radius:50%;background:var(--pri);color:#fff;font-weight:900;display:grid;place-items:center;margin:0 auto 4px">${k + 1}</div><b style="font-size:13px">${t}</b></div>`).join('')}</div></div>`;
    }
    return `<div class="step">${media}<div class="bd">
      <span class="num">Шаг ${i + 1} из ${l.steps.length}</span>
      <h2>${esc(st.t)}</h2>${st.x ? `<p>${esc(st.x)}</p>` : ''}
      ${st.list ? `<ul>${st.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${st.say ? `<div class="say"><b>Скажите клиенту</b>«${esc(st.say)}»</div>` : ''}
      ${st.tip ? `<div class="tip"><b>Подсказка</b>${esc(st.tip)}</div>` : ''}
      ${st.warn ? `<div class="warn"><b>Важно</b>${esc(st.warn)}</div>` : ''}
      ${st.tpl ? `<div class="tpl"><b>Образец</b><pre>${esc(st.tpl)}</pre><button class="copy" data-copy="${esc(st.tpl)}">Скопировать</button></div>` : ''}
    </div></div>`;
  }
  function viewLesson(id, stepStr) {
    const l = C.lessons.find((x) => x.id === id); if (!l) return go('#/home');
    const i = Math.max(0, Math.min(l.steps.length - 1, parseInt(stepStr || '0', 10) || 0));
    setTab('', false);
    $app.innerHTML = topBar(l.title, '#/s/' + l.sec) +
      `<div class="steps-dots">${l.steps.map((_, k) => `<u class="${k <= i ? 'on' : ''}"></u>`).join('')}</div>` + stepHtml(l, i);
    const last = i === l.steps.length - 1;
    const bar = last
      ? actbar(`<button class="btn yel" id="help">${svg('q')} Не понял</button><button class="btn pri" id="ok">${svg('check')} Понял</button>`)
      : actbar(`<button class="btn gh" id="prev" ${i === 0 ? 'disabled' : ''}>${svg('back')}</button><button class="btn pri" id="next">Дальше ${svg('right')}</button>`);
    if (last) {
      bar.querySelector('#ok').onclick = () => { mark(l.id, 'ok'); toast('Отлично! Урок пройден'); const nx = nextLesson(); go(nx ? nx.href : '#/s/' + l.sec); };
      bar.querySelector('#help').onclick = () => { mark(l.id, 'help'); toast('Отмечено. Спросите старшего — он объяснит'); go('#/s/' + l.sec); };
    } else {
      bar.querySelector('#next').onclick = () => go(`#/l/${l.id}/${i + 1}`);
      const p = bar.querySelector('#prev'); if (p) p.onclick = () => go(`#/l/${l.id}/${i - 1}`);
    }
    bindCommon();
  }

  function viewDx(id) {
    const d = C.diagnoses.find((x) => x.id === id); if (!d) return go('#/s/dx');
    setTab('', false);
    const pr = (d.prods || []).map((k) => C.products.find((p) => p.id === k)).filter(Boolean);
    const isPhoto = !d.img.includes('/prod/');
    $app.innerHTML = topBar(d.name, '#/s/dx') + `
      <div class="dx-head ${d.img2 ? '' : 'one'}">
        <figure class="${isPhoto ? '' : 'contain'}"><img src="${d.img}" alt="${esc(d.name)}" data-zoom>${isPhoto ? '<figcaption>Наша диагностика</figcaption>' : ''}</figure>
        ${d.img2 ? `<figure><img src="${d.img2}" alt="" data-zoom><figcaption>${d.id === 'plosko' ? 'Для сравнения: норма' : 'Ещё пример'}</figcaption></figure>` : ''}
      </div>
      <div class="stat"><div><b>${d.count}</b><small>раз у нас</small></div><div><b>${d.kids}%</b><small>это дети</small></div></div>
      <div class="card"><h3><span class="dot" style="background:var(--c-blue)"></span>Простыми словами</h3><p>${esc(d.simple)}</p></div>
      <div class="card"><h3><span class="dot" style="background:var(--c-orange)"></span>Как заметить</h3><ul style="margin:6px 0 0;padding-left:20px">${d.signs.map((x) => `<li style="margin:4px 0">${esc(x)}</li>`).join('')}</ul></div>
      <div class="card"><h3><span class="dot" style="background:var(--c-green)"></span>Что поможет</h3><p>${esc(d.help)}</p>
        ${pr.length ? `<div class="minis">${pr.map((p) => `<a class="mini" href="#/p/${p.id}"><div class="pic"><img src="${p.img}" alt=""></div><b>${esc(p.name)}</b></a>`).join('')}</div>` : ''}</div>
      <div class="say" style="margin-top:0"><b>Скажите клиенту</b>«${esc(d.say)}»</div>
      ${d.doctor ? '<div class="warn"><b>Важно</b>Посоветуйте показаться врачу-ортопеду. Мы помогаем изделиями, лечение назначает врач.</div>' : ''}`;
    dualBar('dx:' + d.id, '#/s/dx');
    bindCommon();
  }

  function viewProduct(id) {
    const p = C.products.find((x) => x.id === id); if (!p) return go('#/s/prod');
    setTab('', false);
    const dxs = C.diagnoses.filter((d) => (d.prods || []).includes(p.id));
    $app.innerHTML = topBar(p.name, '#/s/prod') + `
      <div class="p-hero"><img src="${p.img}" alt="${esc(p.name)}" data-zoom></div>
      <div class="kv">
        <div class="card"><div class="lbl">Для чего</div><p><b>${esc(p.for)}</b></p></div>
        <div class="card"><div class="lbl">Кому</div><p>${esc(p.who)}</p></div>
        <div class="card"><div class="lbl">Чем помогает</div><p>${esc(p.how)}</p></div>
        <div class="card"><div class="lbl">Как подобрать</div><p>${esc(p.fit)}</p></div>
        ${dxs.length ? `<div class="card"><div class="lbl">При каких диагнозах</div><div class="chips" style="margin:6px 0 0;padding:0;flex-wrap:wrap">${dxs.map((d) => `<a class="chip" href="#/dx/${d.id}">${esc(d.name)}</a>`).join('')}</div></div>` : ''}
      </div>
      <div class="say"><b>Скажите клиенту</b>«${esc(p.say)}»</div>
      <p class="note">Цену и размеры смотрите в кассе: «Ещё» → «Поиск товара».</p>`;
    dualBar('p:' + p.id, '#/s/prod');
    bindCommon();
  }
  function dualBar(uid, back) {
    const bar = actbar(`<button class="btn yel" id="help">${svg('q')} Не понял</button><button class="btn pri" id="ok">${svg('check')} Понял</button>`);
    bar.querySelector('#ok').onclick = () => { mark(uid, 'ok'); toast('Отлично!'); go(back); };
    bar.querySelector('#help').onclick = () => { mark(uid, 'help'); toast('Отмечено. Спросите старшего'); go(back); };
  }

  // ─── тест ───
  let qz = null;
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function startQuiz(sec) {
    const pool = sec ? C.quiz.filter((q) => q.sec === sec) : shuffle(C.quiz).slice(0, 10);
    qz = { sec: sec || 'all', list: sec ? pool : pool, i: 0, score: 0, picked: null };
  }
  function viewQuiz(sec) {
    setTab('', false);
    if (!qz || qz.sec !== (sec || 'all') || qz.done) startQuiz(sec);
    const back = sec ? '#/s/' + sec : '#/home';
    const title = sec ? 'Тест: ' + secById(sec).title : 'Общий тест';
    if (qz.i >= qz.list.length) {
      const tot = qz.list.length, sc = qz.score;
      const q = { score: sc, total: tot, at: new Date().toISOString() };
      prog.quiz[qz.sec] = { ...q, best: Math.max(sc, (prog.quiz[qz.sec] && prog.quiz[qz.sec].best) || 0) }; pending.quiz[qz.sec] = q; saveProg(); pushLater();
      qz.done = true;
      $app.innerHTML = topBar(title, back) + `<div class="q-card result"><div class="big">${sc}/${tot}</div><h2 style="margin-top:10px">${sc === tot ? 'Отлично!' : sc >= tot * 0.7 ? 'Хорошо!' : 'Повторите уроки'}</h2><p>${sc >= tot * 0.7 ? 'Вы хорошо знаете этот раздел.' : 'Ничего страшного. Прочитайте уроки ещё раз и попробуйте снова.'}</p></div>`;
      const bar = actbar(`<button class="btn gh" id="b" style="flex:1">Назад</button><button class="btn pri" id="r">Ещё раз</button>`);
      bar.querySelector('#b').onclick = () => go(back);
      bar.querySelector('#r').onclick = () => { qz = null; viewQuiz(sec); };
      return;
    }
    const q = qz.list[qz.i];
    $app.innerHTML = topBar(title, back) + `
      <div class="steps-dots">${qz.list.map((_, k) => `<u class="${k <= qz.i ? 'on' : ''}"></u>`).join('')}</div>
      <div class="q-card"><div class="meta"><span>Вопрос ${qz.i + 1} из ${qz.list.length}</span><span>${esc(secById(q.sec).title)}</span></div><h2>${esc(q.q)}</h2></div>
      <div class="answers">${q.a.map((a, k) => `<button class="ans" data-k="${k}"><i>${'ABCD'[k]}</i><span>${esc(a)}</span></button>`).join('')}</div>`;
    qz.picked = null;
    const bar = actbar(`<button class="btn pri" id="chk" disabled>Проверить</button>`);
    const btn = bar.querySelector('#chk');
    let checked = false;
    $app.querySelectorAll('.ans').forEach((b) => (b.onclick = () => {
      if (checked) return;
      $app.querySelectorAll('.ans').forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); qz.picked = +b.dataset.k; btn.disabled = false;
    }));
    btn.onclick = () => {
      if (!checked) {
        checked = true;
        const ok = qz.picked === q.ok; if (ok) qz.score++;
        $app.querySelectorAll('.ans').forEach((x) => { const k = +x.dataset.k; if (k === q.ok) x.classList.add('ok'); else if (k === qz.picked) x.classList.add('bad'); });
        btn.innerHTML = (ok ? '✓ Верно! ' : 'Неверно. ') + 'Дальше';
        btn.className = ok ? 'btn pri' : 'btn yel';
      } else { qz.i++; viewQuiz(sec); }
    };
  }

  function viewWords() {
    setTab('all'); removeActbar();
    $app.innerHTML = topBar('Словарик') + `<div class="sec-hero bg-lime"><i>${svg('book')}</i><div><h2>Словарик</h2><p>Трудные слова — простыми словами</p></div></div>
      <div class="list">${C.words.map(([w, d]) => `<div class="word"><b>${esc(w)}</b><span>${esc(d)}</span></div>`).join('')}</div>`;
  }

  function viewMe() {
    setTab('me'); removeActbar();
    const helps = Object.entries(prog.lessons).filter(([, v]) => v.s === 'help').map(([k]) => k);
    const nameOf = (uid) => { if (uid.startsWith('dx:')) { const d = C.diagnoses.find((x) => 'dx:' + x.id === uid); return d && [d.name, '#/dx/' + d.id]; } if (uid.startsWith('p:')) { const p = C.products.find((x) => 'p:' + x.id === uid); return p && [p.name, '#/p/' + p.id]; } const l = C.lessons.find((x) => x.id === uid); return l && [l.title, '#/l/' + l.id]; };
    $app.innerHTML = `<div class="me-head"><span class="ava" style="background:${avaColor(me.name)};display:grid">${esc(initials(me.name))}</span><h2>${esc(me.name)}</h2><p class="note" style="margin:4px 0 0">${me.guest ? 'Гость — прогресс сохраняется только на этом телефоне' : 'Прогресс видит руководитель'}</p></div>
      <div class="h-sec"><h3>Мой прогресс</h3></div>
      <div class="list">${C.sections.filter((s) => secUnits(s.id).length).map((s) => { const su = secUnits(s.id), d = doneCount(su); return `<a class="secbar" href="${secHref(s)}"><i class="bg-${s.color}">${svg(s.icon)}</i><div class="tx"><b>${esc(s.title)}</b><div class="bar"><u style="width:${Math.round((d / su.length) * 100)}%"></u></div></div><small>${d}/${su.length}</small></a>`; }).join('')}</div>
      ${Object.keys(prog.quiz).length ? `<div class="h-sec"><h3>Тесты</h3></div><div class="list">${Object.entries(prog.quiz).map(([k, q]) => `<div class="secbar"><i class="bg-teal">${svg('quiz')}</i><div class="tx"><b>${k === 'all' ? 'Общий тест' : esc((secById(k) || {}).title || k)}</b></div><small>${q.score}/${q.total}</small></div>`).join('')}</div>` : ''}
      ${helps.length ? `<div class="h-sec"><h3>Не понял — повторить</h3></div><div class="list">${helps.map((h) => nameOf(h)).filter(Boolean).map(([t, href]) => `<a class="row" href="${href}"><span class="tx"><b>${esc(t)}</b></span><span class="pill help">Повторить</span></a>`).join('')}</div>` : ''}
      <div style="margin-top:20px;display:grid;gap:10px"><button class="btn gh" style="flex:1;height:50px" id="sw">Сменить сотрудника</button><a class="btn gh" style="height:50px" href="#/team">Прогресс команды</a><a class="btn gh" style="height:50px" href="/">Открыть кассу</a></div>`;
    document.getElementById('sw').onclick = () => { localStorage.removeItem(LS_ME); me = null; go('#/who'); };
  }

  async function viewTeam() {
    setTab('me'); removeActbar();
    $app.innerHTML = topBar('Прогресс команды', '#/me') + '<div class="note">Загружаем…</div>';
    let items = [];
    try { const d = await api('?action=learn-progress-all'); items = d.items || []; } catch (_) {}
    const total = units().length;
    items.sort((a, b) => cnt(b) - cnt(a));
    function cnt(it) { return Object.values(it.lessons || {}).filter((x) => x.s === 'ok').length; }
    $app.innerHTML = topBar('Прогресс команды', '#/me') + (items.length ? `<div class="list">${items.map((it) => {
      const ok = cnt(it), help = Object.values(it.lessons || {}).filter((x) => x.s === 'help').length;
      const q = Object.values(it.quiz || {}); const qs = q.reduce((a, x) => a + x.score, 0), qt = q.reduce((a, x) => a + x.total, 0);
      return `<div class="secbar"><span class="ava" style="background:${avaColor(it.name)};width:40px;height:40px;font-size:15px">${esc(initials(it.name))}</span><div class="tx"><b>${esc(it.name || it.sellerRef)}</b><div class="bar"><u style="width:${Math.round((ok / total) * 100)}%"></u></div><div style="font-size:12.5px;color:var(--muted);margin-top:3px">${ok} из ${total}${help ? ` · не понял: ${help}` : ''}${qt ? ` · тесты ${qs}/${qt}` : ''}</div></div><small>${Math.round((ok / total) * 100)}%</small></div>`;
    }).join('')}</div>` : '<div class="note">Пока никто не начал обучение.</div>');
  }

  function bindCommon() {
    $app.querySelectorAll('[data-zoom]').forEach((img) => (img.onclick = () => {
      const v = document.createElement('div'); v.className = 'viewer'; v.innerHTML = `<img src="${img.getAttribute('src')}" alt="">`; v.onclick = () => v.remove(); document.body.appendChild(v);
    }));
    $app.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('Скопировано'); } catch (_) { toast('Не удалось скопировать'); }
    }));
  }

  function go(h) { if (location.hash === h) route(); else location.hash = h; }
  function route() {
    const h = location.hash.replace(/^#\/?/, '');
    const [a, b, c] = h.split('/');
    window.scrollTo(0, 0);
    if (!me) return viewWho();
    switch (a) {
      case 'who': return viewWho();
      case 'all': return viewAll();
      case 's': return viewSection(b);
      case 'l': return viewLesson(b, c);
      case 'dx': return viewDx(b);
      case 'p': return viewProduct(b);
      case 'quiz': return viewQuiz(b);
      case 'words': return viewWords();
      case 'me': return viewMe();
      case 'team': return viewTeam();
      default: return viewHome();
    }
  }
  window.addEventListener('hashchange', route);
  route();
  if (me) pullProg();
})();
