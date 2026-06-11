-- ============================================================
-- 01_schema_migration.sql
-- Run ONCE in the Supabase SQL editor to create all tables and
-- columns required by the GamersLab Geo Monitor pipeline.
-- Safe to re-run — all statements use IF NOT EXISTS.
-- https://supabase.com/dashboard/project/bacumktnpozarnfvsrbw/sql
-- ============================================================

-- Core results table
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
  page_title           text,
  game_iframe_loaded   boolean,
  js_errors            text,
  page_blocked         boolean,
  render_error         text,
  referrer_used        text,
  click_check_done     boolean,
  login_prompt_shown   boolean,
  checked_at           timestamptz default now()
);
create index if not exists monitor_results_checked_at_idx  on monitor_results (checked_at desc);
create index if not exists monitor_results_region_mode_idx on monitor_results (region, mode);

-- Target URLs (active=true is the one the runner fetches at runtime)
create table if not exists targets (
  id      bigserial primary key,
  url     text not null,
  name    text,
  set_at  timestamptz default now(),
  active  boolean default false
);
create index if not exists targets_active_idx on targets (active);

-- Referrer simulation sources
create table if not exists referrers (
  id         bigserial primary key,
  url        text not null,
  name       text,
  enabled    boolean default true,
  created_at timestamptz default now()
);
create index if not exists referrers_enabled_idx on referrers (enabled);

-- Dashboard-controlled key/value settings
create table if not exists monitor_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz default now()
);

-- Manual trigger audit log
create table if not exists trigger_log (
  id           bigserial primary key,
  mode         text,
  source       text,
  triggered_at timestamptz default now()
);

-- One-off scheduled surge events (Workflows F + G)
create table if not exists scheduled_surges (
  id           bigserial primary key,
  scheduled_at timestamptz not null,
  label        text,
  status       text default 'pending',  -- pending | fired | cancelled
  fired_at     timestamptz,
  created_at   timestamptz default now()
);
create index if not exists scheduled_surges_status_idx on scheduled_surges (status, scheduled_at);

-- Disable RLS on all tables (no sensitive PII; dashboard reads via publishable key)
alter table monitor_results  disable row level security;
alter table targets          disable row level security;
alter table referrers        disable row level security;
alter table monitor_config   disable row level security;
alter table trigger_log      disable row level security;
alter table scheduled_surges disable row level security;

-- Migration: add columns to existing installs that pre-date Playwright
alter table monitor_results add column if not exists page_title         text;
alter table monitor_results add column if not exists game_iframe_loaded boolean;
alter table monitor_results add column if not exists js_errors          text;
alter table monitor_results add column if not exists page_blocked       boolean;
alter table monitor_results add column if not exists render_error       text;
alter table monitor_results add column if not exists referrer_used      text;
alter table monitor_results add column if not exists click_check_done   boolean;
alter table monitor_results add column if not exists login_prompt_shown boolean;

-- ── Seed data ────────────────────────────────────────────────────────────────

insert into targets (url, name, active)
values ('https://uprisinglabs.itch.io/bug-seek-expedition-edition', 'Bug Seek: Expedition Edition', true)
on conflict do nothing;

insert into referrers (url, name, enabled) values
  ('https://www.bugnseek.com/',                          'BugnSeek',         true),
  ('https://t.co/',                                      'Twitter / X',      true),
  ('https://itch.io/games/new-and-popular/platform-web', 'itch new+popular',  true)
on conflict do nothing;

insert into monitor_config (key, value) values
  ('click_check_percentage', '30')
on conflict (key) do nothing;
