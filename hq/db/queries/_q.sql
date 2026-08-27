select json_agg(json_build_object('status',r.status_code,'body',left(r.content,300)) order by r.id desc) as res
from net._http_response r
join net.http_request_queue q on q.id = r.id
where q.url ilike '%smm-content-watchdog%'
limit 3;
