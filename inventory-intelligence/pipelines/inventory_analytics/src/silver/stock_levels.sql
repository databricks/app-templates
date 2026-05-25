CREATE OR REFRESH STREAMING TABLE silver.stock_levels
TBLPROPERTIES ('delta.feature.timestampNtz' = 'supported');

CREATE FLOW stock_levels_cdc AS AUTO CDC INTO silver.stock_levels
FROM STREAM(lakebase.lb_stock_levels_history)
KEYS (id)
APPLY AS DELETE WHEN _pg_change_type = 'delete'
SEQUENCE BY _pg_lsn
COLUMNS * EXCEPT (_pg_change_type, _pg_lsn, _pg_xid, _timestamp, _sort_by)
STORED AS SCD TYPE 1;
