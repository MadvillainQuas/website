-- ============================================================================
-- 0154 — WHERE THE DATABASE'S TIME GOES, FOR EVERY ROLE.
--
-- `supabase inspect db outliers` ranks only the statements run by the role it
-- connects as (postgres: the cron jobs and migrations), so it said the
-- notification tick was 87% of the work. Counting the website's own reads
-- (PostgREST as anon, authenticated and service_role) and Realtime, the tick is
-- about 5%. Deciding what to make cheaper needs the whole ranking, and the only
-- other way to see it is running SQL against production by hand.
--
-- ops_query_stats(n): the n statements with the most total execution time since
-- the statistics were last reset, with who ran them. Read only, and callable by
-- the service role alone (the worker's key): query texts can name tables and
-- filters, never values (pg_stat_statements stores them with $1, $2...).
-- ============================================================================
create or replace function public.ops_query_stats(p_limit int default 30)
returns table (role text, calls bigint, total_ms numeric, mean_ms numeric, max_ms numeric,
               rows_out bigint, blocks_hit bigint, blocks_read bigint, since timestamptz, query text)
language sql stable security definer set search_path = pg_catalog, extensions as $$
  select r.rolname::text,
         s.calls,
         round(s.total_exec_time::numeric, 1),
         round(s.mean_exec_time::numeric, 2),
         round(s.max_exec_time::numeric, 1),
         s.rows,
         s.shared_blks_hit,
         s.shared_blks_read,
         (select i.stats_reset from extensions.pg_stat_statements_info i),
         left(s.query, 1500)
    from extensions.pg_stat_statements s
    left join pg_catalog.pg_roles r on r.oid = s.userid
   order by s.total_exec_time desc
   limit least(greatest(coalesce(p_limit, 30), 1), 200);
$$;
revoke all on function public.ops_query_stats(int) from public, anon, authenticated;
grant execute on function public.ops_query_stats(int) to service_role;
alter function public.ops_query_stats(int) owner to postgres;
