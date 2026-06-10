create table monitor_results (
  id          bigserial primary key,
  region      text not null,
  status      int,           -- 1 = ok, 0 = fail
  ttfb_ms     float,
  duration_ms float,
  mode        text,          -- 'standard' or 'surge'
  lang_served text,
  checked_at  timestamptz default now()
);

-- Query to compare surge vs standard latency per region
select
  region,
  mode,
  round(avg(ttfb_ms)::numeric, 0) as avg_ttfb,
  round(avg(duration_ms)::numeric, 0) as avg_duration,
  count(*) filter (where status = 0) as failures,
  count(*) as total
from monitor_results
group by region, mode
order by region, mode;


=== 

Updated
===

alter table monitor_results
  add column content_language text,
  add column accept_language_sent text,
  add column cf_colo text;   -- tells you exactly which Cloudflare PoP handled it

