select json_agg(json_build_object('id',jobid,'sched',schedule,'cmd',command) order by jobid) as r
from cron.job where jobid in (24,75,76);
