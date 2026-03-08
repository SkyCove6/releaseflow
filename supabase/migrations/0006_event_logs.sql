-- ---------------------------------------------------------------------------
-- Migration 0006 — Event emission observability
-- Adds: event_logs table for lifecycle/inngest emission diagnostics
-- ---------------------------------------------------------------------------

create table if not exists public.event_logs (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        references public.users(id) on delete set null,
  event_name      text        not null,
  event_id        text,
  payload         jsonb       not null default '{}',
  idempotency_key text,
  trace_id        text,
  status          text        not null check (status in ('sent', 'failed')),
  error           text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_event_logs_event_name on public.event_logs(event_name);
create index if not exists idx_event_logs_trace_id on public.event_logs(trace_id);
create index if not exists idx_event_logs_created_at on public.event_logs(created_at desc);
create index if not exists idx_event_logs_status on public.event_logs(status);

alter table public.event_logs enable row level security;
-- Admin + service-role only surface.

