-- AgentAuth initial schema (Postgres / Supabase compatible)
-- Model: Project -> Environment (auth boundary) -> Integration (provider config) -> Connection (per end-user)

create extension if not exists pgcrypto;

create table projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Environment is the auth boundary: it owns the API keys and scopes every lookup.
create table environments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null,                       -- 'dev' | 'prod'
  created_at  timestamptz not null default now(),
  unique (project_id, name)
);

create table api_keys (
  id              uuid primary key default gen_random_uuid(),
  environment_id  uuid not null references environments(id) on delete cascade,
  type            text not null check (type in ('secret','publishable')),
  key_hash        text not null,                   -- pbkdf2 hash; raw key shown once at creation
  key_prefix      text not null,                   -- display hint, e.g. 'sk_ab12cd34'
  last_used_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index api_keys_key_hash_idx on api_keys (key_hash);
create index api_keys_env_idx on api_keys (environment_id);

-- Per-environment provider configuration (the "Provider-Config-Key").
create table integrations (
  id                       uuid primary key default gen_random_uuid(),
  environment_id           uuid not null references environments(id) on delete cascade,
  provider                 text not null,          -- registry slug: 'google' | 'github' | ...
  display_name             text,
  oauth_client_id          text,
  oauth_client_secret_enc  text,                   -- envelope-encrypted
  scopes                   text[] not null default '{}',
  created_at               timestamptz not null default now(),
  unique (environment_id, provider)
);

-- Per-end-user credential link. credentials_enc holds the vaulted tokens.
create table connections (
  id                 uuid primary key default gen_random_uuid(),
  environment_id     uuid not null references environments(id) on delete cascade,
  integration_id     uuid not null references integrations(id) on delete cascade,
  provider           text not null,
  end_user_id        text not null,                -- the developer's user id (their choice)
  status             text not null default 'pending'
                       check (status in ('pending','active','expired','revoked')),
  credentials_enc    text,                         -- envelope-encrypted JSON {access_token, refresh_token, ...}
  connection_config  jsonb not null default '{}',  -- per-connection vars (subdomain, instance_url)
  metadata           jsonb not null default '{}',
  granted_scopes     text[] not null default '{}',
  expires_at         timestamptz,                  -- access-token expiry (null = non-expiring)
  refresh_attempts   int not null default 0,
  refresh_exhausted  boolean not null default false,
  last_refresh_error text,
  last_active_at     timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (environment_id, provider, end_user_id)
);
create index connections_lookup_idx on connections (environment_id, provider, end_user_id);

-- Transient OAuth handshake state (PKCE verifier, requested scopes, etc.)
create table oauth_sessions (
  id                 uuid primary key default gen_random_uuid(),
  environment_id     uuid not null references environments(id) on delete cascade,
  integration_id     uuid not null references integrations(id) on delete cascade,
  provider           text not null,
  end_user_id        text not null,
  state              text not null unique,
  code_verifier      text,
  redirect_uri       text,                         -- optional: where to send the user after success
  scopes             text[] not null default '{}',
  connection_config  jsonb not null default '{}',
  expires_at         timestamptz not null,
  created_at         timestamptz not null default now()
);
create index oauth_sessions_state_idx on oauth_sessions (state);

-- MACU metering: distinct active connected users per environment per month (the billing metric).
create table monthly_active_users (
  environment_id  uuid not null references environments(id) on delete cascade,
  year_month      text not null,                   -- 'YYYY-MM' (UTC)
  end_user_id     text not null,
  provider        text not null,                   -- provider of first activity that month
  first_seen_at   timestamptz not null default now(),
  primary key (environment_id, year_month, end_user_id)
);

-- Audit log (credential-free).
create table request_logs (
  id              bigint generated always as identity primary key,
  environment_id  uuid not null references environments(id) on delete cascade,
  connection_id   uuid references connections(id) on delete set null,
  provider        text,
  method          text,
  path            text,
  status          int,
  duration_ms     int,
  created_at      timestamptz not null default now()
);
create index request_logs_env_time_idx on request_logs (environment_id, created_at);
