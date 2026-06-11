-- Full schema — run once in Supabase SQL editor

create table if not exists monitor_results (
  id                   bigserial primary key,
  region               text not null,
  status               int,
  ttfb_ms              float,
  duration_ms          float,
  mode                 text,
  content_language     text,
  accept_language_sent text,
  cf_colo              text,
  runner_ip            text,
  checked_at           timestamptz default now()
);

create index if not exists monitor_results_checked_at_idx on monitor_results (checked_at desc);
create index if not exists monitor_results_region_mode_idx on monitor_results (region, mode);

create table if not exists targets (
  id      bigserial primary key,
  url     text not null,
  name    text,
  set_at  timestamptz default now(),
  active  boolean default false
);

create index if not exists targets_active_idx on targets (active);

create table if not exists trigger_log (
  id           bigserial primary key,
  mode         text,
  source       text,
  triggered_at timestamptz default now()
);

-- Scheduled one-off surge events (Workflows F + G)
create table if not exists scheduled_surges (
  id           bigserial primary key,
  scheduled_at timestamptz not null,
  label        text,
  status       text default 'pending',  -- pending | fired | cancelled
  fired_at     timestamptz,
  created_at   timestamptz default now()
);

create index if not exists scheduled_surges_status_idx on scheduled_surges (status, scheduled_at);

-- Disable RLS on all tables
alter table monitor_results disable row level security;
alter table targets disable row level security;
alter table trigger_log disable row level security;
alter table scheduled_surges disable row level security;

-- Add runner_ip column if upgrading existing install
alter table monitor_results add column if not exists runner_ip text;

-- Seed initial target
insert into targets (url, name, active)
values ('https://uprisinglabs.itch.io/bug-seek-expedition-edition', 'Bug Seek: Expedition Edition', true)
on conflict do nothing;
