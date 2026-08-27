select json_agg(json_build_object('status',status_code,'body',convert_from(content,'UTF8')) order by id desc) as r
from (select * from net._http_response order by id desc limit 2) t;
