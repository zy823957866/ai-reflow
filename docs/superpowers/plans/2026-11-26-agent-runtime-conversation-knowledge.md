# Agent Runtime, Conversations, and Knowledge Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved Agent runtime, persistent conversations, invocation queue/SSE, workflow Agent node, real knowledge ingest, vector retrieval, and Agent workbench.

**Architecture:** Keep the existing DAG engine and PostgreSQL queue model. Add a shared LangGraph Agent runtime used by both workflow nodes and an independent `agent-invoke` worker role; persist business messages separately from LangGraph checkpoints; add an isolated `knowledge-ingest` role for parse/chunk/embed/index.

**Tech Stack:** TypeScript, Vue 3, NestJS, postgres.js, Drizzle schema definitions, LangGraph, LangChain provider adapters, pgvector, Node test runner with `tsx`.

**Spec:** `docs/需求拆解/14-agent-runtime-conversation-and-knowledge.md`

## Global Constraints

- All user-facing copy and documentation are Simplified Chinese; code identifiers and commands remain unchanged.
- `maxSteps` default 8, range 1-32; `timeoutMs` default 120000, range 1000-3600000.
- P0 embedding default is `nomic-embed-text`, dimension 768; do not silently mix dimensions.
- Workflow Agent nodes never enqueue an `agent_invocations` row.
- Conversation creation fixes `agentRevision + agentSnapshot`; each invocation fixes `definition_snapshot`.
- User-visible messages in `agent_messages` are the source of truth; LangGraph checkpoint state is separate.
- Tool results and retrieved documents are untrusted input; they never replace system instructions.
- Every workspace query filters by `workspace_id`; secrets never enter events, messages, or logs.
- SSE events are persisted in PostgreSQL with monotonic `seq` and support `Last-Event-ID`.
- LangChain package versions stay on the approved compatibility line: langgraph 1.7.x, core 1.5.x, ollama 1.3.x, openai 1.8.x, checkpoint-postgres 1.1.x.
- Avoid destructive migration behavior: changing vector dimension fails if non-null vectors already exist.

## Review Focus

- A worker dies after a tool side effect but before finalization; resume must reuse the stored tool result by idempotency key.
- A conversation receives two rapid sends; the transaction must reject the second active invocation without losing the first user message.
- SSE reconnects with `Last-Event-ID` while deltas are still arriving; no gap or duplicate terminal event is emitted.
- A document has mixed or unsupported content such as a scanned PDF, `.doc`, empty text, or an embedding outage; the job must expose the exact failed stage and remain retryable.
- The Agent page is refreshed mid-generation on desktop and mobile; the same conversation and active invocation restore without layout overlap.

---

## File Structure

New shared contracts live in `packages/core/src/agent.ts`. Provider, runtime, tool, parser, chunker, embedding, and retrieval ports live under focused files in `packages/capabilities/src/agent/` and `packages/capabilities/src/knowledge/`.

Database schema/repositories remain in `packages/platform/src/db/`; queue and lease SQL stays in repositories, never controllers. Worker orchestration lives in `apps/worker/src/roles/`. HTTP/SSE stays in `apps/server/src/main.ts` with reusable request schemas from core. The Agent workbench lives in `apps/web/src/pages/agents-page/`.

### Task 1: Shared Agent Contracts and Workflow Executor

**Files:**
- Create: `packages/core/src/agent.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/capabilities/src/agent/executor.ts`
- Create: `packages/capabilities/src/agent/executor.test.ts`
- Modify: `packages/capabilities/src/index.ts`
- Modify: `packages/capabilities/package.json`

**Interfaces:**
- Produces: `AgentDefinition`, `AgentInvokeInput`, `AgentInvokeResult`, `AgentRuntimePort`, `agentDefinitionSchema`, `createAgentSchema`, `updateAgentSchema`, `createAgentConversationSchema`, `sendAgentMessageSchema`, `retryAgentMessageSchema`.
- Produces: `AgentExecutor` registered for node type `agent`; it resolves workflow config and calls `context.services.agent.invoke`.
- Modifies: `NodeRuntimeServices.agent?: AgentRuntimePort`.

- [ ] **Step 1: Write failing schema and executor tests**
  Test defaults (`maxSteps=8`, `timeoutMs=120000`), boundary rejection, memory default `run`, and that the executor forwards workspace/run/node/thread/definition to the runtime.
