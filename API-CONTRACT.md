# API-CONTRACT — контракт backend РМК

> **Назначение.** Единый источник правды по всем `action`-ам backend. Меняешь backend — **сначала сверься здесь**. Меняешь формат ответа или параметры — **сначала обнови этот файл и фронт**, иначе фронт молча сломается.
>
> **База:** `https://1c-sync-barcodes.vercel.app`
> **Заголовки (обязательны на КАЖДЫЙ запрос):**
> `X-Provision-Secret: TySog2bN1bMJHsssoTvyCZO3IKOef1z0`, `Content-Type: application/json`
> **Точки входа:** `/api/pos?action=...` и `/api/inventory?action=...`
> **Общая обёртка ответа:** почти все возвращают `{ ok: true, ... }`. При ошибке — HTTP 4xx/5xx и/или `{ ok:false, error }`.
> **Даты:** формат `YYYY-MM-DD`, интерпретируются по Душанбе (+05). `fromDT=…T00:00:00`, `toDT=…T23:59:59`.

---

## Легенда безопасности
- 🟢 **READ** — только чтение, безопасно дёргать в smoke-тестах и на проде.
- 🔴 **WRITE** — пишет в прод-1С или Supabase. **НЕ включать в smoke.** Менять только с явного согласия пользователя.

---

## /api/pos

### 🟢 READ — справочники и отчёты

| action | Параметры | Ответ (форма) |
|---|---|---|
| `kassas` | — | `{ ok, kassas:[{key,name,...}] }` (≥5 касс) |
| `sellers` | — | `{ ok, sellers:[...] }` |
| `paytypes` | — | `{ ok, paytypes:[...] }` |
| `history` | `from,to,kassa?` | `{ ok, count, total, receipts:[{number,date,shop,seller,total}] }` — **ТОЛЬКО продажи, возвраты отфильтрованы** |
| `returns` | `from,to,kassa?` | `{ ok, count, total, returns:[{number,date,total,shop,seller}] }` |
| `sales-report` | `from,to` | `{ ok, report:{ from,to, buckets:[{key,label}], shops:[...], grand:{cash,alifqr,alifwlt,dcwlt,dcqr,other,total,receipts} } }` — **тяжёлый (месяц ≈90с)** |
| `history-name` | `q,wh?,limit?` | `{ ok, ... }` — поиск по имени товара |
| `product-search` | `q` | `{ ok, ... }` |
| `scan` | `barcode` | `{ ok, ... }` — карточка товара по штрихкоду (чтение) |
| `card` | `barcode`/`code` | `{ ok, ... }` — дисконтная карта |
| `cards` | — | `{ ok, ... }` — список карт |
| `discounts` | `from,to` | `{ ok, ... }` |
| `stats` | `from,to` | `{ ok, ... }` — статистика (net = продажи−возвраты) |
| `monitoring` | — | `{ ok, ... }` |
| `cashreport` | `from,to` | `{ ok, ... }` — движение наличных/безнала, инкассация |
| `audit` | `from,to` | `{ ok, ... }` |
| `settings` | — | `{ ok, ... }` |
| `pos-users` | — | `{ ok, ... }` |
| `shift` | `kassa?` | текущая смена |
| `shifts-active` | — | `{ ok, ... }` активные смены |
| `unit-history` | `barcode` | история экземпляра |
| `lookup-sale` / `lookup-sale-receipt` | `number`/`ref` | поиск чека |
| `receipt-items` | `ref` | строки чека |
| `receiving` / `receiving-items` / `probe-receiving` | `from,to` | поступление товаров |

### 🔴 WRITE — НЕ трогать без согласия
| action | Что делает |
|---|---|
| `sell` | **проводит продажу в 1С** |
| `open-shift` / `close-shift` | открытие/закрытие смены |
| `return-item` / `return-receipt` | **проводит возврат в 1С** |
| `build-orp` | формирование документа |

---

## /api/inventory

### 🟢 READ
| action | Параметры | Ответ |
|---|---|---|
| `balance` | — | `{ ok, ... }` остатки |
| `receipts` | `from,to` | `{ ok, ... }` |
| `transfers` | `limit?,from?,to?` | `{ ok, ... }` перемещения (**должно быть <15с на limit=5**) |
| `prices` | — | `{ ok, ... }` |
| `barcodes-list` | — | `{ ok, ... }` |
| `anomalous-sales` | — | `{ ok, ... }` |

### 🔴 WRITE
| action | Что делает |
|---|---|
| `anomalous-resolve` | помечает аномалию решённой |
| `variant-sync` | синхронизация вариантов |

---

## КЛЮЧЕВЫЕ ИНВАРИАНТЫ (проверяются в smoke.sh)

1. **Чистая выручка = продажи − возвраты.**
   `sales-report.grand.total` ДОЛЖЕН равняться `history.total − returns.total` за тот же период.
   (Проверено 29.07: 35581.44 − 3986.45 = 31594.99 = grand.total ✓)
2. **Возвраты всегда учитываются** во всех местах фронта: Обзор, Статистика, Кассовый отчёт.
3. `history.total` — БЕЗ возвратов (только продажи). `returns.total` — положительное число.
4. `0 ≤ returns.total ≤ history.total` за нормальный период.

---

## PAY_BUCKETS (ключи способов оплаты, `pos.js` ~1710)
| key | Ref_Key вида оплаты в 1С |
|---|---|
| cash | `30cd860d-357a-11ed-8788-40a3ccea3566` |
| alifqr | `ce9c7be3-9e71-11ef-8245-c018500f4abe` |
| alifwlt | `80977525-3723-11ed-878a-40a3ccea3566` |
| dcwlt | `ce9c7be5-9e71-11ef-8245-c018500f4abe` |
| dcqr | `ce9c7be4-9e71-11ef-8245-c018500f4abe` |

## Кассы (Ref_Key)
| Касса | Ref_Key |
|---|---|
| Айни | `e2c21e45-ca1a-11ed-879c-d8c0a681cbca` |
| Баракат | `cfc13fd0-2f38-11f0-980e-8cc84b9dccd0` |
| Сиёма | `0e08adaa-3b0d-11ed-bf26-c018500f4abe` |
| Сити-Молл | `e54aac7b-dc33-11f0-ab2c-d3e7761d06f3` (offline, АвтономнаяККМ) |
| Интернет магазин | `b2f8ef62-368f-11ed-8788-40a3ccea3566` (**тест — НЕ удалять**) |

## Технические лимиты 1С OData (эмпирические — НЕ превышать)
- `fetchPaymentsByRefs`: **CHUNK=15** (лимит длины URL — при 50 уже 404/414), **CONC=16** (при 32 → HTTP 500 «operation aborted»).
- `vercel.json`: `functions."api/*.js".maxDuration = 300` (нужно для sales-report за месяц ≈93с).
- Прямой доступ к 1С OData даёт 401 — только через backend-прокси.
- `$expand=Оплата` → 501 (нельзя). Фильтр по `Ref/Date` на строках оплат → 400.
