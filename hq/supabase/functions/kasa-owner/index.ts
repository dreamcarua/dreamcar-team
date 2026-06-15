// ОДНОРАЗОВА: owner_name у kasa_bank_creds + динамічний тригер внутрішніх переказів.
// Guard ?key=dckasa-owner-Pn2
import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-owner-Pn2";
const SQL = `
alter table public.kasa_bank_creds add column if not exists owner_name text;
update public.kasa_bank_creds set owner_name='Спірін Юрій Петрович'
  where owner_name is null and (label ilike '%спірін%' or label ilike '%spirin%');
update public.kasa_bank_creds set owner_name='Заяць Ірина Миколаївна'
  where owner_name is null and (label ilike '%заяц%' or label ilike '%zayats%');

create or replace function public.kasa_mark_internal() returns trigger language plpgsql as $fn$
begin
  if NEW.source in ('monobank','privatbank') then
    NEW.is_internal := (
      coalesce(NEW.description,'') ~* 'власн[іиого]* рахун|між власними|переказ власних|власних кошт'
      or coalesce(NEW.raw->>'AUT_CNTR_ACC','') in (select iban from public.kasa_accounts where iban is not null and iban <> '')
      or exists (
        select 1 from public.kasa_bank_creds c
        where coalesce(c.owner_name,'') <> '' and (
          coalesce(NEW.counterparty,'') ilike '%'||split_part(c.owner_name,' ',1)||'%'
          or coalesce(NEW.description,'')  ilike '%'||split_part(c.owner_name,' ',1)||'%'
        )
      )
    );
  end if;
  return NEW;
end $fn$;

update public.kasa_transactions set is_internal=false where source in ('monobank','privatbank');
`;
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  let sql: any;
  try {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, ssl: "require", max: 1 });
    await sql.unsafe(SQL).simple();
    const creds = await sql`select label, owner_name from public.kasa_bank_creds order by label`;
    const cnt = await sql`select is_internal, count(*)::int n from public.kasa_transactions group by is_internal`;
    await sql.end();
    return new Response(JSON.stringify({ ok: true, creds, cnt }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
