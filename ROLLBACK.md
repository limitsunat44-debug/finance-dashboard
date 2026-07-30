# ROLLBACK — как быстро откатить деплой

> **Когда откатывать:** smoke.sh дал `[FAIL]`, или пользователь/кассир сообщил о поломке после релиза.
> **Главное правило:** сначала верни рабочую версию, потом разбирайся в причине. Не чини на живом проде под нагрузкой.

---

## Backend (1c-sync-barcodes)

Vercel хранит ВСЕ прошлые деплои. Откат = переключение прод-алиаса на предыдущий рабочий деплой. **Код не пересобирается — откат за ~10 секунд.**

### Шаг 1. Подготовка окружения
```bash
cd /home/user/workspace/1c-sync-barcodes
set -a; source /tmp/bcenv; set +a      # ВАЖНО: отдельной строкой, не через &&
```

### Шаг 2. Посмотреть список деплоев
```bash
npx vercel ls --token "$VERCEL_TOKEN"
```
Найди последний **● Ready / Production**, который был ДО сломанного релиза (по колонке Age).
Скопируй его URL, например: `https://1c-sync-barcodes-6n079eoi9-...vercel.app`

### Шаг 3. Откатить на него
```bash
npx vercel rollback <URL-предыдущего-деплоя> --token "$VERCEL_TOKEN" --yes
```
Либо интерактивно — откатит на предыдущий автоматически:
```bash
npx vercel rollback --token "$VERCEL_TOKEN" --yes
```

### Шаг 4. Дождаться переключения алиаса и проверить
```bash
sleep 45
./smoke.sh
```
Должно быть `✅ Всё зелёное`. Если да — прод восстановлен.

### Проверить статус отката
```bash
npx vercel rollback status --token "$VERCEL_TOKEN"
```

---

## Frontend (finance-dashboard, в git)

У фронта два пути отката — через git (правильный) или через Vercel rollback (быстрый).

### Быстрый откат (Vercel, ~10с) — как у backend
```bash
cd /home/user/workspace/finance-dashboard
set -a; source /tmp/bcenv; set +a
npx vercel ls --token "$VERCEL_TOKEN"                      # найти прошлый Ready
npx vercel rollback <URL> --token "$VERCEL_TOKEN" --yes
```

### Правильный откат (git revert — история чистая)
```bash
cd /home/user/workspace/finance-dashboard
git log --oneline -10                    # найти хэш плохого коммита
git revert <хэш-плохого-коммита> --no-edit
./deploy.sh "revert: откат сломавшего изменения"
```
`git revert` создаёт НОВЫЙ коммит, отменяющий плохой — история сохраняется, можно вернуть обратно.

### Проверка версии фронта после отката
```bash
curl -s https://finance-orto.vercel.app/index.html | grep -oE "20260[0-9]{3}-[0-9]{4,6}" | head -1
```

---

## Полный безопасный цикл релиза (чтобы НЕ доводить до отката)

```bash
# BACKEND:
cd /home/user/workspace/1c-sync-barcodes
node -c api/pos.js                                   # 1. синтаксис
./smoke.sh                                           # 2. baseline ДО деплоя (запомнить цифры)
set -a; source /tmp/bcenv; set +a
timeout 170 npx vercel --token "$VERCEL_TOKEN" --prod --yes   # 3. деплой
sleep 45                                             # 4. ждать алиас
./smoke.sh                                           # 5. проверка ПОСЛЕ — цифры должны совпасть
# если [FAIL] → сразу ROLLBACK (см. выше)

# FRONTEND:
cd /home/user/workspace/finance-dashboard
node -e "new Function(require('fs').readFileSync('admin-rmk.js','utf8'))"   # синтаксис
./deploy.sh "описание изменения"
# затем открыть https://finance-orto.vercel.app, Ctrl+F5, проверить визуально
```

---

## Что НЕЛЬЗЯ делать при откате
- ❌ Не удалять деплои Vercel — они и есть точки отката.
- ❌ Не откатывать `vercel.json` с `maxDuration=300` обратно на 60 — вернётся 504 на месячных отчётах.
- ❌ Не менять CONC>16 / CHUNK>15 в `fetchPaymentsByRefs` — 1С отвалится (500/414).
- ❌ Не трогать прод-1С (WRITE-action-ы) в попытке «починить» — только чтение при диагностике.
