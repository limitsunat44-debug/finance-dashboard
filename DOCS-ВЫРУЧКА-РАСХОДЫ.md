# Досье: вкладка «Выручка-Расходы» (расширение «Движение денежных средств»)

## Требования пользователя (31.07.2026)
1. Переименовать вкладку → **«Выручка-Расходы»**.
2. Добавить **долги перед поставщиками**: закупки по поставщикам + выплаты поставщикам.
3. Добавить **сотрудников**: список + выплаты зарплат.
4. **Чистая прибыль** = выручка магазинов − постоянные − переменные − зарплаты (и выплаты/долги поставщикам).
5. Сначала **тестовый вариант** для предпросмотра, потом правки.

## Макет (фото 48eb937d) — 6 под-вкладок
Обзор · Постоянные расходы · Переменные расходы · Долги перед поставщиками · Выплаты поставщикам · Сотрудники и зарплаты

**Экран «Обзор»:** 5 KPI (Выручка / Постоянные / Переменные / Зарплаты / Чистая прибыль);
блок «Финансовый результат» (Выручка − Постоянные − Переменные − Зарплаты − Долги поставщикам(новые) − Выплаты поставщикам = Чистая прибыль);
«Выручка по магазинам» (Магазин|Выручка|Расходы|Прибыль); график динамики (3 линии); превью-блоки.

## Данные — ВСЁ уже в общей БД Supabase (qgucitzmrpwgsmtygtfs), перенос НЕ нужен
- **shop_suppliers** (14: 8 USD/Турция, 5 CNY/Китай, 1 TJS): id,name,country,currency,photo_url,is_active,sort_order,created_at
- **shop_supplier_operations** (44): id,supplier_id,type(purchase/payment),amount_foreign,amount_tjs,fx_rate,comment,operation_date,created_at
  - Долг = SUM(purchase) − SUM(payment). Текущий: 942 602 − 599 706 = ~342 896 с.
  - Выплаты поставщикам уменьшают прибыль (кассовый метод по operation_date). Закупки — НЕ уменьшают.
- **shop_fx_rates** (42): currency,rate_sell,source,date,fetched_at. USD=10.8, CNY=1.42 (банк Алиф, курс продажи)
- **shop_supplier_orders** (2) + **shop_supplier_order_items**: заказы поставщикам (пока не выводим — задел)
- **shop_employees** (17, актив 16): id,full_name,position,wallet,phone,status,salary_type,percent_rate,hired_at
  - salary_type: fixed_per_salon(12) / salary_plus_personal_percent(4) / percent_network(1)
- **shop_employee_salaries** (40): id,employee_id,warehouse_id(NULL=офис/сеть),amount,created_at,updated_at
  - Оклад = сумма amount по всем салонам сотрудника. Итого окладов = 99 164 с./мес. НЕТ привязки к месяцу — это постоянный месячный оклад (upsert по employee+warehouse).

## Формула прибыли (эталон OrtoShop analytics.ts /profit)
gross(net из 1С по 4 салонам) − cogs(50%) − (постоянные+переменные+выплаты поставщикам) − payroll(оклады+% от продаж) = net_profit
- % сотрудников: percent_network → % от net сети; salary_plus_personal_percent → % от личных продаж
- Оклады pro-rata по дням если период неполный месяц
- Выплаты поставщикам: type=payment, amount_tjs, по operation_date в диапазоне
- **Внимание:** в макете пользователя нет COGS 50% — уточнить, включать ли себестоимость. Пока в РМК формулу сделать БЕЗ cogs (как на фото), но оставить возможность включить.

## OrtoShop backend (референс, server/)
- suppliers.ts (581 стр): shop_suppliers + operations + FX (p2p.army/themoney.tj, банк Алиф курс продажи). computeDebt, currentRateFor, sumSupplierPaymentsTjs, foreignForTjsPayment (выплата в TJS иностранному поставщику).
- finances.ts (636 стр): employees CRUD + salary upsert (PUT /employees/:id/salary), expenses, revenue, ai parse/analysis.
- analytics.ts (440 стр): /payroll (авторасчёт ЗП+% за месяц), /profit (полная формула прибыли + разбивка по салонам).

## Салоны (warehouse_id)
Айни 5ca2d3e6-29c1-4d1a-aeee-832fa513e2e2 · Баракат f9a506e7-c706-439e-aad3-dbfa9104fed2 · Сиёма 19db06fa-deb5-47db-acd7-486c5bc679d0 · Сити-Молл 8f0bf6e3-1ffc-4267-8f4b-1e79179dd2a7

## План внедрения
### Backend (pos.js, новые fin-* методы)
GET: fin-suppliers (с долгом), fin-supplier-ops?supplier_id, fin-fx-rates, fin-employees (с окладами), fin-profit?from&to (сводка прибыли + по салонам)
POST: fin-supplier-create/update/delete, fin-supplier-op-create/update/delete, fin-fx-set, fin-employee-create/update/delete, fin-employee-salary-set

### Frontend (admin-rmk.js/html/css)
- Переименовать сайдбар/заголовок → «Выручка-Расходы»
- Под-вкладки: Обзор / Постоянные / Переменные / Долги поставщикам / Выплаты поставщикам / Сотрудники и зарплаты
- Обзор: 5 KPI + Фин.результат + Выручка по магазинам + график динамики
- Долги: список поставщиков с долгом, форма закупки/выплаты, история операций
- Сотрудники: список + оклады по салонам, форма ЗП

### ТЕСТОВАЯ ВЕРСИЯ
Пользователь просил сначала посмотреть. Сделать на проде под отдельной под-вкладкой/флагом или сразу задеплоить как «Выручка-Расходы» и дать посмотреть → собрать правки.
