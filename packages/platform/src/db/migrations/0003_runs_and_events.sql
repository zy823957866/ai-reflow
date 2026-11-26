create table if not exists runs (
  id uuid primary key default uuidv7(),
  public_id text not null,
  workspace_id uuid not null references workspaces(id),
  workflow_id uuid not null references workflows(id),
  workflow_version_id uuid references workflow_versions(id),
  definition_snapshot jsonb not null,
  run_kind text not null,
  trigger text not null,
  status text not null default 'queued',
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error jsonb,
  metadata jsonb not null default '{}'::jsonb,
  external_client_id text,
  idempotency_key text,
  cancel_requested_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  worker_id text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_runs_workspace_public unique (workspace_id, public_id),
  constraint ck_runs_kind check (run_kind in ('preview', 'production')),
  constraint ck_runs_trigger check (
    trigger in (
      'manual_preview', 'manual_trial', 'api', 'mcp', 'webhook',
      'schedule', 'event', 'replay'
    )
  ),
  constraint ck_runs_status check (
    status in ('queued', 'pending', 'running', 'succeeded', 'failed', 'cancelled', 'waiting')
  ),
  constraint ck_runs_production_version check (
    run_kind <> 'production' or workflow_version_id is not null
  )
);

create unique index if not exists uq_runs_workspace_idempotency
  on runs (workspace_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists ix_runs_workspace_created
  on runs (workspace_id, created_at desc);
create index if not exists ix_runs_workspace_workflow_created
  on runs (workspace_id, workflow_id, created_at desc);
create index if not exists ix_runs_workspace_version
  on runs (workspace_id, workflow_version_id);
create index if not exists ix_runs_queue
  on runs (status, created_at)
  where status = 'queued';
create index if not exists ix_runs_running_lease
  on runs (status, lease_expires_at)
  where status = 'running';

create table if not exists node_runs (
  id uuid primary key default uuidv7(),
  workspace_id uuid not null references workspaces(id),
  run_id uuid not null references runs(id) on delete cascade,
  node_id text not null,
  node_type text not null,
  title text not null,
  attempt integer not null default 1,
  status text not null default 'pending',
  input jsonb,
  output jsonb,
  error jsonb,
  trace jsonb not null default '[]'::jsonb,
  usage jsonb not null default '{}'::jsonb,
  branch text,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_node_runs_run_node_attempt unique (run_id, node_id, attempt),
  constraint ck_node_runs_attempt check (attempt >= 1),
  constraint ck_node_runs_status check (
    status in ('pending', 'running', 'succeeded', 'failed', 'skipped', 'cancelled', 'waiting')
  )
);

create index if not exists ix_node_runs_workspace_run
  on node_runs (workspace_id, run_id);
create index if not exists ix_node_runs_run_status
  on node_runs (run_id, status);

create table if not exists run_events (
  id bigserial primary key,
  workspace_id uuid not null references workspaces(id),
  run_id uuid not null references runs(id) on delete cascade,
  seq integer not null,
  type text not null,
  node_id text,
  attempt integer,
  status text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint uq_run_events_run_seq unique (run_id, seq),
  constraint ck_run_events_seq check (seq >= 1)
);

create index if not exists ix_run_events_run_seq
  on run_events (run_id, seq);
create index if not exists ix_run_events_workspace_created
  on run_events (workspace_id, created_at);

create table if not exists artifacts (
  id uuid primary key default uuidv7(),
  workspace_id uuid not null references workspaces(id),
  run_id uuid references runs(id) on delete set null,
  node_run_id uuid references node_runs(id) on delete set null,
  storage_key text not null,
  file_name text not null,
  mime text not null,
  size_bytes bigint not null,
  sha256 text not null,
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ix_artifacts_workspace_run
  on artifacts (workspace_id, run_id);
create index if not exists ix_artifacts_node_run
  on artifacts (node_run_id);
