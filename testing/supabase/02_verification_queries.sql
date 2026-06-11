-- ============================================================
-- 02_verification_queries.sql
-- Paste individual queries into the Supabase SQL editor to
-- verify each layer of the pipeline is working correctly.
-- https://supabase.com/dashboard/project/bacumktnpozarnfvsrbw/sql
-- ============================================================


-- ── 1. SCHEMA CHECK ──────────────────────────────────────────────────────────
-- All required tables exist
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('monitor_results','targets','referrers','monitor_config','trigger_log','scheduled_surges')
order by table_name;
-- Expected: 6 rows

-- All Playwright columns exist on monitor_results
select column_name, data_type
from information_schema.columns
where table_name = 'monitor_results'
order by ordinal_position;
-- Must include: page_title, game_iframe_loaded, js_errors, page_blocked,
--               render_error, referrer_used, click_check_done, login_prompt_shown


-- ── 2. RECENT RESULTS ────────────────────────────────────────────────────────
-- Last 12 results (= 2 complete runs × 6 regions)
select
  region,
  status,
  ttfb_ms,
  page_title,
  game_iframe_loaded,
  js_errors,
  referrer_used,
  click_check_done,
  login_prompt_shown,
  render_error,
  mode,
  checked_at
from monitor_results
order by checked_at desc
limit 12;
-- Expected: status=1 for most rows, page_title populated, game_iframe_loaded true/false


-- ── 3. UPTIME SUMMARY (last 24h) ─────────────────────────────────────────────
select
  region,
  count(*)                                                                        as total_checks,
  count(*) filter (where status = 1)                                              as ok,
  count(*) filter (where status = 0)                                              as failed,
  round(count(*) filter (where status = 1)::numeric / count(*) * 100, 1)         as uptime_pct,
  round(avg(ttfb_ms)::numeric, 0)                                                 as avg_ttfb_ms,
  round(percentile_cont(0.95) within group (order by ttfb_ms)::numeric, 0)        as p95_ttfb_ms
from monitor_results
where checked_at > now() - interval '24 hours'
group by region
order by region;


-- ── 4. PLAYWRIGHT HEALTH ─────────────────────────────────────────────────────
select
  count(*)                                                                    as playwright_runs,
  count(*) filter (where game_iframe_loaded = true)                           as iframe_ok,
  count(*) filter (where game_iframe_loaded = false)                          as iframe_missing,
  count(*) filter (where js_errors != '[]' and js_errors is not null)         as had_js_errors,
  count(*) filter (where page_blocked = true)                                 as blocked_by_cf,
  count(*) filter (where click_check_done = true)                             as click_checks_done,
  count(*) filter (where login_prompt_shown = true)                           as login_prompt_confirmed,
  count(*) filter (where login_prompt_shown = false)                          as login_prompt_missing
from monitor_results
where checked_at > now() - interval '24 hours'
  and page_title is not null;


-- ── 5. REFERRER DISTRIBUTION ─────────────────────────────────────────────────
select
  coalesce(referrer_used, '(direct)')  as referrer,
  count(*)                             as visit_count
from monitor_results
where checked_at > now() - interval '24 hours'
group by referrer_used
order by visit_count desc;


-- ── 6. SURGE RUN ANALYSIS ────────────────────────────────────────────────────
select
  date_trunc('hour', checked_at)                                              as hour,
  count(*) filter (where mode = 'surge')                                      as surge_checks,
  count(*) filter (where mode = 'standard')                                   as standard_checks,
  round(avg(ttfb_ms) filter (where mode = 'surge')::numeric, 0)               as surge_avg_ttfb,
  round(avg(ttfb_ms) filter (where mode = 'standard')::numeric, 0)            as standard_avg_ttfb
from monitor_results
where checked_at > now() - interval '48 hours'
group by 1
order by 1 desc;


-- ── 7. FAILURE BREAKDOWN BY REGION ───────────────────────────────────────────
select
  region,
  render_error,
  count(*) as occurrences
from monitor_results
where status = 0
  and checked_at > now() - interval '7 days'
group by region, render_error
order by occurrences desc;


-- ── 8. CONFIG AND SEED DATA ──────────────────────────────────────────────────
select * from monitor_config;
-- Expected: { key: 'click_check_percentage', value: '30' }

select url, name, set_at from targets where active = true;
-- Expected: Bug Seek: Expedition Edition URL

select name, url, enabled from referrers order by created_at;
-- Expected: BugnSeek, Twitter / X, itch new+popular — all enabled=true


-- ── 9. SCHEDULED SURGES ──────────────────────────────────────────────────────
select id, scheduled_at, label, status, fired_at
from scheduled_surges
order by created_at desc
limit 10;

-- Count by status
select status, count(*) from scheduled_surges group by status;
-- After a scheduled event fires: status='fired' with fired_at populated

-- Check Workflow G is not leaving events stuck
select id, scheduled_at, label
from scheduled_surges
where status = 'pending'
  and scheduled_at < now() - interval '5 minutes';
-- Expected: 0 rows. Any rows here mean Workflow G failed to fire them.


-- ── 10. DEAD PIPELINE CHECK ──────────────────────────────────────────────────
-- Replicates Workflow C's dead-pipeline detection logic
select
  count(*)                 as results_last_30_min,
  max(checked_at)          as most_recent_result,
  now() - max(checked_at)  as time_since_last_result
from monitor_results
where checked_at > now() - interval '30 minutes';
-- results_last_30_min = 0 → pipeline is down (Workflow C sends 💀 alert)


-- ── 11. JS ERROR INSPECTION ──────────────────────────────────────────────────
select
  region,
  checked_at,
  js_errors,
  render_error
from monitor_results
where js_errors != '[]'
  and js_errors is not null
  and checked_at > now() - interval '7 days'
order by checked_at desc
limit 20;


-- ── 12. CLEANUP (use with caution) ───────────────────────────────────────────
-- delete from monitor_results where checked_at < now() - interval '30 days';
-- update scheduled_surges set status = 'pending', fired_at = null where id = <id>;
-- update scheduled_surges set status = 'cancelled' where status = 'pending';
