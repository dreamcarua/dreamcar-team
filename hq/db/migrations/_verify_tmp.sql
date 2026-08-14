select column_name, data_type
from information_schema.columns
where table_name='retention_messages' and column_name='rubric_id';
