-- Migration 016: background compress fields for creatives
-- For video creatives: ffmpeg CRF 18 preset slower → compressed_url у R2

alter table creatives
  add column if not exists compressed_url        text,
  add column if not exists compressed_size_bytes bigint,
  add column if not exists compressed_status     text default 'n/a',
  add column if not exists compressed_at         timestamptz,
  add column if not exists compress_error        text;

-- 'n/a' для не-video типів, 'pending' для video
update creatives
   set compressed_status = case when type = 'video' then 'pending' else 'n/a' end
 where compressed_status is null
    or compressed_status = 'n/a' and type = 'video' and compressed_url is null;

-- Тригер: новий video creative автоматично 'pending'
create or replace function public.set_initial_compressed_status()
returns trigger as $$
begin
  if new.compressed_status is null then
    if new.type = 'video' then
      new.compressed_status := 'pending';
    else
      new.compressed_status := 'n/a';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_compressed_status on creatives;
create trigger trg_set_compressed_status
  before insert on creatives
  for each row execute function public.set_initial_compressed_status();

-- Index щоб GH Action швидко знаходила pending
create index if not exists idx_creatives_compressed_pending
  on creatives (compressed_status, uploaded_at)
  where compressed_status in ('pending', 'failed');

-- RPC: claim наступну pending creative (по аналогії з autopost queue)
create or replace function public.claim_compress_jobs(worker_name text, max_jobs int default 1)
returns table(id uuid, name text, type text, thumbnail_url text, size_bytes bigint)
as $$
begin
  return query
  with claimed as (
    update creatives
       set compressed_status = 'processing',
           compress_error    = worker_name
     where id in (
       select c.id from creatives c
        where c.compressed_status = 'pending'
          and c.type = 'video'
          and c.thumbnail_url is not null
          and c.deleted_at is null
        order by c.uploaded_at asc nulls last
        limit max_jobs
        for update skip locked
     )
    returning creatives.id, creatives.name, creatives.type, creatives.thumbnail_url, creatives.size_bytes
  )
  select * from claimed;
end;
$$ language plpgsql security definer;

-- RPC: позначити creative як стиснений
create or replace function public.complete_compress_job(
  cre_id uuid,
  out_url text,
  out_size_bytes bigint
)
returns void as $$
begin
  update creatives
     set compressed_url        = out_url,
         compressed_size_bytes = out_size_bytes,
         compressed_status     = 'ready',
         compressed_at         = now(),
         compress_error        = null
   where id = cre_id;
end;
$$ language plpgsql security definer;

-- RPC: позначити failed
create or replace function public.fail_compress_job(cre_id uuid, err text)
returns void as $$
begin
  update creatives
     set compressed_status = 'failed',
         compress_error    = err
   where id = cre_id;
end;
$$ language plpgsql security definer;
