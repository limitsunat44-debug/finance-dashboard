/* ============================================================================
   РМК · КАССА — «Задачи» и «Узнать место товара»
   Backend: https://1c-sync-barcodes.vercel.app/api/tasks?action=...
   Задачи приходят автоматически: продали пару с витрины (планограмма) → «Секция · Полка · Место пустое,
   поставьте товар». Выполнение — скан пары (она привязывается к месту). За задачу — баллы.
   Использует глобальные POS, BARCODE_SVC_URL, BARCODE_SVC_SECRET, posShopWh(), pmobSellerRef() из app.js.
   ============================================================================ */
(function () {
  'use strict';
  const API = () => (typeof BARCODE_SVC_URL !== 'undefined' ? BARCODE_SVC_URL : 'https://1c-sync-barcodes.vercel.app') + '/api/tasks';
  const SECRET = () => (typeof BARCODE_SVC_SECRET !== 'undefined' ? BARCODE_SVC_SECRET : '');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (id) => document.getElementById(id);
  const TK = { tab: 'mine', chip: 'all', data: null, task: null, scan: null, mode: null, busy: false, badge: 0, timer: null, after: null };

  function ctx() {
    const sh = (typeof POS !== 'undefined' && POS.shift) || {};
    const whc1 = (typeof posShopWh === 'function' && posShopWh()) || sh.sale_warehouse_c1_ref || '';
    const ref = (typeof pmobSellerRef === 'function' && pmobSellerRef()) || sh.seller_c1_ref || '';
    return { whc1, sellerRef: ref, sellerName: sh.seller_name || '', open: !!(sh && sh.id) };
  }
  async function api(action, params, body) {
    const c = ctx();
    const qs = new URLSearchParams({ action, whc1: c.whc1, sellerRef: c.sellerRef, ...(params || {}) });
    const opt = { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Provision-Secret': SECRET() } };
    if (body) opt.body = JSON.stringify({ whc1: c.whc1, sellerRef: c.sellerRef, sellerName: c.sellerName, ...body });
    const r = await fetch(API() + '?' + qs.toString(), opt);
    const d = await r.json().catch(() => ({ ok: false, error: 'Нет связи с сервером' }));
    if (!d.ok) throw new Error(d.error || ('Ошибка ' + r.status));
    return d;
  }
  let toastT = null;
  function toast(msg, err) {
    let t = $('tkToast'); if (!t) return;
    t.textContent = msg; t.className = 'tk-toast show' + (err ? ' err' : '');
    clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'tk-toast'; }, 3200);
  }
  const PRIO_CLS = { high: 'hi', mid: 'mid', low: 'lo' };
  const ICON = {
    back: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.4"/></svg>',
    clock: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    cam: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.4-2h6.2l1.4 2h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.4"/></svg>',
    tasks: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="3.5" width="15" height="17" rx="2.5"/><path d="M8.5 9l1.6 1.6L13 7.7M8.5 15l1.6 1.6L13 13.7M15 9.5h1.5M15 15.5h1.5"/></svg>',
    store: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5.5 11.5V20h13v-8.5M10 20v-4.5h4V20"/></svg>',
    note: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4"/></svg>',
    box: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/></svg>',
    gift: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8c-1.5-3-5-3.5-5-1.2C7 8 9.5 8 12 8zm0 0c1.5-3 5-3.5 5-1.2C17 8 14.5 8 12 8z"/></svg>',
  };

  // ── каркас ──────────────────────────────────────────────
  function mount() {
    if ($('tkRoot')) return;
    const root = document.createElement('div');
    root.id = 'tkRoot'; root.className = 'tk-root'; root.style.display = 'none';
    root.innerHTML = `
      <section class="tk-scr" id="tkList">
        <header class="tk-head"><button class="tk-ib" data-tk="close" aria-label="Назад">${ICON.back}</button><h1>Задачи</h1><button class="tk-ib tk-help" data-tk="help" aria-label="Справка">?</button></header>
        <div class="tk-tabs" id="tkTabs">
          <button data-tab="mine" class="on">Мои задачи <i id="tkTabMineN"></i></button><button data-tab="all">Все</button><button data-tab="history">История</button>
        </div>
        <div class="tk-chips" id="tkChips"></div>
        <div class="tk-items" id="tkItems"><div class="tk-empty">Загрузка…</div></div>
      </section>
      <section class="tk-scr" id="tkDetail" style="display:none">
        <header class="tk-head"><button class="tk-ib" data-tk="tolist" aria-label="Назад">${ICON.back}</button><h1>Задача</h1><span class="tk-ib"></span></header>
        <div class="tk-dbody" id="tkDBody"></div>
        <footer class="tk-foot" id="tkDFoot"></footer>
      </section>
      <section class="tk-scr tk-scan" id="tkScan" style="display:none">
        <header class="tk-head tk-dark"><button class="tk-ib" data-tk="scanback" aria-label="Назад">${ICON.back}</button><h1 id="tkScanTitle">Сканирование</h1><span class="tk-ib"></span></header>
        <p class="tk-scan-cap" id="tkScanCap">Наведите камеру на штрихкод</p>
        <div class="tk-cam"><div id="tkReader"></div><div class="tk-frame"><i></i><i></i><i></i><i></i></div></div>
        <div class="tk-manual"><input id="tkCode" inputmode="numeric" autocomplete="off" placeholder="или введите штрихкод / последние цифры"><button id="tkCodeGo">OK</button></div>
        <div class="tk-scan-extra" id="tkScanExtra"></div>
        <div class="tk-locres" id="tkLocRes"></div>
      </section>
      <section class="tk-scr tk-done" id="tkDone" style="display:none">
        <header class="tk-head"><span class="tk-ib"></span><h1></h1><button class="tk-ib" data-tk="tolist" aria-label="Закрыть">${ICON.close}</button></header>
        <div class="tk-done-body" id="tkDoneBody"></div>
      </section>
      <div class="tk-toast" id="tkToast"></div>`;
    document.body.appendChild(root);
    root.addEventListener('click', onClick);
    $('tkCodeGo').addEventListener('click', () => { const v = $('tkCode').value.trim(); if (v) onCode(v); });
    $('tkCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = e.target.value.trim(); if (v) onCode(v); } });
  }
  function show(id) {
    ['tkList', 'tkDetail', 'tkScan', 'tkDone'].forEach(x => { const el = $(x); if (el) el.style.display = x === id ? '' : 'none'; });
    if (id !== 'tkScan') stopCam();
  }
  function openRoot() { mount(); $('tkRoot').style.display = ''; document.body.classList.add('tk-on'); }
  function closeRoot() { stopCam(); const r = $('tkRoot'); if (r) r.style.display = 'none'; document.body.classList.remove('tk-on'); refreshBadge(); }

  // ── список ──────────────────────────────────────────────
  async function openTasks() {
    const c = ctx();
    if (!c.open) { alert('Сначала откройте смену'); return; }
    openRoot(); show('tkList'); await loadList();
  }
  async function loadList() {
    const box = $('tkItems'); if (!TK.data) box.innerHTML = '<div class="tk-empty">Загрузка…</div>';
    try { TK.data = await api('list'); setBadge(TK.data.badge); renderList(); }
    catch (e) { box.innerHTML = `<div class="tk-empty">Не удалось загрузить: ${esc(e.message)}</div>`; }
  }
  function curArr() { const d = TK.data || {}; return TK.tab === 'mine' ? (d.mine || []) : TK.tab === 'all' ? (d.all || []) : (d.history || []); }
  function renderList() {
    const d = TK.data || {};
    document.querySelectorAll('#tkTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === TK.tab));
    const n = (d.mine || []).filter(t => !t.snoozed).length; $('tkTabMineN').textContent = n ? n : ''; $('tkTabMineN').style.display = n ? '' : 'none';
    const arr = curArr();
    const cnt = { all: arr.length, showcase: arr.filter(t => t.type === 'showcase').length, stock: arr.filter(t => t.type === 'stock').length, other: arr.filter(t => t.type === 'other').length };
    $('tkChips').innerHTML = [['all', 'Все'], ['showcase', 'Витрины'], ['stock', 'Склад'], ['other', 'Другое']]
      .map(([k, l]) => `<button data-chip="${k}" class="${TK.chip === k ? 'on' : ''}">${l} <i>${cnt[k]}</i></button>`).join('');
    const list = arr.filter(t => TK.chip === 'all' || t.type === TK.chip);
    if (!list.length) {
      $('tkItems').innerHTML = `<div class="tk-empty">${TK.tab === 'history' ? 'Выполненных задач пока нет' : '<b>Все задачи выполнены</b><br>Новые появятся, когда с витрины продадут товар'}</div>`;
      return;
    }
    $('tkItems').innerHTML = list.map(cardHtml).join('');
  }
  function placeLine(t) {
    const p = t.place || {};
    const parts = [TK.data && TK.data.shop, p.fixture, p.n ? 'Полка ' + p.n : '', p.k ? 'Место ' + p.k : ''].filter(Boolean);
    return parts.join(' · ');
  }
  function thumb(t) {
    if (t.product && t.product.photo) return `<img src="${esc(t.product.photo)}" alt="" loading="lazy">`;
    return `<span class="tk-thico">${t.kind === 'check' ? ICON.store : (t.kind === 'restock' || t.type === 'stock') ? ICON.box : ICON.note}</span>`;
  }
  function statusPill(t) {
    if (t.status === 'done') return '<span class="tk-st ok">Выполнено</span>';
    if (t.status === 'review') return '<span class="tk-st rv">На проверке</span>';
    if (t.status === 'rejected') return '<span class="tk-st no">Отклонено</span>';
    return '';
  }
  function cardHtml(t) {
    const hist = TK.tab === 'history';
    const when = hist && t.doneAt ? new Date(t.doneAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    const assignee = TK.tab === 'all' && t.assignee ? `<span class="tk-who">→ ${esc(t.assignee.name)}</span>` : '';
    return `<button class="tk-card${t.snoozed ? ' snz' : ''}" data-open="${esc(t.id)}">
      <span class="tk-th">${thumb(t)}</span>
      <span class="tk-cb">
        <b class="tk-ct">${esc(t.title)}</b>
        ${hist ? statusPill(t) : `<span class="tk-pr ${PRIO_CLS[t.prio]}">${esc(t.prioLabel)}</span>`}${assignee}
        <span class="tk-cp">${esc(placeLine(t) || t.desc.slice(0, 60))}</span>
        <span class="tk-cm">${hist ? esc(when) : (t.minutes ? ICON.clock + ' ' + t.minutes + ' мин' : (t.due ? 'до ' + fmtDay(t.due) : ''))}<em>+${t.points} баллов</em>${t.snoozed ? '<u>отложено</u>' : ''}</span>
      </span>
      <span class="tk-chev">${ICON.chev}</span>
    </button>`;
  }
  const fmtDay = (ymd) => { const [y, m, d] = String(ymd).split('-'); return `${d}.${m}`; };

  // ── карточка задачи ─────────────────────────────────────
  async function openTask(id) {
    show('tkDetail');
    const all = [...((TK.data && TK.data.mine) || []), ...((TK.data && TK.data.all) || []), ...((TK.data && TK.data.history) || [])];
    const pre = all.find(t => t.id === id);
    if (pre) { TK.task = pre; renderTask(true); }
    else $('tkDBody').innerHTML = '<div class="tk-empty">Загрузка…</div>';
    try { const d = await api('get', { id }); TK.task = d.task; renderTask(false); }
    catch (e) { toast(e.message, true); }
  }
  function stripHtml(strip, big) {
    if (!strip || !strip.length) return '';
    return `<div class="tk-strip${big ? ' big' : ''}">${strip.map(s => `<div class="tk-slot${s.hi ? ' hi' : ''}${!s.filled ? ' empty' : ''}">
      ${s.photo && s.filled ? `<img src="${esc(s.photo)}" alt="" loading="lazy">` : (s.filled ? `<span class="tk-noph">${esc((s.name || '').slice(0, 18))}</span>` : `<span class="tk-noph">${s.hi ? 'Пусто' : (s.p ? 'Пусто' : 'Свободно')}</span>`)}
      <em>${s.k}</em></div>`).join('')}</div>`;
  }
  function mapSvg(map) {
    if (!map || !map.fixtures) return '';
    const poly = map.polygon || [[0, 0], [10, 0], [10, 6], [0, 6]];
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    const x0 = Math.min(...xs) - .3, y0 = Math.min(...ys) - .3, w = Math.max(...xs) - x0 + .3, h = Math.max(...ys) - y0 + .3;
    const fx = map.fixtures.map(f => `<g transform="translate(${f.x} ${f.y}) rotate(${f.rot})"><rect x="${-f.w / 2}" y="${-f.d / 2}" width="${f.w}" height="${f.d}" rx=".06" class="${f.hi ? 'hi' : (f.type === 'cash' ? 'cash' : '')}"/></g>${f.hi ? `<text x="${f.x}" y="${f.y + (f.rot % 180 ? f.w / 2 : f.d / 2) + .55}" text-anchor="middle">${esc(f.name)}</text>` : ''}`).join('');
    return `<svg class="tk-map" viewBox="${x0} ${y0} ${w} ${h + .6}" preserveAspectRatio="xMidYMid meet"><polygon points="${poly.map(p => p.join(',')).join(' ')}" class="zone"/>${fx}</svg>`;
  }
  function renderTask(prelim) {
    const t = TK.task; if (!t) return;
    const p = t.place || {}, pr = t.product || null;
    const open = t.status === 'open';
    let hero = '';
    if (t.strip) hero = `<div class="tk-hero">${stripHtml(t.strip, true)}<div class="tk-hero-cap">${esc(p.fixture || '')} · Полка ${p.n} — место ${p.k} выделено</div></div>`;
    else if (t.kind === 'restock' && pr && pr.photo) hero = `<div class="tk-hero"><img class="tk-hero-img" src="${esc(pr.photo)}" alt=""></div>`;
    let body = hero + `<div class="tk-dh"><h2>${esc(t.kind === 'restock' ? (p.zone === 'stock' ? 'Разложить на складе' : 'Пополнить товар на витрине') : t.title)}</h2><span class="tk-pr ${PRIO_CLS[t.prio]}">${esc(t.prioLabel)}</span></div>`;
    if (p.fixture) body += `<div class="tk-loc">${ICON.pin}<span><b>${esc((t.shop || (TK.data && TK.data.shop) || ''))}</b><br>${esc([p.fixture, p.n ? 'Полка ' + p.n : '', p.k ? 'Место ' + p.k : ''].filter(Boolean).join(' · '))}${p.category ? ' · ' + esc(p.category) : ''}</span></div>`;
    if (t.kind === 'restock' && pr) {
      body += `<div class="tk-sec">Товар</div><div class="tk-prod">${pr.photo ? `<img src="${esc(pr.photo)}" alt="">` : `<span class="tk-thico">${ICON.box}</span>`}<span><b>${esc(pr.name)}</b>${pr.sku ? `<i>Артикул: ${esc(pr.sku)}</i>` : ''}<i>${pr.noStock ? '<span class="tk-warn">В магазине нет — поставьте похожий товар</span>' : 'Размеры в магазине: ' + esc((pr.sizes || []).join(', ') || '—')}</i></span></div>`;
      body += `<div class="tk-need"><span>Нужно поставить</span><b>${t.need || 1} шт.</b></div>`;
      if ((t.gone || []).length) body += `<div class="tk-small">Ушли с места: ${t.gone.map(g => esc(g.size) + (g.st === 'sold' ? ' (продана)' : '')).join(', ')}</div>`;
      if (t.placed) body += `<div class="tk-small ok">Уже поставлено: ${t.placed}</div>`;
    } else if (t.kind === 'check') {
      body += `<div class="tk-desc">${esc(t.desc)}</div>`;
      if (t.shelves) body += `<div class="tk-sec">Полки секции (сверху вниз)</div>` + t.shelves.map(s => `<div class="tk-shrow"><span>Полка ${s.n}</span>${stripHtml(s.slots, false)}</div>`).join('');
      if (open) body += `<div class="tk-sec">Отметьте, когда проверили</div><label class="tk-chk"><input type="checkbox" class="tkc"> Все места заполнены, пустых нет</label><label class="tk-chk"><input type="checkbox" class="tkc"> Пары стоят ровно, носком вперёд</label><label class="tk-chk"><input type="checkbox" class="tkc"> Есть ценники, размеры по порядку</label>`;
    } else {
      body += `<div class="tk-desc">${esc(t.desc || '')}</div>`;
      const meta = [t.category ? 'Тема: ' + t.category : '', t.due ? 'Срок: до ' + fmtDay(t.due) : '', t.createdBy ? 'Поставил: ' + t.createdBy : '', t.ai ? 'Сгенерировано ИИ' : ''].filter(Boolean);
      if (meta.length) body += `<div class="tk-small">${esc(meta.join(' · '))}</div>`;
      if (open) body += `<div class="tk-sec">Комментарий (что сделали)</div><textarea id="tkComment" class="tk-ta" rows="3" placeholder="Например: предложила стельки 6 покупателям, купили 2"></textarea>`;
    }
    if (t.note) body += `<div class="tk-small warn">${esc(t.note)}</div>`;
    if (t.map && p.fixture) body += `<div class="tk-sec">Где это в магазине</div>${mapSvg(t.map)}`;
    body += `<div class="tk-pts">${ICON.gift}<span>За выполнение: <b>+${t.points} баллов</b></span></div>`;
    $('tkDBody').innerHTML = body;
    let foot = '';
    if (open) {
      const main = t.kind === 'restock' ? 'Выполнить (скан)' : 'Выполнить';
      foot = `<button class="tk-btn sec" data-tk="snooze">Отложить</button><button class="tk-btn pri" data-tk="do">${main}</button>`;
      if (t.kind === 'restock' && t.product && t.product.noStock) foot = `<button class="tk-btn sec" data-tk="skip">Нет товара</button>` + foot.replace('tk-btn sec" data-tk="snooze"', 'tk-btn sec sm" data-tk="snooze"');
    } else foot = `<button class="tk-btn sec" data-tk="tolist">К задачам</button>`;
    $('tkDFoot').innerHTML = foot;
    scrollHi($('tkDBody'));
  }

  function scrollHi(root) {
    if (!root) return;
    root.querySelectorAll('.tk-strip').forEach(st => { const hi = st.querySelector('.tk-slot.hi'); if (hi) st.scrollLeft = Math.max(0, hi.offsetLeft - (st.clientWidth - hi.offsetWidth) / 2); });
  }

  // ── действия ────────────────────────────────────────────
  async function doTask() {
    const t = TK.task; if (!t) return;
    if (t.kind === 'restock') { openScan('task'); return; }
    if (t.kind === 'check') {
      const all = [...document.querySelectorAll('.tkc')];
      if (all.some(x => !x.checked)) { toast('Отметьте все пункты проверки', true); return; }
    }
    await submit({ id: t.id, comment: ($('tkComment') && $('tkComment').value) || '' });
  }
  async function submit(body) {
    if (TK.busy) return; TK.busy = true;
    try {
      const d = await api('complete', null, body);
      if (d.needConfirm) {
        TK.busy = false;
        if (confirm(d.message)) return submit({ ...body, other: true });
        resumeCam(); return;
      }
      if (d.partial) {
        TK.task = d.task;
        toast(`Поставлено: ${d.placed ? d.placed.name + ', ' + d.placed.size : ''}. Осталось ${d.left} шт. — сканируйте следующую`);
        renderScanExtra(); resumeCam(); return;
      }
      showDone(d);
    } catch (e) { toast(e.message, true); if (TK.mode) resumeCam(); }
    finally { TK.busy = false; }
  }
  function showDone(d) {
    stopCam(); show('tkDone'); TK.after = d.next || null;
    const t = d.task || TK.task || {};
    const pl = d.placed;
    const prod = pl ? `<div class="tk-prod done">${pl.photo ? `<img src="${esc(pl.photo)}" alt="">` : `<span class="tk-thico">${ICON.box}</span>`}<span><b>${esc(pl.name)}</b><i>${t.placed || 1} шт. поставлено на место</i></span></div>` : '';
    $('tkDoneBody').innerHTML = `
      <div class="tk-conf">${Array.from({ length: 14 }, (_, i) => `<i style="--a:${i * 26}deg;--d:${(i % 3) * 0.08}s"></i>`).join('')}<div class="tk-okc"><svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div></div>
      <h2>${d.review ? 'Отправлено на проверку' : 'Задача выполнена!'}</h2>
      <div class="tk-plus">+${d.points || t.points || 0} баллов</div>
      ${d.review ? '<p class="tk-small">Баллы начислятся после подтверждения администратором</p>' : ''}
      ${prod}
      <div class="tk-done-btns">
        ${d.next ? `<button class="tk-btn out" data-tk="next">Сделать ещё 1 задачу</button>` : ''}
        <button class="tk-btn pri" data-tk="tolist">К задачам</button>
      </div>`;
    if (navigator.vibrate) try { navigator.vibrate([30, 40, 30]); } catch (_) {}
    TK.data = null; refreshBadge();
  }
  async function snooze() {
    const t = TK.task; if (!t) return;
    try { await api('snooze', null, { id: t.id }); toast('Отложено на час'); TK.data = null; show('tkList'); loadList(); }
    catch (e) { toast(e.message, true); }
  }
  async function skip() {
    const t = TK.task; if (!t) return;
    if (!confirm('Товара для этого места нет ни в зале, ни на складе? Задача закроется без баллов.')) return;
    try { await api('skip', null, { id: t.id, reason: 'Нет товара' }); toast('Закрыто: нет товара'); TK.data = null; show('tkList'); loadList(); }
    catch (e) { toast(e.message, true); }
  }

  // ── сканер ──────────────────────────────────────────────
  function renderScanExtra() {
    const ex = $('tkScanExtra'); if (!ex) return;
    if (TK.mode === 'task' && TK.task) {
      const t = TK.task, pr = t.product || {};
      ex.innerHTML = `<div class="tk-scanfor">${pr.photo ? `<img src="${esc(pr.photo)}" alt="">` : ''}<span><b>${esc(pr.name || '')}</b><i>${esc((t.place || {}).fixture || '')} · Полка ${(t.place || {}).n} · Место ${(t.place || {}).k}${t.need > 1 ? ` · нужно ${t.need} шт.` : ''}</i></span></div>
        ${t.placed ? `<button class="tk-btn out wide" data-tk="finish">Готово — больше пар нет (поставлено ${t.placed})</button>` : ''}`;
    } else ex.innerHTML = '';
  }
  function openScan(mode) {
    TK.mode = mode; openRoot(); show('tkScan');
    $('tkScanTitle').textContent = mode === 'locate' ? 'Узнать место товара' : 'Сканируйте пару';
    $('tkScanCap').textContent = mode === 'locate' ? 'Наведите камеру на штрихкод товара' : 'Отсканируйте этикетку пары, которую поставили на место';
    $('tkCode').value = ''; $('tkLocRes').innerHTML = ''; $('tkLocRes').style.display = 'none';
    $('tkScan').classList.remove('has-res');
    renderScanExtra(); startCam();
  }
  async function startCam() {
    stopCam();
    if (!window.Html5Qrcode) { $('tkScanCap').textContent = 'Камера недоступна — введите штрихкод вручную'; return; }
    try {
      if (typeof POS !== 'undefined' && POS.html5qr) { try { await POS.html5qr.stop(); } catch (_) {} }
      const F = window.Html5QrcodeSupportedFormats;
      const cfg = { verbose: false }; if (F) cfg.formatsToSupport = [F.EAN_13, F.EAN_8, F.CODE_128, F.UPC_A];
      TK.scan = new Html5Qrcode('tkReader', cfg);
      TK.lastCode = null;
      await TK.scan.start({ facingMode: 'environment' }, { fps: 10, qrbox: (w, h) => ({ width: Math.min(w * 0.86, 340), height: Math.min(h * 0.5, 150) }) }, (txt) => {
        const code = String(txt || '').replace(/\D+/g, '');
        if (!code || code === TK.lastCode || TK.busy) return;
        TK.lastCode = code; setTimeout(() => { TK.lastCode = null; }, 2500);
        pauseCam(); onCode(code);
      }, () => {});
    } catch (e) { $('tkScanCap').textContent = 'Не удалось включить камеру — введите штрихкод вручную'; }
  }
  function pauseCam() { try { TK.scan && TK.scan.pause && TK.scan.pause(true); } catch (_) {} }
  function resumeCam() { try { TK.scan && TK.scan.resume && TK.scan.resume(); } catch (_) {} }
  function stopCam() {
    const s = TK.scan; TK.scan = null;
    if (s) { try { const p = s.stop(); if (p && p.then) p.then(() => { try { s.clear(); } catch (_) {} }).catch(() => {}); } catch (_) {} }
  }
  async function onCode(code) {
    if (navigator.vibrate) try { navigator.vibrate(40); } catch (_) {}
    if (TK.mode === 'task') return submit({ id: TK.task.id, code });
    if (TK.mode === 'locate') return doLocate(code);
  }

  // ── узнать место товара ────────────────────────────────
  function openLocate() {
    const c = ctx(); if (!c.open) { alert('Сначала откройте смену'); return; }
    openScan('locate');
  }
  async function doLocate(code) {
    const box = $('tkLocRes'); box.style.display = ''; $('tkScan').classList.add('has-res');
    box.innerHTML = '<div class="tk-empty">Ищу место…</div>';
    try {
      const d = await api('locate', { code });
      const u = d.unit, pr = d.product, pl = d.places || [];
      let h = `<div class="tk-lp">${pr.photo ? `<img src="${esc(pr.photo)}" alt="">` : `<span class="tk-thico">${ICON.box}</span>`}<span><b>${esc(pr.name)}</b><i>Размер: ${esc(u.size)}</i>${pr.sku ? `<i>Артикул: ${esc(pr.sku)}</i>` : ''}<i class="tk-mono">${esc(u.bc)}</i></span></div>`;
      if (!u.here) h += `<div class="tk-small warn">${u.status === 'in_stock' ? 'Эта пара числится в магазине «' + esc(u.shop) + '»' : 'Пара числится как ' + (u.status === 'sold' ? 'проданная' : u.status === 'written_off' ? 'списанная' : esc(u.status))} — сообщите администратору.</div>`;
      if (!d.hasPlanogram) h += `<div class="tk-small">Для магазина «${esc(d.shop)}» ещё нет планограммы.</div>`;
      else if (pl.length) {
        const p = pl[0];
        h += `<div class="tk-sec">${p.zone === 'stock' ? 'Место на складе' : 'Место на витрине'}${p.exact ? '' : ' (место этой модели)'}</div>
          <div class="tk-placebox"><div class="tk-pb-top"><span class="tk-shop">${ICON.pin} ${esc(d.shop)}</span><button class="tk-link" data-tk="map">Показать на плане</button></div>
          <div class="tk-pchips"><span>${esc(p.fixture)}</span><span>Полка ${p.n}</span><span>Место ${p.k}</span></div>
          ${stripHtml(d.strip, false)}<div class="tk-mapwrap" id="tkLocMap" style="display:none">${mapSvg(d.map)}</div></div>`;
        if (pl.length > 1) h += `<div class="tk-small">Ещё места этой модели: ${pl.slice(1, 5).map(x => esc(`${x.fixture} · П${x.n} · М${x.k}`)).join('; ')}</div>`;
      } else {
        h += `<div class="tk-sec">Место не назначено</div><div class="tk-small">Эта модель ещё не стоит на планограмме.${(d.suggest || []).length ? ' Подходящая секция по категории «' + esc(pr.category) + '»: <b>' + d.suggest.slice(0, 3).map(s => esc(s.fixture) + (s.free ? ` (свободно мест: ${s.free})` : '')).join(', ') + '</b>' : ''}</div>`;
        if (d.map) h += `<div class="tk-mapwrap">${mapSvg(d.map)}</div>`;
      }
      h += `<button class="tk-btn pri wide" data-tk="again">Сканировать ещё</button>`;
      box.innerHTML = h; stopCam(); scrollHi(box);
    } catch (e) { box.innerHTML = `<div class="tk-small warn">${esc(e.message)}</div><button class="tk-btn pri wide" data-tk="again">Сканировать ещё</button>`; stopCam(); }
  }

  // ── клики ───────────────────────────────────────────────
  function onClick(e) {
    const tabB = e.target.closest('[data-tab]'); if (tabB) { TK.tab = tabB.dataset.tab; TK.chip = 'all'; renderList(); return; }
    const chipB = e.target.closest('[data-chip]'); if (chipB) { TK.chip = chipB.dataset.chip; renderList(); return; }
    const op = e.target.closest('[data-open]'); if (op) { openTask(op.dataset.open); return; }
    const b = e.target.closest('[data-tk]'); if (!b) return;
    const a = b.dataset.tk;
    if (a === 'close') closeRoot();
    else if (a === 'help') alert('Задачи приходят сами: когда с витрины продали пару, появится «Секция · Полка · Место пусто — поставьте товар». Возьмите пару со склада, поставьте на место и отсканируйте её — задача выполнится, вам начислятся баллы.\n\nАдминистратор тоже может ставить задачи. Баллы и прогресс — в «Мой заработок».');
    else if (a === 'tolist') { TK.mode = null; show('tkList'); loadList(); }
    else if (a === 'do') doTask();
    else if (a === 'snooze') snooze();
    else if (a === 'skip') skip();
    else if (a === 'finish') submit({ id: TK.task.id, finish: true });
    else if (a === 'next') { if (TK.after) { TK.data = null; openTask(TK.after.id); } else { show('tkList'); loadList(); } }
    else if (a === 'scanback') { const m = TK.mode; TK.mode = null; if (m === 'task' && TK.task) show('tkDetail'); else closeRoot(); }
    else if (a === 'again') { $('tkLocRes').innerHTML = ''; $('tkLocRes').style.display = 'none'; $('tkScan').classList.remove('has-res'); $('tkCode').value = ''; startCam(); }
    else if (a === 'map') { const m = $('tkLocMap'); if (m) m.style.display = m.style.display === 'none' ? '' : 'none'; }
  }

  // ── бейдж, точки входа ─────────────────────────────────
  function setBadge(n) {
    TK.badge = Number(n) || 0;
    document.querySelectorAll('.tk-badge').forEach(el => { el.textContent = TK.badge > 9 ? '9+' : String(TK.badge); el.style.display = TK.badge ? '' : 'none'; });
  }
  async function refreshBadge() {
    const c = ctx(); if (!c.open || !c.whc1) return;
    try { const d = await api('count'); setBadge(d.badge); } catch (_) {}
  }
  function injectEntrances() {
    const nav = $('pmobNav');
    if (nav && !$('tkNavBtn')) {
      const b = document.createElement('button');
      b.type = 'button'; b.id = 'tkNavBtn'; b.className = 'tk-navbtn';
      b.innerHTML = `<span class="tk-navic">${ICON.tasks}<i class="tk-badge" style="display:none"></i></span><span>Задачи</span>`;
      b.addEventListener('click', openTasks);
      const more = nav.querySelector('[data-pmob="more"]'); nav.insertBefore(b, more || null);
    }
    const head = document.querySelector('#pmobScreenCart .pmob-head');
    if (head && !$('tkLocBtn')) {
      const b = document.createElement('button');
      b.type = 'button'; b.id = 'tkLocBtn'; b.className = 'tk-locbtn'; b.title = 'Узнать место товара'; b.setAttribute('aria-label', 'Узнать место товара');
      b.innerHTML = ICON.cam + '<span>Место</span>';
      b.addEventListener('click', openLocate);
      const off = head.querySelector('#pmobCloseShift'); head.insertBefore(b, off || null);
    }
    const menu = document.querySelector('#pmobScreenMore .pmob-menu');
    if (menu && !$('tkMoreTasks')) {
      const mk = (id, ico, txt, fn) => { const b = document.createElement('button'); b.type = 'button'; b.id = id; b.className = 'pmob-menu-item'; b.innerHTML = `<span class="pmob-menu-ico">${ico}</span><span class="pmob-menu-txt">${txt}</span><span class="pmob-chev">›</span>`; b.addEventListener('click', fn); return b; };
      const ref = $('pmobMoreHistory');
      menu.insertBefore(mk('tkMoreTasks', '✅', 'Задачи <i class="tk-badge tk-badge-in" style="display:none"></i>', openTasks), ref || null);
      menu.insertBefore(mk('tkMoreLocate', '📷', 'Узнать место товара', openLocate), ref || null);
    }
  }

  // ── «Мой заработок»: прогресс задач ────────────────────
  async function earnings() {
    const scr = $('pmobScreenEarnings'); if (!scr) return;
    let box = $('tkEarn');
    if (!box) {
      box = document.createElement('div'); box.id = 'tkEarn'; box.className = 'tk-earn';
      const after = scr.querySelector('.pmob-earn-cards');
      if (after && after.nextSibling) scr.insertBefore(box, after.nextSibling); else scr.appendChild(box);
      box.addEventListener('click', (e) => { if (e.target.closest('[data-earn]')) openTasks(); });
    }
    box.innerHTML = '<div class="tk-earn-title">Прогресс задач</div><div class="tk-empty">Загрузка…</div>';
    try {
      const d = await api('summary');
      const td = d.today || {}; const pct = td.pct || 0; const R = 34, C = 2 * Math.PI * R;
      const som = d.somPerPoint > 0 ? `<i>≈ ${(d.monthSom || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} с.</i>` : '';
      box.innerHTML = `<div class="tk-earn-title">Прогресс задач</div>
        <div class="tk-earn-grid">
          <div class="tk-earn-card"><span class="tk-earn-cap">Выполнено сегодня</span>
            <div class="tk-ring"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="${R}" class="bg"/><circle cx="40" cy="40" r="${R}" class="fg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct / 100)}"/></svg><b>${td.done || 0}/${td.total || 0}</b><i>${pct}%</i></div>
            <span class="tk-earn-sub">Сегодня: +${td.points || 0} баллов</span></div>
          <div class="tk-earn-card gift"><span class="tk-earn-cap">Бонус за задачи</span><span class="tk-gift">${ICON.gift}</span><b class="tk-earn-big">${d.month && d.month.points || 0}</b><span class="tk-earn-sub">баллов за месяц ${som}</span>${d.review ? `<span class="tk-earn-sub rv">${d.review} на проверке</span>` : ''}</div>
        </div>
        <div class="tk-earn-title">Мои задачи сегодня</div>
        <button class="tk-earn-row" data-earn="1"><span class="tk-earn-chk ok">✓</span><span>Выполнено</span><b>${td.done || 0}</b>${ICON.chev}</button>
        <button class="tk-earn-row" data-earn="1"><span class="tk-earn-chk">○</span><span>Осталось</span><b>${td.open || 0}</b>${ICON.chev}</button>`;
    } catch (e) { box.innerHTML = '<div class="tk-earn-title">Прогресс задач</div><div class="tk-empty">Не удалось загрузить</div>'; }
  }

  function boot() {
    mount(); injectEntrances();
    clearInterval(TK.timer);
    TK.timer = setInterval(() => { if (!document.hidden) { injectEntrances(); refreshBadge(); } }, 180000);
    setTimeout(refreshBadge, 4000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshBadge(); });
  }
  window.tkOpenTasks = openTasks;
  window.tkOpenLocate = openLocate;
  window.tkEarnings = earnings;
  window.tkPoke = () => { setTimeout(refreshBadge, 6000); setTimeout(refreshBadge, 30000); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
