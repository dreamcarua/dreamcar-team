// ОДНОРАЗОВА: функція kasa_try_reanchor() + cron — щойно черга mono порожня,
// один раз пере-заякорити opening = api - ops, далі no-op. Guard ?key=dckasa-autoanchor-Lw8
import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-autoanchor-Lw8";
const SQL = `
create or replace function public.kasa_try_reanchor() returns void
language plpgsql security definer as $fn$
begin
  if (select count(*) from public.kasa_mono_queue where status='pending') = 0
     and coalesce((select value from public.kasa_config where key='mono_anchored'),'0') = '0' then
    update public.kasa_accounts a
      set opening_balance = round(a.api_balance - coalesce((
        select sum(case when t.direction='in' then t.amount_uah else -t.amount_uah end)
        from public.kasa_transactions t where t.account_id=a.id),0),2)
      where a.bank in ('monobank','privatbank') and a.api_balance is not null;
    insert into public.kasa_config(key,value) values ('mono_anchored','1')
      on conflict (key) do update set value='1';
  end if;
end $fn$;

select cron.unschedule('kasa-reanchor') where exists (select 1 from cron.job where jobname='kasa-reanchor');
select cron.schedule('kasa-reanchor','*/10 * * * *','select public.kasa_try_reanchor()');
select public.kasa_try_reanchor();
`;
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  let sql: any;
  try {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, ssl: "require", max: 1 });
    await sql.unsafe(SQL).simple();
    const pend = await sql`select count(*)::int n from public.kasa_mono_queue where status='pending'`;
    const flag = await sql`select value from public.kasa_config where key='mono_anchored'`;
    await sql.end();
    return new Response(JSON.stringify({ ok: true, pending: pend[0].n, mono_anchored: flag[0]?.value || "0" }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
