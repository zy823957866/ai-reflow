create table if not exists workflows (
  id uuid primary key default uuidv7(),
  public_id text not null,
  workspace_id uuid not null references workspaces(id),
  name text not null,
  slug text not null,
  description text not null default '',
  status text not null default 'draft',
  tags jsonb not null default '[]'::jsonb,
  owner jsonb not null default '{"id":"demo","name":"Demo","initials":"D"}'::jsonb,
  draft_definition jsonb not null,
  revision integer not null default 1,
  published_version_id uuid,
  published_version integer,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_workflows_workspace_public unique (workspace_id, public_id),
  constraint uq_workflows_workspace_slug unique (workspace_id, slug),
  constraint uq_workflows_workspace_id unique (workspace_id, id),
  constraint ck_workflows_status check (
    status in ('draft', 'published', 'reviewing', 'archived', 'error')
  ),
  constraint ck_workflows_revision check (revision >= 1)
);

create index if not exists ix_workflows_workspace_updated
  on workflows (workspace_id, updated_at desc);
create index if not exists ix_workflows_workspace_status
  on workflows (workspace_id, status);

create table if not exists workflow_versions (
  id uuid primary key default uuidv7(),
  public_id text not null,
  workspace_id uuid not null references workspaces(id),
  workflow_id uuid not null references workflows(id),
  version integer not null,
  definition jsonb not null,
  schema_hash text not null,
  manifest_snapshot jsonb not null default '[]'::jsonb,
  node_count integer not null,
  changelog text not null default '',
  created_by text not null default 'Demo',
  created_at timestamptz not null default now(),
  constraint uq_workflow_versions_workspace_public unique (workspace_id, public_id),
  constraint uq_workflow_versions_workflow_version unique (workflow_id, version),
  constraint ck_workflow_versions_version check (version >= 1),
  constraint ck_workflow_versions_node_count check (node_count >= 0)
);

create index if not exists ix_workflow_versions_workspace_workflow
  on workflow_versions (workspace_id, workflow_id, version desc);

alter table workflows
  add constraint fk_workflows_published_version
  foreign key (published_version_id) references workflow_versions(id)
  on delete restrict
  not valid;

alter table workflows validate constraint fk_workflows_published_version;
