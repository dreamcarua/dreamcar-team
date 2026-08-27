select json_build_object(
  'compress_queue', (select json_build_object(
      'pending', count(*) filter (where compressed_status='pending'),
      'processing', count(*) filter (where compressed_status='processing'),
      'last_upload', max(uploaded_at))
     from creatives where type='video' and deleted_at is null),
  'job24', (select json_build_object('sched',schedule,'active',active) from cron.job where jobid=24)
) as r;