- [ ] **Step 2: Run tests and confirm failure**
  Run: `pnpm --filter @ai-reflow/capabilities test`
  Expected: FAIL because `@ai-reflow/core` has no Agent exports and no `AgentExecutor`.
- [ ] **Step 3: Implement contracts and executor**
  Use Zod for validation; normalize knowledge/MCP arrays; map runtime results to `{text, messages, steps, toolCalls, citations, usage, finishReason}`.
- [ ] **Step 4: Run tests**
  Run: `pnpm --filter @ai-reflow/capabilities test`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git commit -m "feat(core): add agent contracts and workflow executor"`

### Task 2: PostgreSQL Migration and Agent Repositories

**Files:**
- Create: `packages/platform/src/db/migrations/0011_agent_and_knowledge_ingest.sql`
- Modify: `packages/platform/src/db/schema.ts`
- Create: `packages/platform/src/db/repositories/agent-repository.ts`
- Create: `packages/platform/src/db/repositories/agent-invocation-repository.ts`
- Create: `packages/platform/src/db/repositories/knowledge-ingest-repository.ts`
- Modify: `packages/platform/src/index.ts`
- Create: `packages/platform/src/db/repositories/agent-repository.test.ts`
- Modify: `packages/platform/package.json`

**Interfaces:**
- Produces repositories with workspace-scoped CRUD/queue/lease/event methods used by Tasks 4, 5, and 6.
- Produces `claimNext(workerId, leaseMs)`, `heartbeat()`, `appendEvent()`, `eventsPage()`, `cancel()`, `complete()`, `fail()`.
- Produces atomic conversation send locking and one-active-invocation enforcement.

- [ ] **Step 1: Write failing repository behavior tests**
  Test pure row-to-DTO mapping, single-active-invocation predicate, monotonic event sequencing contract, ingest-stage retry decisions, and vector-dimension guard behavior.
- [ ] **Step 2: Run tests and confirm failure**
  Run: `pnpm --filter @ai-reflow/platform test`
  Expected: FAIL because the migration and repositories do not exist.
- [ ] **Step 3: Add migration, schema, and repositories**
  Include `agents`, `agent_conversations`, `agent_messages`, `agent_invocations`, `agent_invocation_events`, `agent_tool_calls`, and `knowledge_ingest_jobs`; change vector metadata default to 768 with an explicit non-empty guard.
- [ ] **Step 4: Run tests and migration**
  Run: `pnpm --filter @ai-reflow/platform test`
  Run: `pnpm db:migrate`
  Expected: tests PASS and migration applies from the current database without data loss.
- [ ] **Step 5: Commit**
  `git commit -m "feat(platform): add agent conversations and invocation repositories"`

### Task 3: LangGraph Agent Runtime and Provider Adapters

**Files:**
- Create: `packages/capabilities/src/agent/runtime.ts`
- Create: `packages/capabilities/src/agent/runtime.test.ts`
- Create: `packages/capabilities/src/agent/tools.ts`
- Create: `packages/capabilities/src/agent/providers.ts`
- Create: `packages/capabilities/src/agent/index.ts`
- Modify: `packages/capabilities/package.json`

**Interfaces:**
- Produces `createAgentRuntime(deps): AgentRuntimePort`.
- Provider port receives normalized messages/tools and supports streaming deltas; Ollama uses `ChatOllama`, OpenAI-compatible uses `ChatOpenAI`.
- Runtime uses LangGraph `StateGraph`, append-only messages, optional knowledge pre-retrieval, tool loop, max-step finalization, cancellation, usage, citations, and finish reason.

- [ ] **Step 1: Write failing runtime tests**
  Cover normal answer, tool call then answer, max-step stop, cancellation, second-turn message retention, untrusted context placement, and tool idempotency reuse.
- [ ] **Step 2: Run tests and confirm failure**
  Run: `pnpm --filter @ai-reflow/capabilities test`
  Expected: FAIL because runtime files do not exist.
- [ ] **Step 3: Implement LangGraph runtime and providers**
  Inject model/knowledge/MCP/checkpoint/tool-history ports; use `Annotation` and conditional edges; emit deltas and step events.
- [ ] **Step 4: Run tests**
  Run: `pnpm --filter @ai-reflow/capabilities test`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git commit -m "feat(capabilities): add langgraph agent runtime"`

