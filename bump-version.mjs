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

// 2+3) index.html — ?v= у style.css и app.js
{
  const p = join(DIR, 'index.html');
  let src = readFileSync(p, 'utf8');
  const before = src;
  // style.css?v=... и app.js?v=... (в href/src)
  src = src.replace(/(style\.css\?v=)[^"'\s>]*/g, `$1${VERSION}`);
  src = src.replace(/(app\.js\?v=)[^"'\s>]*/g, `$1${VERSION}`);
  if (!/style\.css\?v=/.test(before)) { console.error('index.html: не найден style.css?v='); process.exit(1); }
  if (!/app\.js\?v=/.test(before)) { console.error('index.html: не найден app.js?v='); process.exit(1); }
  if (src !== before) { writeFileSync(p, src); changed++; }
}

console.error(`✓ Версия проставлена: ${VERSION} (файлов изменено: ${changed})`);
// В stdout — только версия, чтобы деплой-скрипт мог её захватить.
console.log(VERSION);
