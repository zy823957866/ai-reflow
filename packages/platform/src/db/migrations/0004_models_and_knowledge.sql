create table if not exists model_connections (
  id uuid primary key default uuidv7(),
  public_id text not null,
  workspace_id uuid not null references workspaces(id),
  name text not null,
  provider text not null,
  base_url text,
  default_model text not null,
  capabilities jsonb not null default '[]'::jsonb,
  credential_id uuid references credentials(id),
  fallback_order jsonb not null default '[]'::jsonb,
  status text not null default 'healthy',
  latency_ms integer,
  is_default boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_model_connections_workspace_public unique (workspace_id, public_id),
  constraint uq_model_connections_workspace_name unique (workspace_id, name),
  constraint ck_model_connections_status check (
    status in ('healthy', 'degraded', 'failed')
  )
);

create unique index if not exists uq_model_connections_default
  on model_connections (workspace_id)
  where is_default = true;
create index if not exists ix_model_connections_workspace_status
  on model_connections (workspace_id, status);

create table if not exists knowledge_bases (
  id uuid primary key default uuidv7(),
  public_id text not null,
  workspace_id uuid not null references workspaces(id),
  name text not null,
  description text not null default '',
  embedding_provider text not null,
  embedding_model text not null,
  embedding_dimension integer not null default 1536,
  status text not null default 'ready',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_knowledge_bases_workspace_public unique (workspace_id, public_id),
  constraint uq_knowledge_bases_workspace_name unique (workspace_id, name),
  constraint ck_knowledge_bases_dimension check (embedding_dimension > 0),
  constraint ck_knowledge_bases_status check (status in ('ready', 'indexing', 'failed'))
);

create table if not exists documents (
  id uuid primary key default uuidv7(),
  public_id text not null,
  workspace_id uuid not null references workspaces(id),
  kb_id uuid not null references knowledge_bases(id),
  name text not null,
  mime text not null,
  extension text not null,
  size_bytes bigint not null default 0,
  sha256 text not null,
  storage_key text not null,
  status text not null default 'queued',
  preview_status text not null default 'none',
  stage_error jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_documents_workspace_public unique (workspace_id, public_id),
  constraint uq_documents_kb_sha unique (kb_id, sha256),
  constraint ck_documents_status check (
    status in ('queued', 'parsing', 'chunking', 'embedding', 'ready', 'failed')
  ),
  constraint ck_documents_preview_status check (
    preview_status in ('none', 'converting', 'ready', 'failed', 'unsupported')
  )
);

create index if not exists ix_documents_workspace_kb_status
  on documents (workspace_id, kb_id, status);

create table if not exists document_chunks (
  id uuid primary key default uuidv7(),
  workspace_id uuid not null references workspaces(id),
  document_id uuid not null references documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  token_count integer,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  embedding_model text not null,
  embedding_status text not null default 'pending',
  tsv tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_document_chunks_document_index unique (document_id, chunk_index),
  constraint ck_document_chunks_index check (chunk_index >= 0),
  constraint ck_document_chunks_embedding_status check (
    embedding_status in ('pending', 'ready', 'failed')
  )
);

create index if not exists ix_document_chunks_workspace_document
  on document_chunks (workspace_id, document_id);
create index if not exists ix_document_chunks_embedding_hnsw
  on document_chunks using hnsw (embedding vector_cosine_ops)
  where embedding is not null;
create index if not exists ix_document_chunks_tsv_gin
  on document_chunks using gin (tsv);

create table if not exists document_previews (
  id uuid primary key default uuidv7(),
  workspace_id uuid not null references workspaces(id),
  document_id uuid not null references documents(id) on delete cascade,
  kind text not null,
  storage_key text not null,
  converter_version text not null,
  pages jsonb,
  sheets jsonb,
  status text not null default 'none',
  error_code text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_document_previews_document_kind unique (document_id, kind),
  constraint ck_document_previews_status check (
    status in ('none', 'converting', 'ready', 'failed')
  )
);
