create extension if not exists vector;

create table if not exists schema_migrations (
  version text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);

create table if not exists workspaces (
  id uuid primary key default uuidv7(),
  slug text not null,
  name text not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint uq_workspaces_slug unique (slug)
);

create table if not exists credentials (
  id uuid primary key default uuidv7(),
  workspace_id uuid not null references workspaces(id),
  name text not null,
  kind text not null,
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  key_version integer not null default 1,
  masked_hint text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_credentials_workspace_name unique (workspace_id, name),
  constraint ck_credentials_kind check (kind in ('api_key', 'bearer', 'basic', 'oauth2', 'hmac'))
);

create index if not exists ix_credentials_workspace
  on credentials (workspace_id);
