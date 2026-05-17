-- ============= Admin infrastructure =============

create table if not exists public.admin_sessions (
  telegram_id bigint primary key,
  state text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes')
);
alter table public.admin_sessions enable row level security;
create policy "No public access admin_sessions" on public.admin_sessions for all using (false);
create policy "Service role manages admin_sessions" on public.admin_sessions for all to service_role using (true) with check (true);

create table if not exists public.admin_callbacks (
  token text primary key,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
alter table public.admin_callbacks enable row level security;
create policy "No public access admin_callbacks" on public.admin_callbacks for all using (false);
create policy "Service role manages admin_callbacks" on public.admin_callbacks for all to service_role using (true) with check (true);

create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  admin_telegram_id bigint not null,
  text text not null default '',
  photo_url text,
  audience text not null default 'all', -- all | buyers | active
  status text not null default 'draft', -- draft | sending | done | failed
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  total_count integer not null default 0,
  cursor_telegram_id bigint,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.broadcasts enable row level security;
create policy "No public access broadcasts" on public.broadcasts for all using (false);
create policy "Service role manages broadcasts" on public.broadcasts for all to service_role using (true) with check (true);

create index if not exists idx_broadcasts_status on public.broadcasts (status, created_at desc);

-- Cleanup function for expired sessions/callbacks
create or replace function public.cleanup_admin_expired()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.admin_sessions where expires_at < now();
  delete from public.admin_callbacks where expires_at < now();
end;
$$;

revoke execute on function public.cleanup_admin_expired() from public, anon, authenticated;