#!/usr/bin/env node
/* ============================================================================
   bump-version.mjs — единая подстановка версии кассы во ВСЕ три места:
     1) sw.js            → const SW_VERSION = '<V>'
     2) index.html       → style.css?v=<V>
     3) index.html       → app.js?v=<V>
   ----------------------------------------------------------------------------
   Использование:
     node bump-version.mjs            → авто-версия YYYYMMDD-HHMMSS
     node bump-version.mjs my-tag     → задать версию вручную
   Скрипт печатает итоговую версию в stdout (её удобно поймать в деплой-скрипте).
   ============================================================================ */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));

// Версия: аргумент или авто-таймстамп (UTC, компактный, безопасный для URL/кэша).
function autoVersion() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}
const VERSION = (process.argv[2] || autoVersion()).trim();
if (!/^[A-Za-z0-9._-]+$/.test(VERSION)) {
  console.error('Недопустимая версия (только буквы/цифры/.-_):', VERSION);
  process.exit(1);
}

let changed = 0;

// 1) sw.js — SW_VERSION
{
  const p = join(DIR, 'sw.js');
  const src = readFileSync(p, 'utf8');
  const re = /const\s+SW_VERSION\s*=\s*['"][^'"]*['"]\s*;/;
  if (!re.test(src)) { console.error('sw.js: не найдена строка SW_VERSION'); process.exit(1); }
  const out = src.replace(re, `const SW_VERSION = '${VERSION}';`);
  if (out !== src) { writeFileSync(p, out); changed++; }
}

// 2+3+4) index.html — ?v= у style.css и app.js + window.__APP_BUILD
{
  const p = join(DIR, 'index.html');
  let src = readFileSync(p, 'utf8');
  const before = src;
  // style.css?v=... и app.js?v=... (в href/src)
  src = src.replace(/(style\.css\?v=)[^"'\s>]*/g, `$1${VERSION}`);
  src = src.replace(/(app\.js\?v=)[^"'\s>]*/g, `$1${VERSION}`);
  // window.__APP_BUILD = '...'  — билд страницы для авто-обновления (СРАВНИВАЕТСЯ с version.json).
  // ЕСЛИ НЕ ОБНОВЛЯТЬ — касса уйдёт в бесконечный location.reload() (билд никогда не совпадёт).
  src = src.replace(/(window\.__APP_BUILD\s*=\s*)['"][^'"]*['"]/, `$1'${VERSION}'`);
  if (!/style\.css\?v=/.test(before)) { console.error('index.html: не найден style.css?v='); process.exit(1); }
  if (!/app\.js\?v=/.test(before)) { console.error('index.html: не найден app.js?v='); process.exit(1); }
  if (!/window\.__APP_BUILD\s*=/.test(before)) { console.error('index.html: не найден window.__APP_BUILD'); process.exit(1); }
  if (src !== before) { writeFileSync(p, src); changed++; }
}

// 5) version.json — серверный билд (ИСТОЧНИК ИСТИНЫ для авто-обновления). Обязан совпадать с __APP_BUILD.
{
  const p = join(DIR, 'version.json');
  writeFileSync(p, `{ "build": "${VERSION}" }\n`);
  changed++;
}

// 4) admin-rmk.html — ?v= у admin-rmk.css и admin-rmk.js (опционально: файл может отсутствовать)
try {
  const p = join(DIR, 'admin-rmk.html');
  let src = readFileSync(p, 'utf8');
  const before = src;
  src = src.replace(/(admin-rmk\.css\?v=)[^"'\s>]*/g, `$1${VERSION}`);
  src = src.replace(/(admin-rmk\.js\?v=)[^"'\s>]*/g, `$1${VERSION}`);
  src = src.replace(/(fonts-dejavu\.js\?v=)[^"'\s>]*/g, `$1${VERSION}`);
  if (src !== before) { writeFileSync(p, src); changed++; }
} catch (_) { /* admin-rmk.html может не существовать — пропускаем */ }

console.error(`✓ Версия проставлена: ${VERSION} (файлов изменено: ${changed})`);
// В stdout — только версия, чтобы деплой-скрипт мог её захватить.
console.log(VERSION);
