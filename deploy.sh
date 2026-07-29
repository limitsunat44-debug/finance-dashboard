#!/usr/bin/env bash
# ============================================================================
# deploy.sh — деплой фронтенда кассы (finance-dashboard) с АВТО-версией.
# ----------------------------------------------------------------------------
# Что делает:
#   1) Проставляет ЕДИНУЮ версию во все три места (sw.js SW_VERSION,
#      index.html style.css?v=, app.js?v=) через bump-version.mjs.
#   2) Проверяет синтаксис app.js и sw.js.
#   3) git commit + push origin main → Vercel авто-деплой (~40-45с).
#
# Использование:
#   ./deploy.sh                 → авто-версия + сообщение по умолчанию
#   ./deploy.sh "текст коммита"  → авто-версия + свой текст коммита
#   VERSION=my-tag ./deploy.sh "текст"  → задать версию вручную
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")"

MSG="${1:-chore(pwa): деплой фронтенда кассы}"

# 1) Единая версия во все три места.
VER="$(node bump-version.mjs ${VERSION:-})"
echo "Версия: $VER"

# 2) Синтаксис.
node -c app.js
node -c sw.js
echo "Синтаксис OK"

# 3) Коммит + пуш (Vercel подхватит автоматически).
if git diff --quiet && git diff --cached --quiet; then
  echo "Нет изменений для коммита — пропускаю."
else
  git add -A
  git commit -m "$MSG (v=$VER)" -q
  git push origin main
  echo "Запушено. Vercel соберёт за ~40-45с. Версия: $VER"
fi
