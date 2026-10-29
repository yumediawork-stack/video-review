-- =============================================================================
-- 0001_initial_schema.sql — Video Review MVP
--
-- Що створює:
--   admin_users    — дозволені адміни (auth.users з ручним додаванням)
--   projects       — проєкти власника (published_version_id → активна версія)
--   video_versions — версії відео (композитні FK перевіряють консистентність)
--   review_links   — хеші гостьових токенів (raw token НІКОЛИ не зберігається)
--   comments       — коментарі, прив'язані до ВЕРСІЇ (композитні FK)
--   RPC: publish_version, create_video_version, set_video_upload_result,
--        set_comment_status, delete_comment
--   Storage: приватний bucket review-videos + політика лише для адмінів
--
-- Політики безпеки:
--   - RLS увімкнено на всіх таблицях;
--   - anon НЕ має жодного доступу (reviewer працює лише через Edge Functions,
--     які виконуються з service_role);
--   - адмін = рядок у admin_users + власник проєкту.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- admin_users
-- -----------------------------------------------------------------------------
create table if not exists public.admin_users (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- SECURITY DEFINER: читання admin_users незалежно від RLS на самій собі.
-- search_path pinning — обов'язково (безпечна поведінка definer-функцій).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where id = auth.uid());
$$;

-- -----------------------------------------------------------------------------
-- projects (published_version_id додається після video_versions)
-- -----------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text check (description is null or char_length(description) <= 2000),
  published_version_id uuid null,
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_owner_idx on public.projects (owner_id);

-- -----------------------------------------------------------------------------
-- video_versions
-- -----------------------------------------------------------------------------
create table if not exists public.video_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  storage_path text not null,
  file_name text check (file_name is null or char_length(file_name) <= 200),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  mime_type text,
  duration_seconds numeric check (duration_seconds is null or duration_seconds >= 0),
  upload_status text not null default 'uploading'
    check (upload_status in ('uploading', 'ready', 'failed')),
  created_at timestamptz not null default now(),
  uploaded_at timestamptz null,
  -- нумерація в межах проєкту
  constraint video_versions_project_number_uq unique (project_id, version_number),
  -- композитна пара для зовнішніх посилань (published_version_id, comments)
  constraint video_versions_id_project_uq unique (id, project_id)
);
create index if not exists video_versions_project_idx on public.video_versions (project_id, version_number);

alter table public.projects
  add constraint projects_published_version_fk
  foreign key (published_version_id, id)
  references public.video_versions (id, project_id)
  on update cascade;

-- -----------------------------------------------------------------------------
-- review_links
-- -----------------------------------------------------------------------------
create table if not exists public.review_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  -- hex(HMAC-SHA256(token, pepper)) або hex(SHA-256(token)) — 64 символи
  token_hash text not null unique check (char_length(token_hash) = 64),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz null,
  updated_at timestamptz not null default now()
);
create index if not exists review_links_project_idx on public.review_links (project_id);

-- -----------------------------------------------------------------------------
-- comments
-- -----------------------------------------------------------------------------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version_id uuid not null references public.video_versions(id) on delete cascade,
  parent_id uuid null,
  author_name text not null check (char_length(btrim(author_name)) between 1 and 60),
  author_role text not null check (author_role in ('admin', 'reviewer')),
  author_user_id uuid null references auth.users(id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  timestamp_seconds numeric(12, 3) not null check (timestamp_seconds >= 0),
  status text not null default 'open' check (status in ('open', 'resolved')),
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- пара (version_id, project_id) має бути валідною з версією — сервер не
  -- довіряє id-шникам з браузера
  constraint comments_version_project_fk
    foreign key (version_id, project_id)
    references public.video_versions (id, project_id),

  -- відповідь мусить бути на корінь ТІЄЇ Ж версії
  constraint comments_id_version_uq unique (id, version_id),
  constraint comments_parent_same_version_fk
    foreign key (parent_id, version_id)
    references public.comments (id, version_id)
    on delete cascade
);
create index if not exists comments_version_created_idx on public.comments (version_id, created_at);
create index if not exists comments_version_ts_idx on public.comments (version_id, timestamp_seconds);
create index if not exists comments_project_status_idx on public.comments (project_id, status) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists trg_projects_updated on public.projects;
create trigger trg_projects_updated before update on public.projects
  for each row execute function public.set_updated_at();