### Task 4: Worker Roles, Invocation Consumer, and Workflow Integration

**Files:**
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/src/runtime-services.ts`
- Create: `apps/worker/src/roles/agent-role.ts`
- Create: `apps/worker/src/roles/ingest-role.ts`
- Create: `apps/worker/src/agent-runtime-factory.ts`
- Modify: `apps/worker/package.json`
- Modify: `packages/platform/src/config.ts`

**Interfaces:**
- Produces role parsing from `WORKER_ROLES`, per-role concurrency, and graceful shutdown.
- Produces an `agent-invoke` consumer using the shared invocation repository/runtime; workflow nodes call the same runtime in-process.
- Produces a checkpoint adapter and tool-history adapter backed by PostgreSQL.

- [ ] **Step 1: Write failing role/runtime tests**
  Test role parsing, invocation prompt construction, assistant placeholder updates, and workflow Agent invocation without enqueueing.
- [ ] **Step 2: Run tests and confirm failure**
  Run: `pnpm --filter @ai-reflow/worker test`
  Expected: FAIL because roles and runtime factory do not exist.
- [ ] **Step 3: Implement worker orchestration**
  Preserve existing workflow behavior; isolate loops and leases; surface interrupted/resumed events.
- [ ] **Step 4: Run worker tests and typecheck**
  Run: `pnpm --filter @ai-reflow/worker test`
  Run: `pnpm typecheck:worker`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git commit -m "feat(worker): add agent invoke and ingest roles"`

### Task 5: Agent REST API, Conversation API, SSE, and Upload Endpoint

**Files:**
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/package.json`
- Modify: `apps/server/src/main.test.ts` only if existing test conventions require it

**Interfaces:**
- Produces all `/api/agents`, `/api/agent-conversations`, `/api/agent-invocations`, `/api/documents/:id/retry|reindex`, and `/api/knowledge-ingest-jobs` routes from the spec.
- SSE supports `after`, `Last-Event-ID`, backlog-first delivery, and terminal close.
- Upload accepts multipart `file`, validates size/type/hash, stores bytes through the object-storage port, and creates an ingest job.

- [ ] **Step 1: Write failing API contract tests**
  Cover invalid Agent config rejection, conversation snapshot immutability, duplicate active send conflict, SSE backlog ordering, cancel idempotency, and upload validation.
- [ ] **Step 2: Run tests and confirm failure**
  Run: `pnpm --filter @ai-reflow/server test`
  Expected: FAIL because routes do not exist.
- [ ] **Step 3: Implement routes and SSE**
  Use core request schemas and repository methods; never place SQL in the controller.
- [ ] **Step 4: Run tests and both typechecks**
  Run: `pnpm --filter @ai-reflow/server test`
  Run: `pnpm typecheck:server`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git commit -m "feat(server): expose agent conversation and ssE APIs"`

### Task 6: Real Knowledge Ingest and Vector Retrieval

**Files:**
- Create: `packages/capabilities/src/knowledge/parser.ts`
- Create: `packages/capabilities/src/knowledge/chunker.ts`
- Create: `packages/capabilities/src/knowledge/embeddings.ts`
- Create: `packages/capabilities/src/knowledge/retrieval.ts`
- Create: `packages/capabilities/src/knowledge/*.test.ts`
- Create: `packages/platform/src/storage/object-storage.ts`
- Modify: `packages/platform/src/db/repositories/knowledge-repository.ts`
- Modify: `apps/worker/src/roles/ingest-role.ts`

**Interfaces:**
- Parser supports TXT, Markdown, HTML, CSV, PDF, DOCX, XLSX; unsupported scanned PDF and legacy Office files return stable codes.
- Chunker preserves Markdown structure, PDF page metadata, and CSV/XLSX row ranges.
- Embedding supports Ollama/OpenAI compatible providers, batching, retry classification, and dimension checks.
- Retrieval supports vector, keyword, and hybrid; unavailable embeddings degrade to keyword only with an explicit warning.

- [ ] **Step 1: Write failing parser/chunker/embedding/retrieval tests**
  Include malformed input, empty extracted text, Markdown fences, PDF page metadata, 429 retry, 400 no-retry, dimension mismatch, workspace isolation, citation order, and degraded warning.
