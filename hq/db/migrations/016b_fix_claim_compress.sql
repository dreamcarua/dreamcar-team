-- Migration 016b: fix ambiguous column in claim_compress_jobs

create or replace function public.claim_compress_jobs(worker_name text, max_jobs int default 1)
returns table(out_id uuid, out_name text, out_type text, out_thumbnail_url text, out_size_bytes bigint)
as $$
begin
  return query
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
  returning c.id, c.name, c.type, c.thumbnail_url, c.size_bytes;
end;
$$ language plpgsql security definer;

-- Reset processing → pending щоб worker побачив ці креативи знову
update creatives
   set compressed_status = 'pending',
       compress_error    = null
 where compressed_status = 'processing';
