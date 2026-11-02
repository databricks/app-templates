-- Databricks notebook source
-- Rehearses the restore of a table with a row filter or masks (docs/runbook.md#restore-a-table) on a copy of each table the data owner owns: drops the copy's filter and masks, restores it, sets them again, and checks them and the rows. Only reads the tables themselves.
USE CATALOG IDENTIFIER(:catalog);

-- COMMAND ----------

BEGIN
  DECLARE protections_query STRING DEFAULT
    "SELECT array_sort(collect_list(named_struct('set_clause', set_clause, 'drop_clause', drop_clause))) FROM (
      SELECT table_schema, table_name,
        ' SET ROW FILTER `' || replace(filter_name, '.', '`.`') || '` ON (' || target_columns || ')' AS set_clause,
        ' DROP ROW FILTER' AS drop_clause
      FROM information_schema.row_filters
      UNION ALL
      SELECT table_schema, table_name,
        ' ALTER COLUMN `' || column_name || '` SET MASK `' || replace(mask_name, '.', '`.`') || '`'
          || CASE WHEN coalesce(using_columns, '') = '' THEN '' ELSE ' USING COLUMNS (' || using_columns || ')' END,
        ' ALTER COLUMN `' || column_name || '` DROP MASK'
      FROM information_schema.column_masks
    ) WHERE table_schema = ? AND table_name = ?";
  DECLARE protections ARRAY<STRUCT<set_clause: STRING, drop_clause: STRING>>;
  DECLARE restored_protections ARRAY<STRUCT<set_clause: STRING, drop_clause: STRING>>;
  DECLARE created_copy STRING;
  DECLARE restore_version BIGINT;
  DECLARE rows_before BIGINT;
  DECLARE checksum_before BIGINT;
  DECLARE rows_after BIGINT;
  DECLARE checksum_after BIGINT;
  DECLARE restored_tables INT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    IF created_copy IS NOT NULL THEN
      EXECUTE IMMEDIATE "DROP TABLE " || created_copy;
    END IF;
    RESIGNAL;
  END;
  FOR source AS
    SELECT table_schema, table_name,
      "`" || table_schema || "`.`" || table_name || "`" AS name,
      "`" || table_schema || "`.`" || table_name || "_restore_rehearsal`" AS copy_name
    FROM information_schema.tables
    WHERE table_schema IN (:project || '_data', :project || '_ops', :project || '_reference')
      AND table_owner = current_user()
      AND table_type = 'MANAGED'
      AND NOT endswith(table_name, '_restore_rehearsal')
    ORDER BY table_schema, table_name
  DO
    EXECUTE IMMEDIATE "CREATE TABLE " || source.copy_name || " LIKE " || source.name;
    SET created_copy = source.copy_name;
    EXECUTE IMMEDIATE protections_query INTO protections USING source.table_schema, source.table_name;
    FOR protection AS SELECT inline(protections) DO
      EXECUTE IMMEDIATE "ALTER TABLE " || created_copy || protection.set_clause;
    END FOR;
    EXECUTE IMMEDIATE "INSERT INTO " || created_copy || " SELECT * FROM " || source.name;
    EXECUTE IMMEDIATE "SELECT count(*), sum(hash(*)) FROM " || created_copy INTO rows_before, checksum_before;
    IF rows_before > 0 THEN
      EXECUTE IMMEDIATE "SELECT max(version) FROM (DESCRIBE HISTORY " || created_copy || ")" INTO restore_version;
      EXECUTE IMMEDIATE "INSERT INTO " || created_copy || " SELECT * FROM " || created_copy;
      FOR protection AS SELECT inline(protections) DO
        EXECUTE IMMEDIATE "ALTER TABLE " || created_copy || protection.drop_clause;
      END FOR;
      EXECUTE IMMEDIATE "RESTORE TABLE " || created_copy || " TO VERSION AS OF " || restore_version;
      FOR protection AS SELECT inline(protections) DO
        EXECUTE IMMEDIATE "ALTER TABLE " || created_copy || protection.set_clause;
      END FOR;
      EXECUTE IMMEDIATE protections_query INTO restored_protections
        USING source.table_schema, source.table_name || '_restore_rehearsal';
      IF restored_protections <> protections THEN
        SIGNAL SQLSTATE '22000' SET MESSAGE_TEXT = "After restoring " || created_copy || ", a copy of " || source.name
          || ", setting its row filter and masks again left them different from the table's."
          || " Fix the steps in docs/runbook.md#restore-a-table, then run this job again.";
      END IF;
      EXECUTE IMMEDIATE "SELECT count(*), sum(hash(*)) FROM " || created_copy INTO rows_after, checksum_after;
      IF rows_after <> rows_before OR checksum_after <> checksum_before THEN
        SIGNAL SQLSTATE '22000' SET MESSAGE_TEXT = "Restoring " || created_copy || ", a copy of " || source.name
          || ", to version " || restore_version || " gave " || rows_after || " rows, expected " || rows_before
          || " with the same checksum. Fix the steps in docs/runbook.md#restore-a-table, then run this job again.";
      END IF;
      SET restored_tables = restored_tables + 1;
    END IF;
    EXECUTE IMMEDIATE "DROP TABLE " || created_copy;
    SET created_copy = NULL;
  END FOR;
  IF restored_tables = 0 THEN
    SIGNAL SQLSTATE '22000' SET MESSAGE_TEXT = "No table the data owner owns in " || :project
      || "_data, " || :project || "_ops or " || :project || "_reference has rows it can read, so no restore was rehearsed."
      || " Check that the data owner is in the back-office group and that the tables hold rows, then run this job again.";
  END IF;
END;