drop trigger if exists trg_review_links_updated on public.review_links;
create trigger trg_review_links_updated before update on public.review_links
  for each row execute function public.set_updated_at();

drop trigger if exists trg_comments_updated on public.comments;
create trigger trg_comments_updated before update on public.comments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RPC: публікація (атомарний pointer)
-- -----------------------------------------------------------------------------
create or replace function public.publish_version(p_project_id uuid, p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_project_of_version uuid;
  v_status text;
begin
  if not is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select v.project_id, v.upload_status
    into v_project_of_version, v_status
  from public.video_versions v
  where v.id = p_version_id;

  if v_project_of_version is null then
    raise exception 'version_not_found' using errcode = 'P0002';
  end if;
  if v_project_of_version <> p_project_id then
    raise exception 'project_mismatch' using errcode = 'P0002';
  end if;
  if v_status <> 'ready' then
    raise exception 'version_not_ready' using errcode = 'P0003';
  end if;

  select p.owner_id into v_owner from public.projects p where p.id = p_project_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- атомарна зміна активної версії (одна команда — одне значення)
  update public.projects
    set published_version_id = p_version_id,
        updated_at = now()
  where id = p_project_id;
end
$$;

revoke execute on function public.publish_version(uuid, uuid) from anon;

-- -----------------------------------------------------------------------------
-- RPC: створення версії з транзакційною нумерацією (з блокуванням рядка проєкту)
-- -----------------------------------------------------------------------------
create or replace function public.create_video_version(
  p_project_id uuid,
  p_file_name text,
  p_size_bytes bigint,
  p_mime_type text,
  p_duration_seconds numeric
)
returns public.video_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_next integer;
  v_row public.video_versions;
begin
  if not is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- row lock на проєкт: одночасні завантаження нумеруються послідовно
  select p.owner_id into v_owner from public.projects p where p.id = p_project_id for update;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next
  from public.video_versions v
  where v.project_id = p_project_id;

  insert into public.video_versions
    (project_id, version_number, storage_path, file_name, size_bytes, mime_type, duration_seconds, upload_status)
  values
    (p_project_id,
     v_next,
     '__pending__' || gen_random_uuid()::text,
     left(coalesce(p_file_name, ''), 200),
     p_size_bytes,
     p_mime_type,
     p_duration_seconds,
     'uploading')
  returning * into v_row;

  update public.video_versions
    set storage_path = p_project_id::text || '/' || v_row.id::text || '/'
                      || regexp_replace(coalesce(p_file_name, 'video.mp4'), '[^A-Za-z0-9._-]+', '_', 'g')
    where id = v_row.id
  returning * into v_row;

  return v_row;
end
$$;

revoke execute on function public.create_video_version(uuid, text, bigint, text, numeric) from anon;

-- -----------------------------------------------------------------------------
-- RPC: завершення upload (сервер сам перевіряє наявність об'єкта в bucket)
-- -----------------------------------------------------------------------------
create or replace function public.set_video_upload_result(p_version_id uuid, p_ok boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_status text;
  v_path text;
  v_exists boolean;
begin
  if not is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select v.upload_status, v.storage_path, p.owner_id
    into v_status, v_path, v_owner
  from public.video_versions v
  join public.projects p on p.id = v.project_id
  where v.id = p_version_id;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_status in ('ready', 'draft') then
    return; -- вже фіналізовано
  end if;

  if p_ok then
    select exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'review-videos'
        and o.name = v_path
    )
    into v_exists;
    if not v_exists then
      raise exception 'storage_object_missing' using errcode = 'P0003';
    end if;
    update public.video_versions
      set upload_status = 'ready',
          uploaded_at = coalesce(uploaded_at, now())
    where id = p_version_id;
  else
    update public.video_versions
      set upload_status = 'failed'
    where id = p_version_id;
  end if;
end
$$;

revoke execute on function public.set_video_upload_result(uuid, boolean) from anon;

-- -----------------------------------------------------------------------------
-- RPC: статус коментаря (тільки адмін)
-- -----------------------------------------------------------------------------
create or replace function public.set_comment_status(p_comment_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if not is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('open', 'resolved') then
    raise exception 'bad_status' using errcode = 'P0003';
  end if;

  select p.owner_id into v_owner
  from public.comments c
  join public.projects p on p.id = c.project_id
  where c.id = p_comment_id;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.comments
    set status = p_status
  where id = p_comment_id;
end
$$;

revoke execute on function public.set_comment_status(uuid, text) from anon;

-- -----------------------------------------------------------------------------
-- RPC: м'яке видалення коментаря (документована політика видалення)
-- -----------------------------------------------------------------------------
create or replace function public.delete_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if not is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select p.owner_id into v_owner
  from public.comments c
  join public.projects p on p.id = c.project_id
  where c.id = p_comment_id;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- м'яке видалення: рядок залишається, відображається фільтром
  update public.comments
    set deleted_at = now()
  where id = p_comment_id;
end
$$;

revoke execute on function public.delete_comment(uuid) from anon;

-- -----------------------------------------------------------------------------
-- RLS увімкнення
-- -----------------------------------------------------------------------------
alter table public.admin_users   enable row level security;
alter table public.projects      enable row level security;
alter table public.video_versions enable row level security;
alter table public.review_links  enable row level security;
alter table public.comments      enable row level security;

-- anon: кнопка «ні» — жодних прямих доступів (reviewer тільки через Edge Functions)
revoke all on public.admin_users from anon;
revoke all on public.projects from anon;
revoke all on public.video_versions from anon;
revoke all on public.review_links from anon;
revoke all on public.comments from anon;

-- admin_users: бачити тільки себе (для UI); оновлень немає
create policy admin_users_select_self on public.admin_users
for select to authenticated
using (id = auth.uid());

-- projects: CRUD лише адміну-власнику
create policy projects_admin_all on public.projects
for all to authenticated
using (public.is_admin() and owner_id = auth.uid())
with check (public.is_admin() and owner_id = auth.uid());

-- video_versions: адмін, який володіє цим проєктом
create policy video_versions_admin_all on public.video_versions
for all to authenticated
using (
  public.is_admin()
  and exists (
    select 1 from public.projects p
    where p.id = video_versions.project_id
      and p.owner_id = auth.uid()
  )
)
with check (
  public.is_admin()
  and exists (
    select 1 from public.projects p
    where p.id = video_versions.project_id
      and p.owner_id = auth.uid()
  )
);

-- review_links: адмін лише читає стан (ротація — через Edge Function)
create policy review_links_admin_select on public.review_links
for select to authenticated
using (
  public.is_admin()
  and exists (
    select 1 from public.projects p
    where p.id = review_links.project_id
      and p.owner_id = auth.uid()
  )
);

-- comments: адмін-модерація у своїх проєктах
create policy comments_admin_all on public.comments
for all to authenticated
using (
  public.is_admin()
  and exists (
    select 1 from public.projects p
    where p.id = comments.project_id
      and p.owner_id = auth.uid()
  )
)
with check (
  public.is_admin()
  and exists (
    select 1 from public.projects p
    where p.id = comments.project_id
      and p.owner_id = auth.uid()
  )
);

-- -----------------------------------------------------------------------------
-- Storage: приватний bucket (guest отримує короткоживучий signed URL через
-- Edge Function; прямого доступу в гостів немає)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('review-videos', 'review-videos', false, null)
on conflict (id) do nothing;

-- service_role має доступ за замовчуванням; для authenticated — тільки админи
create policy storage_admin_all_review_videos on storage.objects
for all to authenticated
using (bucket_id = 'review-videos' and public.is_admin())
with check (bucket_id = 'review-videos' and public.is_admin());

-- ------------------------------------------------------------------------------
-- ПРИМІТКА для налаштування першого адміна (виконується вручну, див. docs/SETUP.md):
--   insert into public.admin_users (id) values ('<auth.users uid в Supabase Dashboard>');
-- ------------------------------------------------------------------------------