- [ ] **Step 2: Run tests and confirm failure**
  Run: `pnpm --filter @ai-reflow/capabilities test`
  Run: `pnpm --filter @ai-reflow/platform test`
  Expected: FAIL because ingest/retrieval modules do not exist.
- [ ] **Step 3: Implement ingest and retrieval**
  Keep full file bytes out of PostgreSQL; upsert chunks transactionally; expose stage failures.
- [ ] **Step 4: Run tests and typechecks**
  Run: `pnpm --filter @ai-reflow/capabilities test`
  Run: `pnpm --filter @ai-reflow/platform test`
  Run: `pnpm typecheck:worker`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git commit -m "feat(knowledge): add real ingest and vector retrieval"`

### Task 7: Agent Workbench and Workflow Inspector

**Files:**
- Create: `apps/web/src/pages/agents-page/index.vue`
- Create: `apps/web/src/pages/agents-page/AgentChatPanel.vue`
- Create: `apps/web/src/pages/agents-page/AgentSettingsPanel.vue`
- Create: `apps/web/src/pages/agents-page/ConversationList.vue`
- Create: `apps/web/src/pages/agents-page/types.ts`
- Modify: `apps/web/src/services/reflowApi.ts`
- Modify: `apps/web/src/router/index.ts`
- Modify: `apps/web/src/components/Menu.vue`
- Modify: `apps/web/src/shared/nodes.ts`
- Modify: `apps/web/src/workflow/inspector/InspectorPanel.vue`

**Interfaces:**
- Produces `/agents` list/create and `/agents/:id` workbench with conversation list, streamed Markdown, citation chips, tool steps, stop, and regenerate.
- Restores conversation/invocation from route query and active invocation state after refresh.
- Agent node Inspector includes model, instructions, knowledge, MCP tools, max steps, timeout, output schema, and memory mode.

- [ ] **Step 1: Write failing static workspace/UI tests**
  Assert route registration, API boundary use, safe Markdown rendering, and absence of mock conversation persistence.
- [ ] **Step 2: Run tests and confirm failure**
  Run: `pnpm test:workspace`
  Expected: FAIL because Agent routes/components are absent.
- [ ] **Step 3: Implement the workbench and Inspector fields**
  Use the existing UI package, lucide icons, stable grid tracks, and mobile tab layout.
- [ ] **Step 4: Run web checks**
  Run: `pnpm test:workspace`
  Run: `pnpm typecheck`
  Run: `pnpm build`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git commit -m "feat(web): add agent workbench and inspector"`

### Task 8: Knowledge UI Wiring, Documentation, and End-to-End Verification

**Files:**
- Modify: `apps/web/src/pages/knowledge-page/components/KnowledgeUploadZone.vue`
- Modify: `apps/web/src/pages/knowledge-page/index.vue`
- Modify: `apps/web/src/services/reflowApi.ts`
- Modify: `docs/需求拆解/05-node-catalog.md`
- Modify: `docs/需求拆解/06-knowledge-base.md`
- Modify: `docs/需求拆解/08-models-and-skills.md`
- Modify: `docs/需求拆解/13-database-schema-and-relationships.md`
- Modify: `scripts/smoke.mjs` only if the existing smoke contract needs the new routes

- [ ] **Step 1: Write failing knowledge UI/status tests**
  Assert queued/parsing/chunking/embedding/ready/failed rendering, retry/reindex actions, and degraded retrieval warning rendering.
- [ ] **Step 2: Run tests and confirm failure**
  Run: `pnpm test:workspace`
  Expected: FAIL because the new states/actions are not wired.
- [ ] **Step 3: Wire the real ingest states and update docs**
  Poll job/document status while active; show stable stage errors; document the new tables, routes, and runtime boundaries.
- [ ] **Step 4: Run full verification**
  Run: `pnpm test:workspace`
  Run: `pnpm typecheck`
  Run: `pnpm typecheck:server`
  Run: `pnpm typecheck:worker`
  Run: `pnpm build`
  Run: `pnpm db:migrate`
  Run: `pnpm smoke`
  Expected: all commands exit 0; any environment-dependent skip is reported explicitly.
- [ ] **Step 5: Commit**
  `git commit -m "docs: close agent runtime and knowledge delivery"`

## Final Review

Run the full verification suite again from the final commit, inspect the whole branch diff, and report any environment-dependent checks that could not run. Do not claim completion from partial output.
