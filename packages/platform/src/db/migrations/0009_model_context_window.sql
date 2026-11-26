alter table model_connections
  add column if not exists context_window integer not null default 0;

alter table model_connections
  add constraint ck_model_connections_context_window
  check (context_window >= 0);
