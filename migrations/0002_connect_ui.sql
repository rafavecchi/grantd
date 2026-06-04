-- Hosted Connect UI: a short-lived, browser-safe session that lets an end-user connect
-- providers from a Grantd-hosted page (no secret key in the browser).
create table connect_ui_sessions (
  id                uuid primary key default gen_random_uuid(),
  environment_id    uuid not null references environments(id) on delete cascade,
  end_user_id       text not null,
  token             text not null unique,
  allowed_providers text[],                 -- null = all providers configured for the environment
  redirect_uri      text,                   -- where the "Done" button sends the user
  expires_at        timestamptz not null,
  created_at        timestamptz not null default now()
);
create index connect_ui_sessions_token_idx on connect_ui_sessions (token);

alter table connect_ui_sessions enable row level security;
