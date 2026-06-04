-- Durable, multi-instance fixed-window rate limiting. One row per (scope:id:window) bucket.
create table rate_limit_counters (
  bucket      text primary key,
  count       int not null default 0,
  expires_at  timestamptz not null
);
create index rate_limit_counters_expires_idx on rate_limit_counters (expires_at);
alter table rate_limit_counters enable row level security;
