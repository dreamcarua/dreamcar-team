select json_agg(json_build_object('id',jobid,'sched',schedule,'active',active,'cmd',left(command,110)) order by jobid) as r
from cron.job where active;
