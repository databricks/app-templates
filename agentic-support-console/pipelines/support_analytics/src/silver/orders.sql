CREATE OR REFRESH STREAMING TABLE silver.orders
TBLPROPERTIES ('delta.feature.timestampNtz' = 'supported');

CREATE FLOW orders_cdc AS AUTO CDC INTO silver.orders
FROM STREAM(lakebase.lb_orders_history)
KEYS (id)
APPLY AS DELETE WHEN _pg_change_type = 'delete'
SEQUENCE BY _pg_lsn
COLUMNS * EXCEPT (_pg_change_type, _pg_lsn, _pg_xid, _timestamp, _sort_by)
STORED AS SCD TYPE 1;
