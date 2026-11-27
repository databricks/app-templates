-- One-time setup for the Document Processing Review template.
--
-- Replace <INPUT_TABLE> with your fully qualified table name and <INPUT_LEAF>
-- with just its last part, then run this once against your warehouse.
--
--   <INPUT_TABLE>               your table:  id STRING, response VARIANT
--   <INPUT_TABLE>_approved_log  the app's only write target (append-only)
--   <INPUT_TABLE>_approved      what everything downstream reads
--
-- `response` can hold the output of any AI function that produces VARIANT:
-- ai_extract, ai_parse_document or ai_classify, used as returned. The app
-- discovers the shape at runtime.

-- 1. Approval log. One row per document per approver per approval, append-only,
-- so a re-approval adds a row and the full sequence is preserved.
--
-- NOTE: the constraint name includes the table name on purpose. Unity Catalog
-- constraint names are unique per SCHEMA, so a fixed name would collide the
-- second time you run this setup in the same schema.
CREATE TABLE IF NOT EXISTS <INPUT_TABLE>_approved_log (
  id                STRING    NOT NULL COMMENT 'Matches the id column of <INPUT_TABLE>.',
  approver          STRING    NOT NULL COMMENT 'From the X-Forwarded-Email header, server-side.',
  approved_at       TIMESTAMP NOT NULL COMMENT 'When this approval was recorded.',
  approved_response VARIANT            COMMENT 'The approved document, in the SAME schema as <INPUT_TABLE>.response. Changed values are replaced. Confidence scores and citations are carried over untouched.',
  CONSTRAINT <INPUT_LEAF>_approved_log_pk PRIMARY KEY (id, approver, approved_at) RELY
)
CLUSTER BY (id)
-- Append-only for real, not by convention: reviewers need MODIFY to INSERT, and
-- MODIFY also allows UPDATE and DELETE. This property refuses both at the table,
-- so an approval can only ever be added.
TBLPROPERTIES ('delta.appendOnly' = 'true');

-- 2. Input plus approval state: one row per document in <INPUT_TABLE>, always.
-- A document that has never been approved still appears, with a NULL
-- latest_approved_response and approval_count 0, so this view is a drop-in
-- replacement for the input table for anything downstream.
--
-- The `latest_` prefix is deliberate: the log may hold several approvals of one
-- document, and these columns are the most recent of them. In the log itself the
-- same payload is just `approved_response`, because there a row IS one approval.
--
-- `latest_approved_response` is that reviewer's WHOLE copy, not a merge of
-- every reviewer's corrections: approvals are independent opinions of the
-- model's output, so an unchanged approval after a corrected one shows the
-- model's values here. Read the log when `approval_count > 1`.
--
-- Assumes the input's key column is named `id`. If yours differs, change the
-- references below.
CREATE OR REPLACE VIEW <INPUT_TABLE>_approved AS
SELECT
  i.id,                                              -- same key column as the input
  i.response,                                        -- what the model produced
  a.latest_approved_response,                        -- most recent approved copy, NULL until approved
  a.latest_approved_at,
  a.latest_approver,
  coalesce(a.approval_count, 0) AS approval_count
FROM <INPUT_TABLE> i
LEFT JOIN (
  -- Each max_by orders by (approved_at, approver), not approved_at alone. With
  -- id that pair is the primary key, so it is unique within a group and all
  -- three columns are guaranteed to come from the same approval. Ordering by
  -- approved_at alone can mix rows when two approvals share a timestamp, which
  -- is reachable here because approvals are independent and concurrent.
  SELECT id,
         max_by(approved_response, struct(approved_at, approver)) AS latest_approved_response,
         max_by(approved_at, struct(approved_at, approver))       AS latest_approved_at,
         max_by(approver, struct(approved_at, approver))          AS latest_approver,
         count(*)                                                 AS approval_count
  FROM <INPUT_TABLE>_approved_log
  GROUP BY id
) a ON a.id = i.id;
