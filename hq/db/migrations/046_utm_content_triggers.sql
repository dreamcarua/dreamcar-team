-- 046_utm_content_triggers.sql (08.10.2026, застосовано через Supabase MCP).
-- Функції dc_utm_slug / dc_utm_rewrite створені 05.10 (міграція utm_content_functions), але тригера не було:
-- «utm_content» у розсилках і постах не замінювався (Віра, 08.10: «Давид погодив, але посилання як було так і залишилось»).
-- Правила: посилання dreamcar.ua з utm_content → <канал>_<YYYYMMDD>_<HHMM Київ>_<8 символів id>[_text|_video|_photo];
-- канали: tg→tgbot, viber→vb, email→em, sms, push; пости SMM у TG-каналі → tgch. Після «погоджено» код не змінюється.
-- Посилання без utm_content і чужі домени не чіпаються.

create or replace function public.dc_utm_channel_code(p_channel text) returns text language sql immutable as $$
  select case p_channel when 'tg' then 'tgbot' when 'viber' then 'vb' when 'email' then 'em' when 'sms' then 'sms' when 'push' then 'push' else null end $$;

create or replace function public.retention_messages_utm() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_ch text; v_slug text; v_frozen boolean;
begin
  v_ch := public.dc_utm_channel_code(new.channel::text);
  if v_ch is null then return new; end if;
  v_frozen := tg_op = 'UPDATE' and old.status::text in ('approved','scheduled','sending','sent','failed','archived');
  if v_frozen then return new; end if;
  v_slug := public.dc_utm_slug(v_ch, new.publish_at, new.id);
  new.body := public.dc_utm_rewrite(new.body, v_slug);
  new.preview_text := public.dc_utm_rewrite(new.preview_text, v_slug);
  if new.tg_buttons is not null and new.tg_buttons::text ~ 'utm_content=' then
    new.tg_buttons := public.dc_utm_rewrite(new.tg_buttons::text, v_slug)::jsonb;
  end if;
  return new;
end $$;
create or replace trigger retention_messages_utm before insert or update of body, preview_text, tg_buttons, publish_at, channel, status
  on public.retention_messages for each row execute function public.retention_messages_utm();

create or replace function public.publications_utm() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_slug text;
begin
  if tg_op = 'UPDATE' and old.status::text in ('approved','published') then return new; end if;
  if coalesce(new.text_body,'') !~ 'utm_content=' and coalesce(new.tg_buttons::text,'') !~ 'utm_content=' then return new; end if;
  v_slug := public.dc_utm_slug('tgch', new.publish_at, new.id);
  new.text_body := public.dc_utm_rewrite(new.text_body, v_slug);
  if new.tg_buttons is not null and new.tg_buttons::text ~ 'utm_content=' then
    new.tg_buttons := public.dc_utm_rewrite(new.tg_buttons::text, v_slug)::jsonb;
  end if;
  return new;
end $$;
create or replace trigger publications_utm before insert or update of text_body, tg_buttons, publish_at, status
  on public.publications for each row execute function public.publications_utm();
-- Одноразово 08.10: код проставлено «Анонсу» 09.10 13:00 (погоджений до появи тригера).
