-- Atomic per-day quota counters. Claiming a slot is one conditional upsert, so a burst of
-- simultaneous requests cannot read "0 used" together and all slip through.
create table if not exists quota_usage (
  day date not null,
  key text not null,
  count int not null default 0,
  primary key (day, key)
);
alter table quota_usage enable row level security;
