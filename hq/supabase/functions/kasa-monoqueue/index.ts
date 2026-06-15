// ОДНОРАЗОВА: черга вікон для повного захоплення monobank (обхід ліміту 500/запит + 31 день).
// Guard ?key=dckasa-monoqueue-Yd5
import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-monoqueue-Yd5";
const SQL = `
create table if not exists public.kasa_mono_queue (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.kasa_accounts(id) on delete cascade,
  mono_account_id text not null,
  from_unix bigint not null,
  to_unix bigint not null,
  status text not null default 'pending',
  created_at timestamptz default now()
);
create index if not exists kasa_mono_queue_status on public.kasa_mono_queue(status, id);

insert into public.kasa_mono_queue(account_id, mono_account_id, from_unix, to_unix)
select a.id, a.mono_account_id,
   extract(epoch from gs)::bigint,
   least(extract(epoch from gs + interval '30 days'), extract(epoch from now()))::bigint
from public.kasa_accounts a
cross join generate_series(timestamp '2026-03-01 00:00:00', now(), interval '30 days') gs
where a.bank='monobank' and a.is_active and a.mono_account_id is not null
  and not exists (select 1 from public.kasa_mono_queue q where q.account_id=a.id)
  and extract(epoch from gs) < extract(epoch from now());
`;
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  let sql: any;
  try {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, ssl: "require", max: 1 });
    await sql.unsafe(SQL).simple();
    const q = await sql`select status, count(*)::int c from public.kasa_mono_queue group by status`;
    await sql.end();
    return new Response(JSON.stringify({ ok: true, queue: q }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
