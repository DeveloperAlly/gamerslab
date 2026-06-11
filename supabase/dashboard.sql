-- Run this in Supabase SQL editor to add the tables needed for the dashboard

-- targets table — tracks which URL is being monitored
create table if not exists targets (
  id         bigserial primary key,
  url        text not null,
  name       text,
  set_at     timestamptz default now(),
  active     boolean default false
);

create index if not exists targets_active_idx on targets (active);

-- trigger_log — records manual dashboard triggers
create table if not exists trigger_log (
  id           bigserial primary key,
  mode         text,
  source       text,
  triggered_at timestamptz default now()
);

-- Seed initial target
insert into targets (url, name, active)
values ('https://uprisinglabs.itch.io/bug-seek-expedition-edition', 'Bug Seek: Expedition Edition', true)
on conflict do nothing;
