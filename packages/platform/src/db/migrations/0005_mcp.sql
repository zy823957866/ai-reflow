create table if not exists mcp_connections (
  id uuid primary key default uuidv7(),
  public_id text not null,
  workspace_id uuid not null references workspaces(id),
  scope_type text not null default 'workspace',
  scope_id uuid,
  name text not null,
  slug text not null,
  transport text not null,
  endpoint text,
  command text,
  args jsonb not null default '[]'::jsonb,
  headers jsonb not null default '{}'::jsonb,
  auth_type text not null default 'none',
  credential_id uuid references credentials(id),
  allowed_hosts jsonb not null default '[]'::jsonb,
  tool_allowlist jsonb not null default '[]'::jsonb,
  timeouts jsonb not null default '{}'::jsonb,
  retry_policy jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  health_status text not null default 'healthy',
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_mcp_connections_workspace_public unique (workspace_id, public_id),
  constraint uq_mcp_connections_scope_slug unique (workspace_id, scope_type, scope_id, slug),
  constraint ck_mcp_connections_scope check (scope_type in ('workspace', 'project', 'workflow')),
  constraint ck_mcp_connections_transport check (transport in ('streamable-http', 'sse', 'stdio')),
  constraint ck_mcp_connections_auth check (
    auth_type in ('none', 'bearer', 'api-key', 'basic', 'custom-header', 'oauth2')
  ),
  constraint ck_mcp_connections_health check (health_status in ('healthy', 'degraded', 'offline', 'error'))
);

create index if not exists ix_mcp_connections_workspace_health
  on mcp_connections (workspace_id, health_status);

create table if not exists mcp_tools (
  id uuid primary key default uuidv7(),
  workspace_id uuid not null references workspaces(id),
  server_id uuid not null references mcp_connections(id) on delete cascade,
  name text not null,
  title text not null,
  description text not null default '',
  input_schema jsonb not null default '{"type":"object","properties":{}}'::jsonb,
  output_schema jsonb,
  annotations jsonb not null default '{}'::jsonb,
  schema_hash text not null,
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_mcp_tools_server_name unique (server_id, name)
);

create table if not exists workflow_mcp_exposures (
  id uuid primary key default uuidv7(),
  public_id text not null,
  workspace_id uuid not null references workspaces(id),
  workflow_id uuid not null references workflows(id),
  workflow_version_id uuid not null references workflow_versions(id),
  tool_name text not null,
  title text not null,
  description text not null default '',
  instructions text,
  input_schema_projection jsonb not null,
  output_mode text not null default 'structured',
  visibility text not null default 'private',
  auth_mode text not null default 'none',
  access_credential_id uuid references credentials(id),
  rate_limit jsonb not null default '{}'::jsonb,
  timeout_ms integer not null default 60000,
  max_concurrency integer not null default 5,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_workflow_mcp_exposures_workspace_public unique (workspace_id, public_id),
  constraint uq_workflow_mcp_exposures_workspace_tool unique (workspace_id, tool_name),
  constraint ck_workflow_mcp_exposures_output check (output_mode in ('text', 'structured')),
  constraint ck_workflow_mcp_exposures_visibility check (visibility in ('private', 'public')),
  constraint ck_workflow_mcp_exposures_auth check (auth_mode in ('none', 'bearer', 'api-key', 'oauth2'))
);

create index if not exists ix_workflow_mcp_exposures_workspace_workflow
  on workflow_mcp_exposures (workspace_id, workflow_id);

create table if not exists mcp_call_audit (
  id uuid primary key default uuidv7(),
  workspace_id uuid not null references workspaces(id),
  direction text not null,
  server_id uuid references mcp_connections(id) on delete set null,
  tool_id uuid references mcp_tools(id) on delete set null,
  run_id uuid references runs(id) on delete set null,
  node_run_id uuid references node_runs(id) on delete set null,
  client_id text,
  tool_name text not null,
  status text not null,
  error_code text,
  duration_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ck_mcp_call_audit_direction check (direction in ('outbound', 'inbound')),
  constraint ck_mcp_call_audit_status check (status in ('started', 'succeeded', 'failed', 'cancelled'))
);

create index if not exists ix_mcp_call_audit_workspace_created
  on mcp_call_audit (workspace_id, created_at desc);
create index if not exists ix_mcp_call_audit_run
  on mcp_call_audit (run_id);
