# Video Review — персональний сервіс review версій відео

Приватний інструмент для монтажера: завантажуєте MP4-версії в приватну адмінку,
публікуєте активну версію та ділитеся **одним постійним посиланням**, за яким
глядач без реєстрації дивиться ролик і залишає коментарі, прив'язані до таймкоду.

**Ключовий принцип:** *Export → Upload draft → Publish → Share permanent link →
Review independently → Read/resolve timecoded comments*. Сервіс не залежить від
поточного положення таймлайну DaVinci: глядач керує відтворенням самостійно.

## Можливості MVP

- Адмін: проєкти (створення/перейменування/архівування), версії (v1, v2, ...), завантаження
  MP4 з реальним прогресом і cancel/retry, **окрема кнопка «Опублікувати»** (нова
  версія не з'являється у глядача сама), журнали коментарів кожної версії,
  відповіді/статуси «Виконано»/видалення, створення та відкликання гостьового посилання.
- Глядач: постійне посилання `.../#/review/<token>`, плеєр (play/pause/seek/гучність/
  швидкість/fullscreen), маркери коментарів на прогрес-барі, коментарі з таймкодом,
  ім'я запам'ятовується у браузері. Посилання `noindex`, токен можна відкликати.
- Нову версію під час перегляду **не перемикаємо автоматично** — банер
  «Доступна нова версія» + кнопка «Оновити відео».
- Коментарі прив'язані до версії; після опублікування v2 гост бачить v2 і її коментарі,
  а історія v1 залишається адміну.

## Стек

- Frontend: React + TypeScript + Vite, Tailwind CSS, React Router (HashRouter)
- DB/авторизація/сховище/функциї: Supabase (Postgres + RLS, Auth email/password,
  private Storage bucket, Edge Functions)
- Деплой фронтенду: GitLab CI/CD → GitLab Pages
- Тести: Vitest (unit)

## Швидкий старт (mock-режим, без Supabase)

```bash
npm install
npm run dev
```

Якщо `.env.local` не створено, застосунок сам стартує у **mock-режимі** (банер
«MOCK» у лівому кутку): демо-проєкти, відео-заглушка `public/demo/demo-video.mp4`
(~1 МБ, Big Buck Bunny — за бажанням замінюється на власний кліп), локальні
коментарі у localStorage.
- Логін: будь-який email + пароль (mock).
- Передайте демо-guest-посилання: `http://localhost:5173/#/review/mock-review-token`
  (адмінка > проєкт «Демо: реклама кави» > «Посилання для глядача»).

Реальні дані саме у localStorage — це «демо-дані», не production.

## Реальний запуск з Supabase

Повна покрокова інструкція — у [`docs/SETUP.md`](docs/SETUP.md). Коротко:

1. Створіть проєкт у Supabase, виконайте
   `supabase/migrations/0001_initial_schema.sql` у SQL Editor.
2. Створіть користувача-адміна (Auth → Add user, email + пароль) і виконайте
   `insert into public.admin_users (id) values ('<uid>');`.
3. Задайте секрети функцій:
   ```bash
   supabase secrets set ALLOWED_ORIGINS=http://localhost:5173,https://<user>.gitlab.io
   supabase secrets set REVIEW_TOKEN_PEPPER=<random_32_byte>
   ```
4. Задеплойте Edge Functions:
   ```bash
   supabase functions deploy review-read
   supabase functions deploy review-comment
   supabase functions deploy review-refresh-video-url
   supabase functions deploy rotate-review-link
   ```
5. Створіть `.env.local`:
   ```env
   VITE_SUPABASE_URL=https://<project>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<anon|publishable>
   VITE_BASE_PATH=/video-review/   # або /, якщо Pages на власному домені
   ```
6. Push у GitLab → pipeline (`.gitlab-ci.yml`) опублікує static на GitLab Pages.

**Публічний/anon ключ фронтенду — НЕ секрет**: всі чутливі дії захищені RLS,
Edge Functions (гість не має прямого доступу до таблиць) та service_role,
який живе лише у функціях. `SUPABASE_SERVICE_ROLE_KEY` ніколи не має
потрапити у `VITE_*` змінні або у bundle GitLab Pages.

## Формат відео (MVP)

MP4 **H.264 (AVC) + AAC**, `yuv420p`, `+faststart`. Рекомендовано 1080p,
24/25/30 fps, ~4–8 Мбіт/с для швидкого review. Faststart після експорту з
Resolve (якщо не у вбудованій опції):

```bash
ffmpeg -i input.mp4 -c copy -movflags +faststart output.mp4
```

ProRes/MKV/HEVC у браузерах може не відтворюватися — не обіцяємо підтримки.
Сервер жодних даних не конвертує.

## Сервісні команди

```bash
npm run dev        # локальний dev (mock, якщо немає .env.local)
npm run build      # production build vào dist/
npm run preview    # перегляд build
npm run typecheck  # tsc --noEmit
npm run test:run   #.unit-тести (Vitest)
```

## Структура

```
video-review/
├── src/                  # SPA (сторінки, компоненти, lib, тести)
├── supabase/
│   ├── migrations/       # SQL-схема + RLS + RPC
│   └── functions/        # Edge Functions (review-read/comment/refresh/rotate)
├── docs/                 # SETUP / ARCHITECTURE / TEST_PLAN
├── .gitlab-ci.yml        # build → GitLab Pages
└── .env.example
```

## Що чесно НЕ входить у MVP

- Реалтайм (WebSockets/realtime Supabase): оновлення коментарів — polling 25 с + кнопка «Оновити».
- Строгий rate limit: у Edge Functions — простий лімітер в пам'яті інстанса;
  для платформенного ліміту підключіть CDN/WAF або Redis (див. ARCHITECTURE).
- Resumable (TUS) upload: завантаження — прямий XHR PUT/POST з реальним прогресом;
  для файлов у межах плану Supabase цього достатньо.
- Сповіщення, команди, платежі, аналітика, анотації на кадрі, транскрибація — свідомо не робимо.
- Пасольний захист гостьового посилання (тільки bearer-токен) — можна додати наступною ітерацією.

## Ліцензія/користування

Персональний MVP. Перед публічним використанням перевірте актуальні квоти
Supabase (storage, трафік, виклики функцій) і обмеження GitLab Pages.
