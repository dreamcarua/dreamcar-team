// ОДНОРАЗОВА: is_internal + тригер авто-класифікації внутрішніх переказів. Guard ?key=dckasa-internal-Mk6
import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-internal-Mk6";
const SQL = `
alter table public.kasa_transactions add column if not exists is_internal boolean not null default false;

create or replace function public.kasa_mark_internal() returns trigger language plpgsql as $fn$
begin
  if NEW.source in ('monobank','privatbank') then
    NEW.is_internal := (
      coalesce(NEW.description,'')  ~* 'власн[іиого]* рахун|між власними|переказ власних|власних кошт'
      or coalesce(NEW.counterparty,'') ~* '(спірін|заяц|зайц)'
      or coalesce(NEW.description,'')  ~* '(спірін|заяц|зайц)'
      or coalesce(NEW.raw->>'AUT_CNTR_ACC','') in (select iban from public.kasa_accounts where iban is not null and iban <> '')
    );
  end if;
  return NEW;
end $fn$;

drop trigger if exists kasa_tx_internal on public.kasa_transactions;
create trigger kasa_tx_internal before insert or update on public.kasa_transactions
  for each row execute function public.kasa_mark_internal();

-- перекласифікувати наявні (тригер перерахує NEW.is_internal)
update public.kasa_transactions set is_internal=false where source in ('monobank','privatbank');
`;
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  let sql: any;
  try {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, ssl: "require", max: 1 });
    await sql.unsafe(SQL).simple();
    const r = await sql`select is_internal, count(*)::int n from public.kasa_transactions group by is_internal`;
    const sample = await sql`select left(description,50) d, counterparty c from public.kasa_transactions where is_internal order by occurred_at desc limit 5`;
    await sql.end();
    return new Response(JSON.stringify({ ok: true, counts: r, sample }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
