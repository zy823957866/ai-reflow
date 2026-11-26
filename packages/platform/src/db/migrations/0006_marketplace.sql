create table if not exists registry_entries (
  id text primary key,
  kind text not null,
  name text not null,
  publisher text not null,
  summary text not null default '',
  visibility text not null default 'verified',
  verified boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_registry_entries_kind check (kind in ('plugin', 'template', 'skill')),
  constraint ck_registry_entries_visibility check (visibility in ('official', 'verified', 'community'))
);

create index if not exists ix_registry_entries_kind_visibility
  on registry_entries (kind, visibility);

create table if not exists registry_versions (
  id uuid primary key default uuidv7(),
  entry_id text not null references registry_entries(id) on delete cascade,
  version text not null,
  manifest jsonb not null,
  tarball_key text not null,
  checksum text not null,
  signature text,
  license text not null,
  compatibility jsonb not null default '{}'::jsonb,
  deprecated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint uq_registry_versions_entry_version unique (entry_id, version)
);

create table if not exists plugin_installs (
  id uuid primary key default uuidv7(),
  public_id text not null,
  workspace_id uuid not null references workspaces(id),
  entry_id text not null references registry_entries(id),
  version text not null,
  previous_version text,
  status text not null default 'installing',
  enabled boolean not null default false,
  manifest_snapshot jsonb not null,
  affected_workflows jsonb not null default '[]'::jsonb,
  installed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_plugin_installs_workspace_public unique (workspace_id, public_id),
  constraint uq_plugin_installs_workspace_entry unique (workspace_id, entry_id),
  constraint ck_plugin_installs_status check (
    status in ('config_required', 'enabled', 'disabled', 'degraded', 'update_available', 'failed')
  )
);

create index if not exists ix_plugin_installs_workspace_status
  on plugin_installs (workspace_id, status);

create table if not exists plugin_credentials (
  id uuid primary key default uuidv7(),
  workspace_id uuid not null references workspaces(id),
  install_id uuid not null references plugin_installs(id) on delete cascade,
  key text not null,
  auth_type text not null,
  credential_id uuid references credentials(id),
  expires_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_plugin_credentials_install_key unique (install_id, key)
);

create table if not exists plugin_permissions (
  id uuid primary key default uuidv7(),
  workspace_id uuid not null references workspaces(id),
  install_id uuid not null references plugin_installs(id) on delete cascade,
  permission text not null,
  value jsonb not null,
  granted_at timestamptz not null default now(),
  constraint uq_plugin_permissions_install_permission unique (install_id, permission),
  constraint ck_plugin_permissions_permission check (
    permission in ('network', 'files', 'secrets', 'mcp', 'code')
  )
);

create table if not exists plugin_audit_events (
  id uuid primary key default uuidv7(),
  workspace_id uuid not null references workspaces(id),
  install_id uuid references plugin_installs(id) on delete set null,
  entry_id text,
  action text not null,
  actor text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ix_plugin_audit_events_workspace_install_created
  on plugin_audit_events (workspace_id, install_id, created_at desc);

create table if not exists template_catalog (
  id text primary key,
  name text not null,
  author text not null,
  summary text not null default '',
  category text not null default '',
  tags jsonb not null default '[]'::jsonb,
  license text not null default 'MIT',
  preview jsonb not null default '{}'::jsonb,
  visibility text not null default 'verified',
  usage_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_template_catalog_visibility check (visibility in ('official', 'verified', 'community'))
);

create table if not exists template_versions (
  id uuid primary key default uuidv7(),
  template_id text not null references template_catalog(id) on delete cascade,
  version text not null,
  manifest jsonb not null,
  workflow_definition jsonb not null,
  preview_graph jsonb not null default '{}'::jsonb,
  bundle_key text not null,
  schema_version text not null,
  required_plugins jsonb not null default '[]'::jsonb,
  required_models jsonb not null default '[]'::jsonb,
  required_secrets jsonb not null default '[]'::jsonb,
  required_knowledge jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint uq_template_versions_template_version unique (template_id, version)
);

create table if not exists template_imports (
  id uuid primary key default uuidv7(),
  workspace_id uuid not null references workspaces(id),
  template_id text not null references template_catalog(id),
  template_version_id uuid not null references template_versions(id),
  workflow_id uuid not null references workflows(id),
  target_name text not null,
  missing_dependencies jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ix_template_imports_workspace_workflow
  on template_imports (workspace_id, workflow_id);
