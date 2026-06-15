// ОДНОРАЗОВА migrate4: лишити активними тільки fop-рахунки monobank (·0536,·1764),
// решту особистих карток вимкнути; розділити cron (mono кожні 2 хв, privat кожні 10 хв).
// Guard ?key=dckasa-migrate4-Tn5
import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-migrate4-Tn5";
const URLB = "https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/";
const SQL = `
-- лишаємо активними лише бізнес-рахунки ФОП (по last4 у назві)
update public.kasa_accounts set is_active=false
  where bank='monobank' and name not like '%0536' and name not like '%1764';
update public.kasa_accounts set is_active=true, sort_order=15
  where bank='monobank' and (name like '%0536' or name like '%1764');

create or replace function public.kasa_kick_one(fn text) returns void
language plpgsql security definer as $kk$
declare k text; begin
  select value into k from public.kasa_config where key='cron_key';
  perform net.http_post(url := '${URLB}'||fn,
    headers := jsonb_build_object('Content-Type','application/json','x-cron-key',k));
end $kk$;

select cron.unschedule('kasa-sync')   where exists (select 1 from cron.job where jobname='kasa-sync');
select cron.unschedule('kasa-mono')   where exists (select 1 from cron.job where jobname='kasa-mono');
select cron.unschedule('kasa-privat') where exists (select 1 from cron.job where jobname='kasa-privat');
select cron.schedule('kasa-mono','*/2 * * * *','select public.kasa_kick_one(''kasa-sync-mono'')');
select cron.schedule('kasa-privat','*/10 * * * *','select public.kasa_kick_one(''kasa-sync-privat'')');
`;
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  let sql: any;
  try {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, ssl: "require", max: 1 });
    await sql.unsafe(SQL).simple();
    const jobs = await sql`select jobname, schedule from cron.job where jobname like 'kasa-%' order by jobname`;
    const acc = await sql`select name, is_active from public.kasa_accounts where bank='monobank' order by is_active desc, name`;
    await sql.end();
    return new Response(JSON.stringify({ ok: true, jobs, mono_accounts: acc }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
