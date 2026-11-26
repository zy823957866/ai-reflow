create table if not exists skills (
  id text primary key,
  name text not null,
  publisher text not null,
  summary text not null default '',
  type text not null,
  visibility text not null default 'verified',
  license text not null default 'MIT',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_skills_type check (type in ('prompt', 'tool', 'code')),
  constraint ck_skills_visibility check (visibility in ('official', 'verified', 'community'))
);

create table if not exists skill_installs (
  id uuid primary key default uuidv7(),
  public_id text not null,
  workspace_id uuid not null references workspaces(id),
  skill_id text not null references skills(id),
  version text not null,
  previous_version text,
  manifest_snapshot jsonb not null,
  permissions jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_skill_installs_workspace_public unique (workspace_id, public_id),
  constraint uq_skill_installs_workspace_skill unique (workspace_id, skill_id)
);

create table if not exists skill_mounts (
  id uuid primary key default uuidv7(),
  workspace_id uuid not null references workspaces(id),
  skill_install_id uuid not null references skill_installs(id) on delete cascade,
  workflow_id uuid not null references workflows(id),
  node_id text,
  created_at timestamptz not null default now(),
  constraint uq_skill_mounts_install_workflow_node unique (skill_install_id, workflow_id, node_id)
);

create table if not exists apps (
  id uuid primary key default uuidv7(),
  public_id text not null,
  workspace_id uuid not null references workspaces(id),
  workflow_id uuid not null references workflows(id),
  workflow_version_id uuid not null references workflow_versions(id),
  name text not null,
  slug text not null,
  status text not null default 'enabled',
  auth_mode text not null default 'api-key',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_apps_workspace_public unique (workspace_id, public_id),
  constraint uq_apps_workspace_slug unique (workspace_id, slug),
  constraint ck_apps_status check (status in ('enabled', 'disabled')),
  constraint ck_apps_auth check (auth_mode in ('api-key', 'bearer'))
);

create table if not exists app_api_keys (
  id uuid primary key default uuidv7(),
  workspace_id uuid not null references workspaces(id),
  app_id uuid not null references apps(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ix_app_api_keys_workspace_app
  on app_api_keys (workspace_id, app_id);
create index if not exists ix_app_api_keys_prefix
  on app_api_keys (key_prefix);
