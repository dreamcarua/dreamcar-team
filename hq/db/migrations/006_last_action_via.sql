-- =====================================================================
-- Migration 006 — publications.last_action_via
-- =====================================================================
-- Захист від подвійних TG-пушів коли callback_query з кнопки змінює статус,
-- а потім DB webhook тригерить notify-tg.
-- =====================================================================

alter table public.publications
  add column if not exists last_action_via text;

comment on column public.publications.last_action_via is
  'Хто змінив останнім: web | tg | null. notify-tg скіпає approve/rework push якщо last_action_via=tg (бо бот сам відредагував повідомлення з кнопками).';
