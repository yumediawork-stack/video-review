# ARCHITECTURE — як влаштований Video Review MVP

## 1. Загальна картина

```
┌────────────────────────┐         ┌───────────────────────────────┐
│ GitLab Pages (static)  │         │ Supabase                      │
│ React SPA, HashRouter  │  HTTPS  │ ├─ Edge Functions (Deno)      │
│ ─ review/:token        │────────▶│ │   review-read / comment /   │
│ ─ admin (auth scopes)  │         │ │   refresh-video-url / rotate│
│ ─ Supabase Auth JWT    │         │ ├─ Postgres + RLS             │
└────────────────────────┘         │ ├─ Auth (email/password)      │
        ▲                          │ └─ Storage private bucket     │
        │ Нові версії не          │    review-videos              │
        │ ламають посилання       └───────────────────────────────┘
Глядач → постійний URL → остання «опублікована» версія
```

Ключові рішення:

1. **Постійне посилання** — UUID-токен проєкту: `published_version_id` — єдиний
   вказівник активної версії; ротація версій не змінює URL глядача.
2. **«Остання завантажена ≠ остання опублікована»** — статуси
   `uploading → ready (draft) → published`; publish — атомарний RPC.
3. **Коментар прив'язаний до версії** — `comments.version_id` +
   композитний `FK (version_id, project_id) → video_versions (id, project_id)`.
   Немає можливості «повісити коментар на чужу версію» навіть підміненим запитом.
4. **Гість не має прямого доступу до БД** — RLS повністю закриває `anon`;
   гостьові читання/записи йдуть через Edge Functions під service_role
   і проходять перевірку хешу токена.

## 2. Рівні безпеки

| Механізм | Де | Що захищає |
|---|---|---|
| RLS, `anon` revoked | Postgres | гість не читає таблиці напряму |
| RLS, admin = `admin_users` + власник | Postgres | чужі проєкти/коментарі |
| Hash-only токени (HMAC-SHA256 з pepper) | review_links | витік БД ≠ витік посилань |
| Signed URL, TTL 7200 с | Storage | тимчасовий доступ до файлу |
| service_role тільки в Edge Functions | runtime env | секрети не у frontend |
| Zod-валідація тіл, токен у body (не в query) | Edge Functions | логи не містять токенів |
| CORS allowlist (`ALLOWED_ORIGINS`) | Edge Functions | не «*» для приватної API |
| Rate limit (в пам'яті інстанса) | Edge Functions | базовий захист від спаму |

Обмеження чесно: rate limiter — локальний для інстанса функції (fixed window,
скидається при cold start). Це НЕ строгий ліміт. Для платформенного контролю
підключіть L7-файрвол / Upstash Redis / Supabase WAF.

Token hash: `hex(HMAC-SHA256(token, REVIEW_TOKEN_PEPPER))`; без pepper —
`hex(SHA-256(token))`. Pepper змінювати небезпечно для активних посилань
(доведеться перевипустити). Raw токен існує рівно один раз при створенні.

## 3. Модель даних

- `admin_users (id → auth.users)`, функція `is_admin()` — SECURITY DEFINER, `search_path` pinned.
- `projects`: owner, title/description, `published_version_id` (СКЛАДНИЙ FK
  `(published_version_id, id) → video_versions (id, project_id)` дає гарантію, що
  активна версія належить цьому ж проєкту — навіть без тригерів), `archived_at`.
- `video_versions`: `version_number` UNIQUE у межах проєкту (номер призначає RPC
  `create_video_version` з row-lock на проєкт — без «count+1» гонок),
  `storage_path`, `upload_status ∈ {uploading, ready, failed}`,
  `duration_seconds` (client metadata, не доказ integrity).
- `review_links`: `token_hash` UNIQUE, `is_active`, `revoked_at`. Активних >1 бути
  не повинно — ротація деактивує попередні.
- `comments`: прив'язка `(version_id, project_id)`, відповідь — `(parent_id,
  version_id) → comments (id, version_id)`: відповідь можлива лише на корінь ТІЄЇ Ж
  версії, 1 рівень вкладень. Видалення — м'яке (`deleted_at`), документована політика:
  видалений корінь ховає гілку; фільтр на читанні — `deleted_at is null`.

## 4. API контракт (Edge Functions)

Всі — POST, тіло JSON, голос `Cache-Control: no-store`.
Помилка: `{ "error": { "code": string, "message": string } }`.

### review-read `{ token }` →
```
200 { project: { title, description },
      version: { id, number, durationSeconds },
      video: { signedUrl, expiresAt },
      comments: [{ id, parentId, authorName, authorRole, body,
                   timestampSeconds, status, createdAt, updatedAt }],
      revision: string (opaque = version id) }
