select json_agg(json_build_object('id',jobid,'sched',schedule,'fn',
   substring(command from 'functions/v1/([a-z0-9-]+)')) order by jobid) as r
from cron.job
where active and command ~* '(smm|watchdog|kasa-stale|ig-comment|autosvit|meta|stats)';
