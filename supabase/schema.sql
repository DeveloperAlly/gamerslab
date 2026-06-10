-- monitor_results table
-- Single source of truth — includes all columns from initial create + later additions
-- Run this once in Supabase SQL editor to set up the schema

create table if not exists monitor_results (
  id                   bigserial primary key,
  region               text not null,
  status               int,                    -- 1 = ok, 0 = fail
  ttfb_ms              float,                  -- time to first byte in ms
  duration_ms          float,                  -- total request duration in ms
  mode                 text,                   -- 'standard' or 'surge'
  content_language     text,                   -- Content-Language header returned by target
  accept_language_sent text,                   -- Accept-Language header sent in request
  cf_colo              text,                   -- Cloudflare PoP airport code e.g. SYD, LHR, DXB
  checked_at           timestamptz default now()
);

-- Index for time-range queries (used by n8n alerting workflow)
create index if not exists monitor_results_checked_at_idx
  on monitor_results (checked_at desc);

-- Index for region+mode grouping queries
create index if not exists monitor_results_region_mode_idx
  on monitor_results (region, mode);


-- -----------------------------------------------------------------------
-- Useful queries
-- -----------------------------------------------------------------------

-- Compare standard vs surge latency by region
select
  region,
  mode,
  round(avg(ttfb_ms)::numeric, 0)      as avg_ttfb_ms,
  round(avg(duration_ms)::numeric, 0)  as avg_duration_ms,
  count(*) filter (where status = 0)   as failures,
  count(*)                             as total_checks
from monitor_results
group by region, mode
order by region, mode;

-- Which Cloudflare PoPs are actually serving each region
select
  region,
  cf_colo,
  count(*) as hits
from monitor_results
group by region, cf_colo
order by region, hits desc;

-- Recent failures (last 24 hours)
select
  region,
  ttfb_ms,
  cf_colo,
  checked_at
from monitor_results
where status = 0
  and checked_at > now() - interval '24 hours'
order by checked_at desc;
