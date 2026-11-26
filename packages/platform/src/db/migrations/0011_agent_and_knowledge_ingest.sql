do $$
begin
  if exists (
    select 1
    from document_chunks
    where embedding is not null
  ) then
    raise exception
      '检测到已有非空 document_chunks.embedding，不能静默切换到 768 维；请先导出并重建知识库索引。';
  end if;
end
$$;

drop index if exists ix_document_chunks_embedding_hnsw;
alter table document_chunks
  alter column embedding type vector(768);
alter table knowledge_bases
  alter column embedding_dimension set default 768;
update knowledge_bases
set
  embedding_provider = 'ollama',
  embedding_model = 'nomic-embed-text',
  embedding_dimension = 768,
  updated_at = now()
where embedding_dimension <> 768;
create index if not exists ix_document_chunks_embedding_hnsw
  on document_chunks using hnsw (embedding vector_cosine_ops)
  where embedding is not null;

create table if not exists agents (
  id uuid primary key default uuidv7(),
  public_id text not null,
  workspace_id uuid not null references workspaces(id),
  name text not null,
  description text not null default '',
  config jsonb not null,
  revision integer not null default 1,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_agents_workspace_public unique (workspace_id, public_id),
  constraint uq_agents_workspace_name unique (workspace_id, name),
  constraint ck_agents_revision check (revision >= 1),
  constraint ck_agents_status check (status in ('draft', 'active', 'archived'))
);

create index if not exists ix_agents_workspace_status
  on agents (workspace_id, status, updated_at desc);

create table if not exists agent_conversations (
  id uuid primary key default uuidv7(),
  public_id text not null,
  workspace_id uuid not null references workspaces(id),
  agent_id uuid not null references agents(id),
  agent_revision integer not null,
  agent_snapshot jsonb not null,
  thread_id text not null,
  title text not null default '新会话',
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_agent_conversations_workspace_public
    unique (workspace_id, public_id),
  constraint uq_agent_conversations_workspace_thread
    unique (workspace_id, thread_id),
  constraint ck_agent_conversations_status
    check (status in ('active', 'archived'))
);

create index if not exists ix_agent_conversations_agent_updated
  on agent_conversations (workspace_id, agent_id, updated_at desc);

create table if not exists agent_messages (
  id uuid primary key default uuidv7(),
  public_id text not null,
  workspace_id uuid not null references workspaces(id),
  conversation_id uuid not null references agent_conversations(id) on delete cascade,
  invocation_id uuid,
  seq integer not null,
  role text not null,
  content jsonb not null,
  status text not null default 'pending',
  citations jsonb not null default '[]'::jsonb,
  usage jsonb not null default '{}'::jsonb,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_agent_messages_workspace_public
    unique (workspace_id, public_id),
  constraint uq_agent_messages_conversation_seq
    unique (conversation_id, seq),
  constraint ck_agent_messages_seq check (seq >= 1),
  constraint ck_agent_messages_role check (role in ('user', 'assistant', 'system')),
  constraint ck_agent_messages_status check (
    status in ('pending', 'streaming', 'completed', 'failed', 'cancelled')
  )
);

create index if not exists ix_agent_messages_conversation_seq
  on agent_messages (conversation_id, seq);

create table if not exists agent_invocations (
  id uuid primary key default uuidv7(),
  public_id text not null,
  workspace_id uuid not null references workspaces(id),
  agent_id uuid references agents(id),
  conversation_id uuid references agent_conversations(id) on delete cascade,
  run_id uuid references runs(id) on delete set null,
  node_id text,
  kind text not null,
  status text not null default 'queued',
  definition_snapshot jsonb not null,
  request jsonb not null default '{}'::jsonb,
  result jsonb,
  error jsonb,
  thread_id text not null,
  resume_checkpoint_id text,
  idempotency_key text,
  cancel_requested_at timestamptz,
  worker_id text,
  lease_expires_at timestamptz,
  attempts integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_agent_invocations_workspace_public
    unique (workspace_id, public_id),
  constraint ck_agent_invocations_kind
    check (kind in ('chat', 'workflow_node', 'external')),
  constraint ck_agent_invocations_status check (
    status in (
      'queued', 'running', 'waiting', 'succeeded',
      'failed', 'cancelled', 'interrupted'
    )
  ),
  constraint ck_agent_invocations_attempts check (attempts >= 0)
);

create unique index if not exists uq_agent_invocations_workspace_idempotency
  on agent_invocations (workspace_id, idempotency_key)
  where idempotency_key is not null;
create unique index if not exists uq_agent_invocations_active_conversation
  on agent_invocations (conversation_id)
  where conversation_id is not null
    and status in ('queued', 'running', 'waiting');
create index if not exists ix_agent_invocations_queue
  on agent_invocations (workspace_id, status, created_at);
create index if not exists ix_agent_invocations_conversation
  on agent_invocations (workspace_id, conversation_id, created_at desc);

create table if not exists agent_invocation_events (
  id bigserial primary key,
  workspace_id uuid not null references workspaces(id),
  invocation_id uuid not null references agent_invocations(id) on delete cascade,
  seq integer not null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint uq_agent_invocation_events_seq
    unique (invocation_id, seq),
  constraint ck_agent_invocation_events_seq check (seq >= 1)
);

create index if not exists ix_agent_invocation_events_invocation_seq
  on agent_invocation_events (invocation_id, seq);

create table if not exists agent_tool_calls (
  id uuid primary key default uuidv7(),
  workspace_id uuid not null references workspaces(id),
  invocation_id uuid not null references agent_invocations(id) on delete cascade,
  call_id text not null,
  tool_name text not null,
  idempotency_key text not null,
  status text not null default 'started',
  arguments_summary jsonb not null default '{}'::jsonb,
  result_summary jsonb,
  error jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint uq_agent_tool_calls_invocation_key
    unique (invocation_id, idempotency_key),
  constraint ck_agent_tool_calls_status
    check (status in ('started', 'succeeded', 'failed'))
);

create index if not exists ix_agent_tool_calls_invocation
  on agent_tool_calls (workspace_id, invocation_id, started_at);

create table if not exists knowledge_ingest_jobs (
  id uuid primary key default uuidv7(),
  public_id text not null,
  workspace_id uuid not null references workspaces(id),
  document_id uuid not null references documents(id) on delete cascade,
  kind text not null default 'ingest',
  status text not null default 'queued',
  stage text not null default 'parse',
  attempt integer not null default 0,
  max_attempts integer not null default 3,
  next_retry_at timestamptz,
  error_code text,
  error_message text,
  worker_id text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_knowledge_ingest_jobs_workspace_public
    unique (workspace_id, public_id),
  constraint ck_knowledge_ingest_jobs_kind
    check (kind in ('ingest', 'retry', 'reindex')),
  constraint ck_knowledge_ingest_jobs_status
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  constraint ck_knowledge_ingest_jobs_stage
    check (stage in ('parse', 'normalize', 'chunk', 'embedding', 'index')),
  constraint ck_knowledge_ingest_jobs_attempt
    check (attempt >= 0 and max_attempts >= 1)
);

create index if not exists ix_knowledge_ingest_jobs_queue
  on knowledge_ingest_jobs (workspace_id, status, next_retry_at, created_at);
create index if not exists ix_knowledge_ingest_jobs_document
  on knowledge_ingest_jobs (workspace_id, document_id, created_at desc);
