CREATE OR REFRESH STREAMING TABLE silver.admins
TBLPROPERTIES ('delta.feature.timestampNtz' = 'supported');

CREATE FLOW admins_cdc AS AUTO CDC INTO silver.admins
FROM STREAM(lakebase.lb_admins_history)
KEYS (id)
APPLY AS DELETE WHEN _pg_change_type = 'delete'
SEQUENCE BY _pg_lsn
COLUMNS * EXCEPT (_pg_change_type, _pg_lsn, _pg_xid, _timestamp, _sort_by)
STORED AS SCD TYPE 1;
