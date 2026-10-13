create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  ip_hash text not null,
  user_agent text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (device_id, ip_hash)
);

create table if not exists runs (
  id uuid primary key,
  session_id uuid not null references sessions(id),
  prompt text not null,
  status text not null check (status in ('running', 'finished', 'failed')),
  config jsonb not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cost_usd numeric(12, 6) not null default 0,
  error text,
  reserved_usd numeric(12, 6) not null default 0,
  reserved_searches int not null default 0,
  ledger_day date not null,
  settled boolean not null default false
);
create index if not exists runs_started_idx on runs (started_at);
create index if not exists runs_session_idx on runs (session_id);

create table if not exists events (
  run_id uuid not null references runs(id) on delete cascade,
  seq int not null,
  type text not null,
  payload jsonb not null,
  ts timestamptz not null,
  primary key (run_id, seq)
);

create table if not exists model_calls (
  id bigserial primary key,
  run_id uuid not null references runs(id) on delete cascade,
  stage text not null,
  model text not null,
  request jsonb,
  response jsonb,
  http_status int,
  latency_ms int,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(12, 8) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists model_calls_run_idx on model_calls (run_id);

create table if not exists pages (
  id bigserial primary key,
  run_id uuid not null references runs(id) on delete cascade,
  url text not null,
  fetch_status text not null,
  error text,
  content_type text,
  markdown text,
  bytes int,
  created_at timestamptz not null default now(),
  unique (run_id, url)
);

create table if not exists reconnects (
  id bigserial primary key,
  run_id uuid not null references runs(id) on delete cascade,
  session_id uuid references sessions(id),
  run_active boolean not null,
  created_at timestamptz not null default now()
);

create table if not exists spend_ledger (
  day date primary key,
  reserved_usd numeric(12, 6) not null default 0,
  actual_usd numeric(12, 6) not null default 0,
  search_reserved int not null default 0,
  search_used int not null default 0
);

-- Supabase exposes the public schema through PostgREST. These tables hold visitor
-- data, so deny the anon/authenticated roles entirely. The server connects with the
-- database owner role, which bypasses RLS.
alter table sessions enable row level security;
alter table runs enable row level security;
alter table events enable row level security;
alter table model_calls enable row level security;
alter table pages enable row level security;
alter table reconnects enable row level security;
alter table spend_ledger enable row level security;
