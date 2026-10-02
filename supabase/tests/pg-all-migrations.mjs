/* ============================================================================
   EVERY MIGRATION, APPLIED IN ORDER, ON A REAL POSTGRES (PGlite).

   Not a test: the helper the tests that need the whole schema import
   (advisor-views.test.mjs, records-backfill.test.mjs). Supabase's own pieces
   that the migrations lean on are stood in for, as small as they can be:
   the API roles (anon, authenticated, service_role with BYPASSRLS), auth.users
   and auth.uid()/role()/jwt() reading request.jwt.claims as PostgREST sets it,
   storage's two tables, pg_cron's and pg_net's functions (they record, they do
   not run), realtime.send, vault, and Supabase's default privileges on public.
   Everything else is the migrations themselves, applied file by file with the
   file's own text (pg_cron / pg_net CREATE EXTENSION lines are dropped: the
   stand-ins are already there).

     import { allMigrations, migrationFiles } from './pg-all-migrations.mjs';
     const { db, failed } = await allMigrations({ before: '0218' });   // null when PGlite is not installed
   ============================================================================ */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const MIG = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

async function load() {
  const base = process.env.PGLITE_DIR;
  const mod = n => base ? pathToFileURL(path.join(base, 'dist', n)).href : '@electric-sql/pglite' + (n === 'index.js' ? '' : '/' + n.replace(/\.js$/, ''));
  try {
    const { PGlite } = await import(mod('index.js'));
    const ext = {};
    for (const n of ['pgcrypto', 'pg_trgm', 'unaccent', 'uuid_ossp', 'citext']) Object.assign(ext, await import(mod('contrib/' + n + '.js')));
    return { PGlite, ext };
  } catch { return null; }
}

export const SHIM = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator noinherit;
create role supabase_admin;
create role supabase_auth_admin;
create role supabase_storage_admin;
create role dashboard_user;
create role pgbouncer;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;
create schema extensions;
create extension pgcrypto with schema extensions;
create extension pg_trgm with schema extensions;
create extension "uuid-ossp" with schema extensions;
create extension unaccent with schema extensions;
create extension citext with schema extensions;
create table extensions.pg_stat_statements (userid oid, dbid oid, toplevel bool, queryid bigint, query text, calls bigint, total_exec_time float8, mean_exec_time float8, min_exec_time float8, max_exec_time float8, stddev_exec_time float8, rows bigint, shared_blks_hit bigint, shared_blks_read bigint, temp_blks_written bigint, plans bigint, total_plan_time float8);
create table extensions.pg_stat_statements_info (dealloc bigint, stats_reset timestamptz);
alter database template1 set search_path = public, extensions;
set search_path = public, extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key default gen_random_uuid(), instance_id uuid, aud text, role text, email text unique,
  encrypted_password text, email_confirmed_at timestamptz, invited_at timestamptz, confirmation_token text,
  recovery_token text, last_sign_in_at timestamptz, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}',
  is_super_admin boolean, created_at timestamptz default now(), updated_at timestamptz default now(), phone text,
  banned_until timestamptz, deleted_at timestamptz, is_anonymous boolean default false, is_sso_user boolean default false);
create table auth.identities (id uuid primary key default gen_random_uuid(), provider_id text, user_id uuid references auth.users on delete cascade,
  identity_data jsonb, provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz, email text);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
create function auth.email() returns text language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')::text $$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, owner uuid, public boolean default false, avif_autodetection boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now(), type text);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets, name text, owner uuid, owner_id text,
  created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz, metadata jsonb, version text, user_metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create function storage.filename(name text) returns text language sql immutable as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
create function storage.extension(name text) returns text language sql immutable as $$ select reverse(split_part(reverse(name), '.', 1)) $$;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
create schema cron;
create table cron.job (jobid bigserial primary key, schedule text, command text, nodename text default 'localhost', nodeport int default 5432,
  database text default current_database(), username text default current_user, active boolean default true, jobname text unique);
create table cron.job_run_details (jobid bigint, runid bigserial primary key, job_pid int, database text, username text, command text, status text,
  return_message text, start_time timestamptz, end_time timestamptz);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create function cron.schedule(schedule text, command text) returns bigint language sql as $$
  insert into cron.job (schedule, command) values (schedule, command) returning jobid $$;
create function cron.unschedule(job_name text) returns boolean language sql as $$ delete from cron.job where jobname = job_name returning true $$;
create function cron.unschedule(job_id bigint) returns boolean language sql as $$ delete from cron.job where jobid = job_id returning true $$;
create function cron.alter_job(job_id bigint, schedule text default null, command text default null, database text default null, username text default null, active boolean default null)
  returns void language sql as $$ update cron.job set schedule = coalesce($2, schedule), command = coalesce($3, command), active = coalesce($6, active) where jobid = $1 $$;
create schema net;
create table net.http_request_queue (id bigserial primary key, method text, url text, headers jsonb, body bytea, timeout_milliseconds int);
create table net._http_response (id bigint, status_code int, content_type text, headers jsonb, content text, timed_out boolean, error_msg text, created timestamptz default now());
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{"Content-Type": "application/json"}', timeout_milliseconds int default 5000)
  returns bigint language sql as $$ insert into net.http_request_queue (method, url, headers, timeout_milliseconds) values ('POST', url, headers, timeout_milliseconds) returning id $$;
create function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
  returns bigint language sql as $$ insert into net.http_request_queue (method, url, headers, timeout_milliseconds) values ('GET', url, headers, timeout_milliseconds) returning id $$;
create schema realtime;
create table realtime.messages (id bigserial primary key, topic text, extension text, payload jsonb, event text, private boolean default true, inserted_at timestamptz default now(), updated_at timestamptz default now());
alter table realtime.messages enable row level security;
create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void language sql as $$
  insert into realtime.messages (payload, event, topic, private) values (payload, event, topic, private) $$;
create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic', true) $$;
grant usage on schema realtime to anon, authenticated, service_role;
grant all on realtime.messages to anon, authenticated, service_role;
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
create view vault.decrypted_secrets as select id, name, secret, secret as decrypted_secret, description from vault.secrets;
create function vault.create_secret(secret text, name text default null, description text default '') returns uuid language sql as $$
  insert into vault.secrets (secret, name, description) values (secret, name, description) returning id $$;
create function vault.update_secret(id uuid, secret text default null, name text default null, description text default null) returns void language sql as $$
  update vault.secrets s set secret = coalesce($2, s.secret) where s.id = $1 $$;
create publication supabase_realtime;
-- Supabase's default privileges on public
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to anon, authenticated, service_role;
`;

/* the migration files in order; `before`: only those numbered below it (e.g. '0218') */
export function migrationFiles(before) {
  return readdirSync(MIG).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort().filter(f => !before || f.slice(0, 4) < before);
}

export function migrationText(f) {
  return readFileSync(path.join(MIG, f), 'utf8')
    .replace(/create extension if not exists pg_cron[^;]*;/gi, '')
    .replace(/create extension if not exists pg_net[^;]*;/gi, '');
}

/* a fresh database with the files applied; null when PGlite cannot be loaded */
export async function allMigrations({ before, files, log = () => {} } = {}) {
  const L = await load();
  if (!L) return null;
  const db = new L.PGlite({ extensions: L.ext });
  await db.exec(SHIM);
  const failed = [];
  for (const f of files || migrationFiles(before)) {
    try { await db.exec(migrationText(f)); log(f); }
    catch (e) { failed.push(f + ': ' + e.message); try { await db.exec('rollback'); } catch {} }
  }
  return { db, failed };
}

export async function applyMigration(db, f) { await db.exec(migrationText(f)); }