401 invalid_or_revoked_link | 404 no_published_version | 429 too_many_requests
```
Клієнт пінгує кожні 25 с; якщо `revision` змінився → банер (без автоперемикання).

### review-comment `{ token, versionId, parentId?, authorName, text, timestampSeconds }` →
```
200 Comment            (саме тіло, що у comments-масиві)
400 invalid_input      (валідація тексту/імен/таймкод/гілка)
409 version_changed    (versionId ≠ published_version_id)
429 too_many_requests
```
Обидва серверні перевірки дублюють клієнтські (Zod). Таймкод: `0 ≤ t ≤ duration+1.5`,
де duration — з БД (якщо відома; client duration не доказ).

### review-refresh-video-url `{ token, versionId }` →
```
200 { signedUrl, expiresAt }
409 version_changed | 403 invalid_or_revoked_link
```

### rotate-review-link (JWT адміна у Authorization) `{ projectId, action }` →
```
200 { token } (action=create, raw токен тільки тут)
200 { ok }    (action=revoke)
401/403/404
```

### Помилки та CORS
- `ALLOWED_ORIGINS` — кома-separated; dev-дефолт localhost. Звернення без Origin
  (curl) не підпадають під CORS.
- Коди: 400 invalid_input · 401/403 invalid_or_revoked_link · 404
  no_published_version/not_found · 409 version_changed · 429 too_many_requests · 500 internal_error · 403 cors_rejected.

## 5. Потоки (завантаження/публикація)

1. Адмін обирає MP4 → клієнтська перевірка (розширення/MIME/розмір) +
   `loadedmetadata` (тривалість — попередньо, не доказ).
2. RPC `create_video_version` (row-lock проєкту) → row зі статусом `uploading`
   і фінальним `storage_path` (`<projectId>/<versionId>/<назва>`).
3. XHR POST в `https://<URL>/storage/v1/object/review-videos/<storagePath>` з JWT
   адміна → реальний прогрес, cancel, retry. Цілком приватний bucket.
4. RPC `set_video_upload_result(ok=true)` — сервер САМ перевіряє наявність об'єкта
   через `storage.objects`, тільки тоді `ready` («чернетка»); інакше `failed`.
5. Кнопка «Опублікувати» → RPC `publish_version` → атомарне оновлення
   `projects.published_version_id`. Нова версія НІКОЛИ не публікується автоматично.
6. Денні старих версій НЕ видаляються — історія коментарів/версій зберігається адміну.

## 6. Взаємодія клієнтів

- **Admin** — Supabase JS під RLS (профіль собі), критичні дії — RPC;
  rotate — Edge Function з JWT.
- **Guest** — тільки 3 Edge Functions; плеєр — `<video>` з signed URL
  (range requests → працює seek); спливання URL → авторефреш з
  збереженням `currentTime` (максимум 2 спроби, щоб уникнути циклу).
- **Polling**: 25 с. Жодних realtime/WebSockets у MVP (свідомо).
- **Race conditions**: fetch захищені request ID (послідовність) — відповіді
  старих запитів ігноруються; в плеєрі pending seek до `loadedmetadata`.

## 7. Що свідомо НЕ включено

Тому що порушувало б «маленький надійний персональний MVP»: realtime-канал,
команди/ролі, аналітика, сповіщення, перекодування на сервері, TUS (додаткова
залежність без потреби при поточному плані), пароль на review-посиланні
(щось наступної ітерації), порівняння v1/v2, експорт CSV.
