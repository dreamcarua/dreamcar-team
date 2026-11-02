-- 068 (02.11.2026): платні задачі відділу креативів (swap-director: заміна авто / людини / предмета у відео).
-- Сесія на Mac Studio рахує ціну → воркер надсилає action "quote" → бот показує ціну з кнопками
-- «Підтвердити / Відхилити» → натискання приймається лише від погоджувачів ціни
-- (app_secrets.cd_price_approver_tg_ids, список tg id через кому; значення ставиться SQL-ом поза репо,
-- репо публічний) → статус знову queued, воркер бере задачу і запускає оплачену генерацію.
-- Відкат: див. кінець файлу.

alter table public.creative_requests drop constraint if exists creative_requests_status_check;
alter table public.creative_requests add constraint creative_requests_status_check
  check (status in ('queued','working','need_info','need_price_ok','done','failed','cancelled'));

alter table public.creative_requests
  add column if not exists quote      jsonb,                         -- {price_text, items[], total_usd, credits, engine, details}
  add column if not exists quote_msgs jsonb not null default '[]',   -- [{chat, msg}] повідомлення з кнопками
  add column if not exists price_ok   jsonb;                         -- {by_tg_id, by_name, at, quote}

-- Відкат:
-- update public.creative_requests set status='cancelled' where status='need_price_ok';
-- alter table public.creative_requests drop constraint creative_requests_status_check;
-- alter table public.creative_requests add constraint creative_requests_status_check
--   check (status in ('queued','working','need_info','done','failed','cancelled'));
-- alter table public.creative_requests drop column quote, drop column quote_msgs, drop column price_ok;
