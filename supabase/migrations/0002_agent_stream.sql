-- =============================================================================
-- 0002_agent_stream.sql — трансляція відео напряму з ПК редактора (без upload)
--
-- Ідея: агент (маленький Node-скрипт) на комп'ютері монтажера serveрве MP4
-- по HTTP з Range-запитами через публічний тунель; Supabase БД зберігає
-- ЛИШЕ базовий URL агента + метадані. Гість отримує URL поточної версії
-- через Edge Function; БД не роздувається відеофайлами.
--
-- agent_links — ключ агента (hash-only, як review_links): адмін активує
-- ключ в панелі один раз, агент конфігурується ним і надсилає announce.
-- =============================================================================

-- Модель джерела відео для версії: завантажений файл або live-агент
alter table public.video_versions
  add column media_source text not null default 'storage'
    check (media_source in ('storage', 'agent')),
  add column agent_url text,           -- базовий URL тунеля агента (без trailing slash)
  add column agent_updated_at timestamptz null; -- останній announce/heartbeat

create index if not exists video_versions_agent_media_idx
  on public.video_versions (project_id, media_source);

-- Ключі агентів (hash-only; raw token повертається админові один раз)
create table if not exists public.agent_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz null,
  updated_at timestamptz not null default now()
);
create index if not exists agent_links_project_idx on public.agent_links (project_id);

drop trigger if exists trg_agent_links_updated on public.agent_links;
create trigger trg_agent_links_updated before update on public.agent_links
  for each row execute function public.set_updated_at();

-- RLS: тільки адмін-власник читає стан; запис іде лише через Edge Function (service_role)
alter table public.agent_links enable row level security;
revoke all on public.agent_links from anon;

create policy agent_links_admin_select on public.agent_links
for select to authenticated
using (
  public.is_admin()
  and exists (
    select 1 from public.projects p
    where p.id = agent_links.project_id
      and p.owner_id = auth.uid()
  )
);
