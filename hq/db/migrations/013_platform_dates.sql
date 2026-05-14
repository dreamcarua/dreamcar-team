-- ============================================================
-- Migration 013: per-platform publication dates
-- ============================================================
-- Дозволяє задавати різний час публікації для кожної платформи:
--   publication.platform_dates = {"ig": "2026-05-15T12:00:00Z", "tg": "2026-05-15T14:00:00Z"}
-- Якщо для якоїсь платформи дата не задана — використовується основна
-- publication.publish_at (або publication.dateTime у JS).

alter table public.publications
  add column if not exists platform_dates jsonb default '{}'::jsonb;

-- Допоміжна функція: ефективна дата для конкретної платформи
create or replace function public.platform_publish_at(pub_id uuid, plat text)
returns timestamptz
language plpgsql
stable
as $$
declare
  pub_record public.publications;
  override timestamptz;
begin
  select * into pub_record from public.publications where id = pub_id;
  if not found then return null; end if;
  begin
    override := (pub_record.platform_dates ->> plat)::timestamptz;
    if override is not null then return override; end if;
  exception when others then null;
  end;
  return pub_record.publish_at;
end;
$$;

grant execute on function public.platform_publish_at(uuid, text) to authenticated;

comment on column public.publications.platform_dates is
  'Per-platform publish overrides. Format: {"ig": "ISO timestamp", "tg": "...", ...}. Якщо для платформи не задано — використовується publish_at.';
