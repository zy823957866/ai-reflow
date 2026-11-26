create table if not exists file_assets (
  id uuid primary key default uuidv7(),
  public_id text not null,
  workspace_id uuid not null references workspaces(id),
  storage_key text not null,
  name text not null,
  mime text not null,
  extension text not null,
  size_bytes bigint not null,
  sha256 text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_file_assets_workspace_public unique (workspace_id, public_id),
  constraint uq_file_assets_workspace_storage unique (workspace_id, storage_key),
  constraint ck_file_assets_size check (size_bytes >= 0)
);

create index if not exists ix_file_assets_workspace_created
  on file_assets (workspace_id, created_at desc);

create index if not exists ix_file_assets_workspace_sha256
  on file_assets (workspace_id, sha256);
