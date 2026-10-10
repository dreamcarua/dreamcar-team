-- 058 (10.10.2026) — аудит B9: dispatch-workflow більше не приймає anon-ключ.
-- Тригер trg_dispatch_compress_on_video (на public.creatives) слав Authorization: Bearer <anon JWT>,
-- захардкоджений у тілі функції. Тепер шле x-hq-cron-secret з public.app_secrets (як усі cron-и).
-- Накатити ДО деплою нової версії dispatch-workflow. Бізнес-логіка (дебаунс 90 с, workflow=compress,
-- «ніколи не блокувати завантаження») без змін.

create or replace function public.trg_dispatch_compress_on_video()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_last timestamptz; v_secret text;
begin
  if new.type <> 'video' or coalesce(new.compressed_status,'') <> 'pending' then
    return new;
  end if;
  -- дебаунс 90с: пачка завантажень не плодить десятки GH-runs
  select last_at into v_last from public._dispatch_debounce where workflow='compress';
  if v_last is not null and v_last > now() - interval '90 seconds' then
    return new;
  end if;
  insert into public._dispatch_debounce(workflow,last_at) values ('compress', now())
    on conflict (workflow) do update set last_at = now();

  select value into v_secret from public.app_secrets where key = 'hq_cron_secret';
  if v_secret is null then
    return new; -- без секрету не шлемо; safety-net cron 24 підхопить стиснення за ≤5 хв
  end if;
  perform net.http_post(
    url := 'https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/dispatch-workflow',
    headers := jsonb_build_object('Content-Type','application/json','x-hq-cron-secret', v_secret),
    body := jsonb_build_object('workflow','compress')
  );
  return new;
exception when others then
  -- ніколи не блокуємо завантаження креативу через збій dispatch
  return new;
end $function$;
