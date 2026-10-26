-- StopRoutine consultant: isolated schema, sessions table, per-IP hourly limit.
-- Only the edge function (direct connection as postgres) touches these objects. RLS is on and there are no policies,
-- so anon/authenticated get nothing even if a grant is added by mistake.
-- The edge function connects directly (SUPABASE_DB_URL, role postgres), so the schema is NOT added to the
-- API's Exposed schemas; that shared setting stays untouched.

create schema if not exists stoproutine;

create table if not exists stoproutine.consultant_sessions (
  id          uuid primary key,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  lang        text not null check (lang in ('uk', 'en')),
  messages    jsonb not null default '[]'::jsonb,
  map         jsonb,
  ip_hash     text,
  notified    boolean not null default false
);

alter table stoproutine.consultant_sessions enable row level security;

-- Per-IP, per-hour counter. Holds only the salted hash of the IP, never the address.
create table if not exists stoproutine.consultant_rate (
  ip_hash text not null,
  hour    timestamptz not null,
  hits    integer not null default 0,
  primary key (ip_hash, hour)
);

alter table stoproutine.consultant_rate enable row level security;

-- Counts one request and says whether it is within the limit. Atomic (single upsert).
create or replace function stoproutine.consultant_hit(p_ip_hash text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = stoproutine, pg_temp
as $$
declare
  v_hits integer;
begin
  insert into stoproutine.consultant_rate as r (ip_hash, hour, hits)
  values (p_ip_hash, date_trunc('hour', now()), 1)
  on conflict (ip_hash, hour) do update set hits = r.hits + 1
  returning r.hits into v_hits;

  -- housekeeping: forget counters older than a day
  delete from stoproutine.consultant_rate where hour < now() - interval '1 day';

  return v_hits <= p_limit;
end;
$$;

revoke all on schema stoproutine from public, anon, authenticated;
revoke all on all tables in schema stoproutine from public, anon, authenticated;
revoke all on function stoproutine.consultant_hit(text, integer) from public, anon, authenticated;

grant usage on schema stoproutine to service_role;
grant all on stoproutine.consultant_sessions to service_role;
grant all on stoproutine.consultant_rate to service_role;
grant execute on function stoproutine.consultant_hit(text, integer) to service_role;
