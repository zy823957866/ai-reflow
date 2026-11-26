create table if not exists operation_plans (
  id uuid primary key default uuidv7(),
  public_id text not null,
  workspace_id uuid not null references workspaces(id),
  kind text not null,
  payload jsonb not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint uq_operation_plans_workspace_public unique (workspace_id, public_id),
  constraint ck_operation_plans_kind check (
    kind in ('template_clone', 'plugin_install', 'plugin_upgrade', 'plugin_rollback')
  )
);

create index if not exists ix_operation_plans_workspace_expiry
  on operation_plans (workspace_id, expires_at);

create table if not exists operation_idempotency (
  id uuid primary key default uuidv7(),
  workspace_id uuid not null references workspaces(id),
  operation text not null,
  idempotency_key text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  constraint uq_operation_idempotency_workspace_key
    unique (workspace_id, operation, idempotency_key)
);

alter table mcp_connections
  add column if not exists description text not null default '';

alter table plugin_installs
  add column if not exists uninstalled_at timestamptz;

alter table plugin_installs
  drop constraint if exists ck_plugin_installs_status;

alter table plugin_installs
  add constraint ck_plugin_installs_status check (
    status in (
      'installing', 'config_required', 'enabled', 'disabled',
      'degraded', 'update_available', 'failed', 'rolling_back'
    )
  );

alter table plugin_installs
  drop constraint if exists uq_plugin_installs_workspace_entry;

create unique index if not exists uq_plugin_installs_workspace_entry_active
  on plugin_installs (workspace_id, entry_id)
  where uninstalled_at is null;
