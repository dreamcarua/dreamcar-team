-- Migration 016c: restore proper return field names for claim_compress_jobs

create or replace function public.claim_compress_jobs(worker_name text, max_jobs int default 1)
returns table(id uuid, name text, type text, thumbnail_url text, size_bytes bigint)
as $$
begin
  return query
  with claimed as (
    update creatives c
       set compressed_status = 'processing',
           compress_error    = worker_name
     where c.id in (
       select c2.id from creatives c2
        where c2.compressed_status = 'pending'
          and c2.type = 'video'
          and c2.thumbnail_url is not null
          and c2.deleted_at is null
        order by c2.uploaded_at asc nulls last
        limit max_jobs
        for update skip locked
     )
    returning c.id as cid, c.name as cname, c.type as ctype,
              c.thumbnail_url as curl, c.size_bytes as csize
  )
  select cid, cname, ctype, curl, csize from claimed;
end;
$$ language plpgsql security definer;

-- Reset stuck rows
update creatives
   set compressed_status = 'pending',
       compress_error    = null
 where compressed_status = 'processing';
