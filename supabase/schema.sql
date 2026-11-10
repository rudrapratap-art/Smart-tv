-- Smart Classroom: persistent question bank and per-room presentation state.
-- All client-facing access is denied; the Node server uses the server-only service role key.
create table if not exists public.questions (
  id text primary key,
  cls text not null default '',
  subject text not null default '',
  chapter text not null default '',
  hi text not null default '',
  en text not null default '',
  opts jsonb not null default '[]'::jsonb,
  answer smallint not null default 0 check (answer between 0 and 3),
  explain text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.classroom_state (
  room text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.questions enable row level security;
alter table public.classroom_state enable row level security;
revoke all on public.questions from anon, authenticated;
revoke all on public.classroom_state from anon, authenticated;
grant all on public.questions to service_role;
grant all on public.classroom_state to service_role;
