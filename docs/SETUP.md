# SETUP — налаштування з нуля до працюючого production

Покрокова інструкція. Усе, що поза репозиторієм, позначено `[Ручна дія]`.

## 0. Вимоги

- Node.js LTS (протестовано на 20+), npm
- Supabase акаунт (безкоштовного плану достатньо для старту)
- GitLab акаунт
- (опційно) `npm i -g supabase` — CLI для деплою функцій і секретів

## 1. Локальний запуск у mock-режимі (перевірка «з коробки»)

```bash
npm install
npm run dev
```

- Відкрийте `http://localhost:5173` — у лівому куті банер «MOCK».
- `/login`: будь-який email і пароль (mock демонструє інтерфейс, не реальну авторизацію).
- Демо-глядач: `http://localhost:5173/#/review/mock-review-token`.

Це демо-дані у localStorage, не production-сховище.

## 2. Створення проєкту Supabase

1. [Ручна дія] https://supabase.com → New project. Регіон — найближчий до вас (напр., Варшава/Франкфурт).
2. Зберегліть URL проєкту: `https://<PROJECT-REF>.supabase.co` та ключі з Dashboard → API.

## 3. Схема бази даних

Варіант A (Dashboard):

1. [Ручна дія] Dashboard → SQL Editor → New query.
2. [Ручна дія] Вставте увесь вміст `supabase/migrations/0001_initial_schema.sql` → Run.
3. [Ручна дія] Table Editor — перевірте наявність 5 таблиць (admin_users, projects,
   video_versions, review_links, comments) та bucket `review-videos` (Storage → Settings).

Варіант B (CLI):

```bash
supabase link --project-ref <PROJECT-REF>
supabase db push
```

Міграція створює RLS-політики: `anon` повністю відсікається; reviewer працює
лише через Edge Functions із service_role.

## 4. Адміністратор

Публічної реєстрації немає — користувача створюють вручну:

1. [Ручна дія] Dashboard → Authentication → Users → Add user → email + пароль.
2. [Ручна дія] SQL Editor: додайте UID до дозволених адмінів
   ```sql
   insert into public.admin_users (id) values ('<UID з Authentication → Users>');
   ```
3. Додаткових адмінів — тим самим способом (кожен має бути і власником своїх проєктів).

## 5. Секрети Edge Functions

```bash
supabase login
supabase link --project-ref <PROJECT-REF>

# CORS: перелік origin фронтенду (dev + production), через кому, без пробілів
supabase secrets set ALLOWED_ORIGINS=http://localhost:5173,http://localhost:4173,https://username.github.io

# Pepper для хешування review-токенів (випадкові 32 байти)
openssl rand -hex 32
supabase secrets set REVIEW_TOKEN_PEPPER=<значення з попередньої команди>
```

УВАГА:

- зміна `REVIEW_TOKEN_PEPPER` анулює всі активні посилання — доведеться перевипустити нові;
  це задокументовано в docs/ARCHITECTURE.md;
- коли production URL відомий, переконайтеся, що він у ALLOWED_ORIGINS, інакше браузери
  отримають CORS-відмову.

## 6. Деплой Edge Functions

```bash
supabase functions deploy review-read
supabase functions deploy review-comment
supabase functions deploy review-refresh-video-url
supabase functions deploy rotate-review-link
```

Перевірка (очікується JSON із `invalid_or_revoked_link` — це нормальна поведінка
для нерозпізнаного токена):

```bash
curl -s -X POST "https://<PROJECT-REF>.supabase.co/functions/v1/review-read" \
  -H "Authorization: Bearer <ANON-KEY>" \
  -H "Content-Type: application/json" \
  -d '{"token":"неправильнийтокеннеправильнийтокен12"}'
```

## 7. Налаштування фронтенду

```bash
cp .env.example .env.local
```

```env
VITE_SUPABASE_URL=https://<PROJECT-REF>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable/anon ключ із Dashboard → API>
VITE_BASE_PATH=/video-review/
```

- `VITE_BASE_PATH` має збігатися з реальною адресою Pages:
  - `https://username.github.io/video-review/` (project site) → `/video-review/`;
  - власний домен або user site `https://username.github.io/` → `/`.
- НІКОЛИ не додавайте service_role ключ у `VITE_*` — він не для фронтенду.

## 8. GitLab: репозиторій, CI/CD, Pages

1. [Ручна дія] Створіть репозиторій `video-review` (Settings → видимість — приватна).
2. [Ручна дія] Push у default гілку (`main`):
   ```bash
   git init && git add -A && git commit -m "MVP"
   git remote add origin https://github.com/username/video-review.git
   git push -u origin main
   ```
3. [Ручна дія] Settings → CI/CD → Variables: додайте
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_BASE_PATH`
   (Secrets/Variables). U  ці значення використані через secrets/vars.
4. [Ручна дія] Pipeline: build → artifacts `public/` → Pages має стати доступним на
   `https://username.github.io/video-review/`.
5. [Ручна дія] Додайте цей origin до `ALLOWED_ORIGINS`, якщо ще не додали.
6. [Ручна дія] Перевірте: `.../#/login` відкривається напряму (HashRouter не потребує
   серверних rewrites).

## 9. Перший прогін (адмінка)

1. `.../#/login` → увійти.
2. Створіти проєкт → перетягніть MP4 (H.264/AAC) → одночасно слідкуйте за прогресом.
3. Плеєр прев'ю виступає чернеткою; натисніть «Опублікувати цю версію» → підтвердити.
4. «Створити посилання» → скопіюйте токен одразу (потім його неможливо відновити).
5. Відкрийте `.../#/review/<token>` у приватному вікні — той самий плеєр + коментарі.

## 10. Обмеження і квоти (перевіряйте за актуальними тарифами)

- Supabase: обсяг storage, трафік, максимальний розмір загрузки, виклики функцій → <https://supabase.com/pricing>
- GitHub Pages: квоти безкоштовного plan → <https://docs.github.com/en/pages/getting-started-with-github-pages>
- Жодних «зашитих» припущень «максимум 1 ГБ»: адмін сам визначає обмеження плану.
- При вичерпанні квот розгляньте S3-сумісне сховище (R2/B2): заміна ізольована у
  Edge Functions (`createSignedUrl`) та шляхах збереження.

## 11. Типові проблеми

| Симптом | Причина | Дія |
|---|---|---|
| CORS-помилка браузера | origin не в ALLOWED_ORIGINS | `supabase secrets set ALLOWED_ORIGINS=...` |
| «Посилання більше не активне» | токен відкликано або неправильний | створіть нове посилання в адмінці |
| Відео перестало грати (403) | спливший signed URL (≈2 год) | кнопка оновлення / перезавантаження сторінки |
| Гость не бачить v2 після publish | кеш браузера | жорстке перезавантаження; посилання постійне, версія міняється |
| «Версія не готова до публікації» | upload ще в процесі або failed | дочекайтеся статусу «Чернетка» / retry |
