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

-- One durable quiz session per Telegram group; question snapshots survive restarts.
create table if not exists public.telegram_quiz_sessions (
  chat_id text primary key,
  room text not null,
  questions jsonb not null default '[]'::jsonb,
  current_index integer not null default 0,
  active boolean not null default true,
  status text not null default 'asking',
  updated_at timestamptz not null default now()
);
alter table public.telegram_quiz_sessions enable row level security;
revoke all on public.telegram_quiz_sessions from anon, authenticated;
grant all on public.telegram_quiz_sessions to service_role;

 
-- Telegram group quiz records and one-response-per-student enforcement.
create table if not exists public.telegram_quizzes (
  id text primary key,
  room text not null,
  chat_id text not null,
  message_id bigint,
  question_id text not null,
  question_text text not null,
  options jsonb not null default '[]'::jsonb,
  correct_answer smallint not null check (correct_answer between 0 and 3),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists telegram_quizzes_one_active_per_room
  on public.telegram_quizzes (room) where active = true;

create table if not exists public.telegram_quiz_responses (
  quiz_id text not null,
  user_id text not null,
  display_name text not null,
  selected_option smallint not null check (selected_option between 0 and 3),
  is_correct boolean not null,
  created_at timestamptz not null default now(),
  primary key (quiz_id, user_id)
);

alter table public.telegram_quizzes enable row level security;
alter table public.telegram_quiz_responses enable row level security;
revoke all on public.telegram_quizzes from anon, authenticated;
revoke all on public.telegram_quiz_responses from anon, authenticated;
grant all on public.telegram_quizzes to service_role;
grant all on public.telegram_quiz_responses to service_role;
