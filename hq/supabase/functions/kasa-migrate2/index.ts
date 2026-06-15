// ОДНОРАЗОВА kasa-migrate2: kasa_bank_creds + kasa_config + pg_cron автосинк.
// Guard: ?key=dckasa-migrate2-Qz8race
import postgres from "npm:postgres@3.4.4";

const GUARD = "dckasa-migrate2-Qz8race";
const PROJECT_URL = "https://wotghlaehnvxyeacznvv.supabase.co";

const SQL = `
-- креди банків (вводяться у захищеній сторінці Каси)
create table if not exists public.kasa_bank_creds (
  id          uuid primary key default gen_random_uuid(),
  bank        text not null check (bank in ('monobank','privatbank')),
  label       text not null,
  token       text not null,
  privat_id   text,
  is_active   boolean not null default true,
  synced_from date,
  last_inc    timestamptz,
  last_status text,
  created_at  timestamptz not null default now()
);
alter table public.kasa_bank_creds enable row level security;
drop policy if exists kasa_creds_allow on public.kasa_bank_creds;
create policy kasa_creds_allow on public.kasa_bank_creds for all to authenticated
  using (public.kasa_is_allowed()) with check (public.kasa_is_allowed());
grant select, insert, update, delete on public.kasa_bank_creds to authenticated;

-- внутрішній конфіг (cron_key) — НЕ доступний фронту (RLS без політик)
create table if not exists public.kasa_config (key text primary key, value text);
alter table public.kasa_config enable row level security;
insert into public.kasa_config(key,value) values ('cron_key','kck_a3F9q2Lx7Tup')
  on conflict (key) do nothing;
grant select on public.kasa_config to service_role;

-- розширення для автосинку
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- тригер автосинку: дергає обидві Edge-функції з cron-ключем у хедері
create or replace function public.kasa_kick() returns void
language plpgsql security definer as $kick$
declare k text;
begin
  select value into k from public.kasa_config where key='cron_key';
  perform net.http_post(
    url := '${PROJECT_URL}/functions/v1/kasa-sync-mono',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-key',k)
  );
  perform net.http_post(
    url := '${PROJECT_URL}/functions/v1/kasa-sync-privat',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-key',k)
  );
end $kick$;

-- розклад: кожні 10 хв
select cron.unschedule('kasa-sync') where exists (select 1 from cron.job where jobname='kasa-sync');
select cron.schedule('kasa-sync','*/10 * * * *','select public.kasa_kick()');
`;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  const conn = Deno.env.get("SUPABASE_DB_URL");
  if (!conn) return new Response(JSON.stringify({ error: "no SUPABASE_DB_URL" }), { status: 500 });
  let sql: any;
  try {
    sql = postgres(conn, { prepare: false, ssl: "require", max: 1 });
    await sql.unsafe(SQL).simple();
    const jobs = await sql`select jobname, schedule from cron.job where jobname='kasa-sync'`;
    await sql.end();
    return new Response(JSON.stringify({ ok: true, cron: jobs }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
