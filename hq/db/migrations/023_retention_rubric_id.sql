-- 023_retention_rubric_id.sql — 14.08.2026 (аудит «загублених полів»)
--
-- Проблема: retention/app-retention.js із #547 малює панель фільтрів по рубриках і
-- фарбує border-left картки через m.rubric_id, але у retention_messages такої колонки
-- не було, а у формі композера — жодного селектора. Наслідок: фільтри завжди
-- показували 0, картки лишались сірі, функція існувала лише на папері.
--
-- Фронт зроблено самозахищеним (Store.hasRubricCol): селектор і запис поля вмикаються
-- лише коли колонка реально є. Ця міграція її додає.

alter table public.retention_messages
  add column if not exists rubric_id uuid references public.rubrics(id) on delete set null;

create index if not exists idx_retention_messages_rubric
  on public.retention_messages (rubric_id)
  where rubric_id is not null;

comment on column public.retention_messages.rubric_id is
  'Рубрика (спільний довідник rubrics зі SMM). Фільтри + колір border-left картки.';
