/* ============================================================================
   Service Worker — Ортосалон Касса (PWA)
   ----------------------------------------------------------------------------
   ПРИНЦИП БЕЗОПАСНОСТИ КАССЫ:
   - Кэшируем ТОЛЬКО статику своего origin (index.html, app.js, style.css,
     иконки, манифест) — чтобы касса открывалась мгновенно и работала офлайн.
   - ВСЕ живые данные (Supabase, 1c-sync, 1c-sync-barcodes, любые API) идут
     на ДРУГИЕ домены. Их SW НЕ перехватывает вообще → они всегда из сети,
     никогда из кэша. Остаток/продажа/смена не могут «залипнуть».
   - HTML (навигация) — network-first: свежая версия важнее, кэш только как
     офлайн-фолбэк. Это исключает «залипание» на старой версии кассы.
   - app.js / style.css подключены с ?v=... (cache-buster). При смене версии
     это новый URL → SW докачает свежий файл, старый вычистится.

   ПРИ ОБНОВЛЕНИИ: поднять SW_VERSION (и, как обычно, ?v=... у app.js/style.css).
   ============================================================================ */

const SW_VERSION = '20260809-180254';
const CACHE_STATIC = 'orto-kassa-static-' + SW_VERSION;

// Ядро оболочки (app-shell). Пути относительные к scope.
// ВНИМАНИЕ: app.js/style.css кэшируются по факту запроса (с ?v=...),
// чтобы не привязываться к конкретной версии в этом списке.
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png',
];

// ── INSTALL: префетч оболочки ──────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) =>
      // addAll упадёт, если хоть один файл 404 — используем мягкий вариант
      Promise.allSettled(
        PRECACHE_URLS.map((u) =>
          fetch(u, { cache: 'no-cache' })
            .then((r) => { if (r.ok) return cache.put(u, r); })
            .catch(() => {})
        )
      )
    ).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: чистим старые кэши, забираем контроль ────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('orto-kassa-static-') && k !== CACHE_STATIC)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Позволяем странице форсировать немедленную активацию нового SW.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ── FETCH ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Только GET кэшируем. POST/PUT (продажи, возвраты) — мимо SW, всегда сеть.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1a) КРИТИЧНЫЕ CDN-БИБЛИОТЕКИ (JsBarcode и др.) — cache-first с фоновым
  //    обновлением. Версии зафиксированы в URL, поэтому кэш безопасен.
  //    Критично для печати штрихкодов на кассе со слабым интернетом:
  //    без JsBarcode ценники печатаются без штрихкода.
  if (url.origin !== self.location.origin) {
    const isCriticalCdn =
      /jsdelivr\.net\/npm\/jsbarcode/i.test(req.url) ||
      /jsdelivr\.net\/npm\/chart\.js/i.test(req.url) ||
      /cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx/i.test(req.url) ||
      /unpkg\.com\/html5-qrcode/i.test(req.url);
    if (isCriticalCdn) {
      event.respondWith(
        caches.match(req).then((cached) => {
          const network = fetch(req)
            .then((res) => {
              if (res && (res.ok || res.type === 'opaque')) {
                const copy = res.clone();
                caches.open(CACHE_STATIC).then((c) => c.put(req, copy));
              }
              return res;
            })
            .catch(() => cached);
          // cache-first: отдаём из кэша мгновенно, в фоне обновляем
          return cached || network;
        })
      );
      return;
    }
    // 1b) Прочие чужие origin (Supabase, 1c-sync*, живые данные) — НЕ трогаем.
    //    Пусть браузер идёт в сеть напрямую. Никакого кэша живых данных.
    return;
  }

  // 2) СВОЙ ORIGIN.
  //    a) Навигация/HTML — network-first (свежесть важнее), кэш — офлайн-фолбэк.
  const isNav = req.mode === 'navigate' ||
                (req.headers.get('accept') || '').includes('text/html');
  if (isNav) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_STATIC).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() =>
          caches.match('./index.html').then((r) => r || caches.match('./'))
        )
    );
    return;
  }

  //    b) Прочая статика своего origin (app.js?v=, style.css?v=, иконки,
  //       шрифты) — stale-while-revalidate: отдаём из кэша мгновенно,
  //       в фоне тянем свежую и обновляем кэш.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_STATIC).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached); // офлайн → что есть в кэше
      return cached || network;
    })
  );
});
