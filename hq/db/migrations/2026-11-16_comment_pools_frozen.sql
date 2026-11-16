-- 16.11.2026 · фіксація пулу перед ефіром (номери більше не перераховуються)
alter table public.comment_pools add column if not exists frozen jsonb;
comment on column public.comment_pools.frozen is 'Зафіксований пул перед ефіром: {at,by,config,entries:[[n,id,username,text,epoch_ms]]}; номери після фіксації не змінюються';
