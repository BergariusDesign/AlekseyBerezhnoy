# Stats Worker — статистика просмотров (Cloudflare Worker + D1)

Serverless-бэкенд для счётчика просмотров видео портфолио.
Заменяет неработающий CounterAPI. Полностью бесплатно (план Cloudflare Free).

## Архитектура

```
GitHub Pages (index.html, stats.js)
        ↓  POST /api/view          (публичный, CORS: только домен портфолио)
        ↓  POST /api/admin/login   (пароль — секрет Worker, сессия — HttpOnly cookie)
        ↓  GET  /api/admin/stats   (только с валидной сессией, иначе 401)
Cloudflare Worker
        ↓
Cloudflare D1 (SQLite)
   videos: справочник видео
   views:  события просмотров (video_id + viewed_at)
``+

Никакого VPS, Docker и платных БД.

## Установка (пошагово, команды готовы к копированию)

### 0. Предварительные требования

- Установлен Node.js (18+) — https://nodejs.org
- Аккаунт Cloudflare (бесплатный) — https://dash.cloudflare.com/sign-up

### 1. Логин в Cloudflare из терминала

```bash
npx wrangler login
```

Откроется браузер → подтвердить доступ.

### 2. Создать D1 database

```bash
npx wrangler d1 create portfolio-stats
```

Вывод команды содержит `database_id` — скопируй его.

### 3. Привязать D1 к Worker

Открой `stats-worker/wrangler.toml` и вставь свой `database_id`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "portfolio-stats"
database_id = "<СЮДА ТВОЙ database_id>"
``+

### 4. Выполнить schema.sql (миграция)

```bash
npx wrangler d1 execute portfolio-stats --remote --file=./schema.sql
```

Создаст таблицы `videos`, `views` и заполнит справочник (magic, showreel, woman, watch).

### 5. Установить ADMIN_PASSWORD (секрет)

```bash
npx wrangler secret put ADMIN_PASSWORD
```

Команда запросит значение — введи свой пароль админа (он НЕ попадает в код,
хранится только на стороне Cloudflare).

### 6. Деплой Worker

```bash
npx wrangler deploy
```

После деплоя в выводе будет URL, например:

```
https://aleksey-portfolio-stats.<твой-subdomain>.workers.dev
```

### 7. Вставить URL Worker в портфолио

Открой `stats.js` в корне сайта и замени:

```js
const STATS_API_BASE = 'https://aleksey-portfolio-stats.<твой-subdomain>.workers.dev';
```

на свой URL. Больше в `index.html` ничего менять не нужно:
`stats.js` подключён и перехватывает старые функции.

## Проверка API

```bash
# живость
curl https://<worker-url>/api/health

# записать просмотр
curl -X POST https://<worker-url>/api/view \
  -H "Content-Type: application/json" \
  -H "Origin: https://bergariusdesign.github.io" \
  -d '{"videoId":"magic"}'

# без авторизации → 401
curl https://<worker-url>/api/admin/stats

# логин (пароль — тот, что задан в секрете)
curl -X POST https://<worker-url>/api/admin/login \
  -H "Content-Type: application/json" \
  -H "Origin: https://bergariusdesign.github.io" \
  -d '{"password":"<твой-пароль>"}' -c cookies.txt

# статистика с сессией
curl https://<worker-url>/api/admin/stats \
  -H "Origin: https://bergariusdesign.github.io" \
  -b cookies.txt

# логаут
curl -X POST https://<worker-url>/api/admin/logout \
  -H "Origin: https://bergariusdesign.github.io" \
  -b cookies.txt
``+

Данные в D1 можно смотреть напрямую:

```bash
npx wrangler d1 execute portfolio-stats --remote \
  --command "SELECT video_id, COUNT(*) FROM views GROUP BY video_id"
```

## Как считается просмотр

- **Короткие видео (< 60 сек):** просмотр засчитывается после **3 секунд** проигрывания.
- **Длинные:** после достижения **25% длительности** (но не раньше 3 сек).
- **Deduplication:** одно видео = один просмотр на сессию страницы
  (перезапуск/перемотка/пауза не создают новых просмотров; новый просмотр —
  только после перезагрузки страницы).
- **Rate limit на сервере:** максимум 10 событий в минуту с одного источника,
  максимум 3 на одно видео.

## Логика админ-авторизации

1. `POST /api/admin/login` — пароль сверяется **на сервере** с секретом `ADMIN_PASSWORD`.
2. При успехе Worker создаёт сессионный токен (128-bit random) и ставит cookie
   `admin_session` — **HttpOnly + Secure + SameSite=Strict**.
3. `GET /api/admin/stats` требует валидный cookie, иначе **401**.
4. `POST /api/admin/logout` удаляет сессию.
5. Пароль и его hash **никогда не попадают в клиентский JavaScript**.

Сессии живут в памяти Worker-изолята до 12 часов; перезапуск изолята
(редко) просто разлогинивает — это нормально для портфолио.

## Rollback

Если что-то сломалось:

1. Удалить строку `<script src="stats.js" defer></script>` из `index.html`.
2. Вернуть `checkAdminPassword`, `loadAdminStats`, `updateViewCount` из
   git-истории (старый обфусцированный блок остаётся нетронутым — stats.js
   его только перехватывает, не удаляет).
3. Отключить Worker: `npx wrangler delete` или выключить в дашборде Cloudflare.

D1-база и накопленные данные при этом сохранятся.
