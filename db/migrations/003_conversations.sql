-- A conversation is a thread of turns. A turn is one visitor message and its answer: a research run
-- (run_id), or a short reply from the chat model, or the "please ask research questions" notice.
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id),
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_session_idx on conversations (session_id, updated_at);

create table if not exists turns (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  seq int not null,
  kind text not null check (kind in ('research', 'chat', 'decline')),
  prompt text not null,
  reply text,
  run_id uuid references runs(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (conversation_id, seq)
);
create index if not exists turns_run_idx on turns (run_id);

alter table conversations enable row level security;
alter table turns enable row level security;

-- Runs that predate conversations become one-turn conversations (conversation id = run id).
insert into conversations(id, session_id, title, created_at, updated_at)
  select r.id, r.session_id, left(r.prompt, 80), r.started_at, r.started_at from runs r
  where not exists (select 1 from turns t where t.run_id = r.id)
  on conflict (id) do nothing;
insert into turns(conversation_id, seq, kind, prompt, run_id, created_at)
  select r.id, 1, 'research', r.prompt, r.id, r.started_at from runs r
  where not exists (select 1 from turns t where t.run_id = r.id);
