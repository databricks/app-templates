CREATE OR REFRESH STREAMING TABLE silver.support_cases
TBLPROPERTIES ('delta.feature.timestampNtz' = 'supported');

CREATE FLOW support_cases_cdc AS AUTO CDC INTO silver.support_cases
FROM STREAM(lakebase.lb_support_cases_history)
KEYS (id)
APPLY AS DELETE WHEN _pg_change_type = 'delete'
SEQUENCE BY _pg_lsn
COLUMNS * EXCEPT (_pg_change_type, _pg_lsn, _pg_xid, _timestamp, _sort_by)
STORED AS SCD TYPE 1;
