// ============================================================================
// kasa-migrate — ОДНОРАЗОВА функція: застосовує kasa_* міграцію + seed напряму
// у Postgres через SUPABASE_DB_URL (доступний Edge Functions за замовчуванням).
// Ідемпотентна (IF NOT EXISTS). Після успіху — видалити цей файл.
// Guard: ?key=dckasa-migrate-7Yq2vX
// ============================================================================
import postgres from "npm:postgres@3.4.4";

const GUARD = "dckasa-migrate-7Yq2vX";

const MIGRATION = `
create extension if not exists pgcrypto;

create table if not exists public.kasa_accounts (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  kind             text not null check (kind in ('bank','cash','dividends')),
  bank             text check (bank in ('monobank','privatbank','pumb')),
  currency         text not null default 'UAH',
  opening_balance  numeric(14,2) not null default 0,
  opening_date     date,
  mono_account_id  text,
  mono_token_label text,
  mono_synced_from date,
  mono_last_inc    timestamptz,
  privat_acc       text,
  iban             text,
  sort_order       int not null default 100,
  is_active        boolean not null default true,
  color            text default '#888888',
  icon             text default '🏦',
  notes            text,
  created_at       timestamptz not null default now()
);

create table if not exists public.kasa_transactions (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.kasa_accounts(id) on delete restrict,
  direction    text not null check (direction in ('in','out')),
  amount_uah   numeric(14,2) not null check (amount_uah > 0),
  occurred_at  date not null,
  description  text,
  counterparty text,
  category_id  uuid,
  launch_id    uuid,
  source       text not null default 'manual'
                 check (source in ('manual','monobank','privatbank','pumb_import')),
  external_id  text,
  raw          jsonb,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists kasa_tx_source_extid_uniq
  on public.kasa_transactions(source, external_id) where external_id is not null;
create index if not exists kasa_tx_account_idx  on public.kasa_transactions(account_id, occurred_at);
create index if not exists kasa_tx_occurred_idx on public.kasa_transactions(occurred_at);
create index if not exists kasa_tx_launch_idx   on public.kasa_transactions(launch_id);

create table if not exists public.kasa_transfers (
  id              uuid primary key default gen_random_uuid(),
  from_account_id uuid not null references public.kasa_accounts(id) on delete restrict,
  to_account_id   uuid not null references public.kasa_accounts(id) on delete restrict,
  amount_uah      numeric(14,2) not null check (amount_uah > 0),
  occurred_at     date not null,
  fee_uah         numeric(14,2) not null default 0,
  description     text,
  created_by      text,
  created_at      timestamptz not null default now(),
  check (from_account_id <> to_account_id)
);
create index if not exists kasa_tr_from_idx on public.kasa_transfers(from_account_id, occurred_at);
create index if not exists kasa_tr_to_idx   on public.kasa_transfers(to_account_id, occurred_at);

create or replace function public.kasa_touch_updated_at()
returns trigger language plpgsql as $fn$
begin new.updated_at = now(); return new; end $fn$;

drop trigger if exists kasa_tx_touch on public.kasa_transactions;
create trigger kasa_tx_touch before update on public.kasa_transactions
  for each row execute function public.kasa_touch_updated_at();

create or replace function public.kasa_is_allowed()
returns boolean language sql stable as $fn$
  select coalesce(lower(auth.jwt() ->> 'email'), '') in (
    '1avrybak@gmail.com','dreamcarua@gmail.com'
  );
$fn$;

alter table public.kasa_accounts     enable row level security;
alter table public.kasa_transactions enable row level security;
alter table public.kasa_transfers    enable row level security;

do $blk$
declare t text;
begin
  foreach t in array array['kasa_accounts','kasa_transactions','kasa_transfers'] loop
    execute format('drop policy if exists kasa_allow_all on public.%I', t);
    execute format('create policy kasa_allow_all on public.%I for all to authenticated using (public.kasa_is_allowed()) with check (public.kasa_is_allowed())', t);
  end loop;
end $blk$;

grant usage on schema public to authenticated;
grant select, insert, update, delete
  on public.kasa_accounts, public.kasa_transactions, public.kasa_transfers
  to authenticated;
`;

const SEED = `
insert into public.kasa_accounts (name, kind, bank, currency, icon, color, sort_order)
select v.name, v.kind, v.bank, 'UAH', v.icon, v.color, v.sort_order
from (values
  ('Готівка',           'cash',      null,         '💵', '#10B981', 10),
  ('ПриватБанк ФОП',    'bank',      'privatbank', '🟢', '#2BA24C', 20),
  ('ПУМБ ФОП',          'bank',      'pumb',       '🔵', '#0057B8', 30),
  ('Дивіденди — Артем', 'dividends', null,         '💰', '#FBBF24', 40),
  ('Дивіденди — Вадим', 'dividends', null,         '💰', '#FBBF24', 50)
) as v(name, kind, bank, icon, color, sort_order)
where not exists (select 1 from public.kasa_accounts a where a.name = v.name);
`;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== GUARD) {
    return new Response("forbidden", { status: 403 });
  }
  const conn = Deno.env.get("SUPABASE_DB_URL");
  if (!conn) {
    return new Response(JSON.stringify({ error: "SUPABASE_DB_URL missing", env: Object.keys(Deno.env.toObject()) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
  let sql: any;
  try {
    sql = postgres(conn, { prepare: false, ssl: "require", max: 1 });
    await sql.unsafe(MIGRATION).simple();
    await sql.unsafe(SEED).simple();
    const cnt = await sql`select count(*)::int as n from public.kasa_accounts`;
    await sql.end();
    return new Response(JSON.stringify({ ok: true, accounts: cnt[0].n }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
