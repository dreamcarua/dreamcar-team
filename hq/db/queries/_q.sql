select json_agg(json_build_object('c',column_name,'t',data_type) order by ordinal_position) as cols
from information_schema.columns where table_name='dashboard_deals';
