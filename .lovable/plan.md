## Контекст и важные предупреждения

Ты просишь переключить этот проект на production Supabase (`tpcnmeerhxmdvbaenfvm`) перед заменой репозитория в Vercel. Прежде чем выполнять — два предупреждения, которые надо учитывать:

### ⚠️ Предупреждение 1: `.env` нельзя редактировать вручную
Файл `.env` в Lovable-проектах **управляется системой** и синхронизируется с подключённым Lovable Cloud (текущий ref: `nrwkriquwmjpdirihwrz`). Любая ручная правка будет перезаписана. Кроме того, `.env` находится в `.gitignore` и **не попадает в репозиторий** — Vercel его не видит.

**Правильный способ задать prod-креды для Vercel** — Vercel Dashboard → Settings → Environment Variables (Production):
- `VITE_SUPABASE_URL = https://tpcnmeerhxmdvbaenfvm.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY = eyJhbGciOiJIUzI1NiIs...goNzglqxKSc-VoLiKS16vFUGHemhhpa97iOfC3EsnH0`
- `VITE_SUPABASE_PROJECT_ID = tpcnmeerhxmdvbaenfvm`

Поэтому **пункт 2 из задачи я выполнять не буду** — он бесполезен и может сломать локальную работу этого Lovable-проекта.

### ⚠️ Предупреждение 2: правка `config.toml` тоже рискованная
Поле `project_id` в `supabase/config.toml` определяет, в какой Supabase-проект Lovable деплоит edge functions из **этого** проекта. Если поменять его на `tpcnmeerhxmdvbaenfvm`, то:
- Lovable перестанет корректно деплоить функции в текущий привязанный backend (`nrwkriquwmjpdirihwrz`).
- Все функции, которые сохраняются «деплой при сохранении», начнут уезжать в чужой проект (или ломаться).

Обычно production-репозиторий — это **отдельный Lovable-проект**, привязанный к prod Supabase через Lovable Cloud, а не переписанный `config.toml`. Если у тебя такой prod-проект уже есть отдельно, то править `config.toml` здесь **не нужно**.

Если ты всё же хочешь использовать **этот** проект как prod-репозиторий и отключаешь его от dev-бэкенда — план ниже выполнит правки. Но я **прошу подтвердить понимание рисков** перед применением.

---

## Что будет сделано (если подтвердишь)

### 1. `supabase/config.toml`
Заменить `project_id`. Блок `[functions.admin-reset-webhooks]` сохраняется.

**Diff:**
```diff
- project_id = "nrwkriquwmjpdirihwrz"
+ project_id = "tpcnmeerhxmdvbaenfvm"

  [functions.admin-reset-webhooks]
  verify_jwt = false
```

### 2. `.env` — НЕ ТРОГАЕМ
Причины см. выше. Вместо этого: задать переменные в Vercel Dashboard.

### 3. `supabase/functions/platform-bot/index.ts` (строка 135)
Заменить fallback-домен в `WEBAPP_DOMAIN`. Основной источник (`Deno.env.get("WEBAPP_URL")`) не трогаем.

**Diff:**
```diff
  const PLATFORM_NAME = "TeleStore";
- const WEBAPP_DOMAIN = Deno.env.get("WEBAPP_URL") || "https://temka-digital-vault.lovable.app";
+ const WEBAPP_DOMAIN = Deno.env.get("WEBAPP_URL") || "https://tele-store.lovable.app";
  const SUPPORT_LINK_DEFAULT = "https://t.me/TeleStoreHelp";
```

После сохранения функция `platform-bot` автоматически передеплоится в текущий Cloud (`nrwkriquwmjpdirihwrz`). Это **повлияет на live-бота прямо сейчас**, если у него секрет `WEBAPP_URL` не выставлен и он реально уходит в fallback. Если `WEBAPP_URL` задан корректно — изменение чисто косметическое (на случай отсутствия переменной).

---

## Что НЕ трогаем (по твоему запросу)

- Миграции в `supabase/migrations/`
- Username ботов и channel ID
- Бизнес-логику и UI
- Файл `src/integrations/supabase/client.ts` (генерируется автоматически)
- Файл `src/integrations/supabase/types.ts` (генерируется автоматически)

---

## Рекомендуемый порядок действий

1. **Подтверди**, что ты понимаешь:
   - `.env` Lovable перезапишет → задавай креды в Vercel Dashboard.
   - `config.toml` после правки отвяжет edge-functions деплой от dev-бэкенда; убедись, что это именно то, чего ты хочешь.
2. После подтверждения я применю **только** правки 1 и 3 (config.toml + platform-bot fallback).
3. Покажу итоговые diff после применения.
4. Ты заходишь в Vercel и:
   - Подключаешь новый репозиторий.
   - В Environment Variables → Production добавляешь 3 переменные `VITE_SUPABASE_*` для `tpcnmeerhxmdvbaenfvm`.
   - Запускаешь Production deploy.

---

## Альтернатива (рекомендую)
Если у тебя уже есть отдельный Lovable-проект под prod (привязанный к `tpcnmeerhxmdvbaenfvm` через Cloud), то:
- В этом dev-проекте **ничего не менять**.
- Перенести изменения в prod-проект через @-меншен (по плану из предыдущих сообщений).
- Vercel переключить на репозиторий prod-проекта.

Скажи, какой вариант выбираешь — и я применю изменения (или не применю, если выберешь альтернативу).