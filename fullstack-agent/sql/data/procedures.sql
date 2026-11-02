-- Databricks notebook source
-- Creates the definer write procedures (transfer, dispute, contact details). Each checks its rules as the caller, writes an audit row and replays a repeated idempotency key.
USE CATALOG IDENTIFIER(:catalog);

-- COMMAND ----------

USE SCHEMA IDENTIFIER(:project || '_ops');

-- COMMAND ----------

EXECUTE IMMEDIATE replace(replace(r"
CREATE OR REPLACE PROCEDURE {ops}.transfer_between_own_accounts(
  IN from_account STRING,
  IN to_account STRING,
  IN transfer_amount DECIMAL(12, 2),
  IN request_key STRING,
  OUT status STRING,
  OUT reference STRING,
  OUT acted_as STRING,
  OUT message STRING
)
LANGUAGE SQL
SQL SECURITY DEFINER
MODIFIES SQL DATA
COMMENT 'Moves money between two open accounts of the calling customer, at most EUR 5,000 per transfer. A rule that cannot be evaluated rejects.'
AS BEGIN ATOMIC
  DECLARE owned_count INT;
  DECLARE currency_count INT;
  DECLARE available DECIMAL(14, 2);
  DECLARE receiving_balance DECIMAL(14, 2);
  DECLARE failure STRING;
  SET acted_as = session_user();
  SET reference = (
    SELECT max(audit_id) FROM {ops}.action_audit
    WHERE action = 'transfer_between_own_accounts' AND actor = session_user()
      AND idempotency_key = request_key AND outcome = 'OK'
  );
  IF reference IS NOT NULL THEN
    SET status = 'OK_REPLAYED';
    SET message = 'This transfer was already made.';
  ELSE
    SET owned_count = (
      SELECT count(*) FROM {data}.accounts
      WHERE account_id IN (from_account, to_account) AND owner_email = session_user() AND status = 'OPEN'
    );
    SET currency_count = (
      SELECT count(DISTINCT currency) FROM {data}.accounts
      WHERE account_id IN (from_account, to_account) AND owner_email = session_user()
    );
    SET available = (
      SELECT max(balance + coalesce(credit_limit, 0)) FROM {data}.accounts
      WHERE account_id = from_account AND owner_email = session_user()
    );
    SET receiving_balance = (
      SELECT max(balance) FROM {data}.accounts
      WHERE account_id = to_account AND owner_email = session_user()
    );
    SET failure = CASE
      WHEN request_key IS NULL OR trim(request_key) = '' THEN 'An idempotency key is required.'
      WHEN from_account = to_account OR owned_count <> 2 THEN 'Both accounts must be different open accounts in your name.'
      WHEN currency_count <> 1 THEN 'Both accounts must use the same currency.'
      WHEN available IS NULL OR receiving_balance IS NULL THEN 'Both accounts must have a balance to proceed.'
      WHEN transfer_amount IS NULL OR transfer_amount <= 0 THEN 'The amount must be above 0.'
      WHEN transfer_amount > 5000 THEN 'The maximum per transfer is €5,000.'
      WHEN transfer_amount > available THEN 'The amount exceeds the available balance.'
    END;
    IF failure IS NOT NULL THEN
      INSERT INTO {ops}.action_audit
      SELECT
        concat('REJ-', upper(substr(replace(uuid(), '-', ''), 1, 32))),
        current_timestamp(),
        'transfer_between_own_accounts',
        session_user(),
        array(from_account, to_account),
        transfer_amount,
        'REJECTED',
        failure,
        request_key;
      SET status = 'REJECTED';
      SET message = failure;
    ELSE
      SET reference = concat('TRF-', upper(substr(replace(uuid(), '-', ''), 1, 32)));
      UPDATE {data}.accounts SET balance = balance - transfer_amount WHERE account_id = from_account;
      UPDATE {data}.accounts SET balance = balance + transfer_amount WHERE account_id = to_account;
      INSERT INTO {data}.transactions
      SELECT
        concat(reference, '-OUT'), from_account, session_user(), current_timestamp(), transfer_amount, 'DEBIT',
        concat('TRANSFER TO ', to_account), 'TRANSFER', 'TRANSFER', CAST(NULL AS DOUBLE), 'BOOKED'
      UNION ALL
      SELECT
        concat(reference, '-IN'), to_account, session_user(), current_timestamp(), transfer_amount, 'CREDIT',
        concat('TRANSFER FROM ', from_account), 'TRANSFER', 'TRANSFER', CAST(NULL AS DOUBLE), 'BOOKED';
      INSERT INTO {ops}.action_audit
      SELECT
        reference,
        current_timestamp(),
        'transfer_between_own_accounts',
        session_user(),
        array(from_account, to_account),
        transfer_amount,
        'OK',
        CAST(NULL AS STRING),
        request_key;
      SET status = 'OK';
      SET message = 'Transfer completed.';
    END IF;
  END IF;
END",
  '{ops}', :project || '_ops'),
  '{data}', :project || '_data');

-- COMMAND ----------

EXECUTE IMMEDIATE replace(replace(r"
CREATE OR REPLACE PROCEDURE {ops}.file_dispute(
  IN disputed_transaction STRING,
  IN dispute_reason STRING,
  IN customer_note STRING,
  IN request_key STRING,
  OUT status STRING,
  OUT reference STRING,
  OUT acted_as STRING,
  OUT message STRING
)
LANGUAGE SQL
SQL SECURITY DEFINER
MODIFIES SQL DATA
COMMENT 'Opens a dispute on a debit card transaction of the calling customer from the last 120 days. A rule that cannot be evaluated rejects.'
AS BEGIN ATOMIC
  DECLARE found_direction STRING;
  DECLARE found_booked_at TIMESTAMP;
  DECLARE found_amount DECIMAL(12, 2);
  DECLARE existing_disputes INT;
  DECLARE failure STRING;
  SET acted_as = session_user();
  SET reference = (
    SELECT max(audit_id) FROM {ops}.action_audit
    WHERE action = 'file_dispute' AND actor = session_user()
      AND idempotency_key = request_key AND outcome = 'OK'
  );
  IF reference IS NOT NULL THEN
    SET status = 'OK_REPLAYED';
    SET message = 'This dispute was already filed.';
  ELSE
    SET found_direction = (
      SELECT max(direction) FROM {data}.transactions
      WHERE transaction_id = disputed_transaction AND owner_email = session_user()
    );
    SET found_booked_at = (
      SELECT max(booked_at) FROM {data}.transactions
      WHERE transaction_id = disputed_transaction AND owner_email = session_user()
    );
    SET found_amount = (
      SELECT max(amount) FROM {data}.transactions
      WHERE transaction_id = disputed_transaction AND owner_email = session_user()
    );
    SET existing_disputes = (
      SELECT count(*) FROM {data}.disputes WHERE transaction_id = disputed_transaction
    );
    SET failure = CASE
      WHEN request_key IS NULL OR trim(request_key) = '' THEN 'An idempotency key is required.'
      WHEN found_direction IS NULL THEN 'We can\'t find this payment in your accounts.'
      WHEN found_booked_at IS NULL THEN 'This payment has no booking date yet, so it can\'t be disputed.'
      WHEN found_direction <> 'DEBIT' THEN 'Only outgoing payments can be disputed.'
      WHEN found_booked_at < current_timestamp() - INTERVAL 120 DAYS THEN 'Only payments from the last 120 days can be disputed.'
      WHEN existing_disputes > 0 THEN 'This payment has already been disputed.'
      WHEN dispute_reason IS NULL OR dispute_reason NOT IN ('UNRECOGNISED', 'DUPLICATE', 'WRONG_AMOUNT', 'GOODS_NOT_RECEIVED')
        THEN 'Choose a valid reason for this dispute.'
      WHEN length(customer_note) > 500 THEN 'The note must be at most 500 characters.'
    END;
    IF failure IS NOT NULL THEN
      INSERT INTO {ops}.action_audit
      SELECT
        concat('REJ-', upper(substr(replace(uuid(), '-', ''), 1, 32))),
        current_timestamp(),
        'file_dispute',
        session_user(),
        array(disputed_transaction),
        found_amount,
        'REJECTED',
        failure,
        request_key;
      SET status = 'REJECTED';
      SET message = failure;
    ELSE
      SET reference = concat('DSP-', upper(substr(replace(uuid(), '-', ''), 1, 32)));
      INSERT INTO {data}.disputes
      SELECT
        reference, disputed_transaction, session_user(), dispute_reason, customer_note, 'OPEN',
        current_timestamp(), session_user();
      INSERT INTO {ops}.action_audit
      SELECT
        reference,
        current_timestamp(),
        'file_dispute',
        session_user(),
        array(disputed_transaction),
        found_amount,
        'OK',
        CAST(NULL AS STRING),
        request_key;
      SET status = 'OK';
      SET message = 'Dispute filed.';
    END IF;
  END IF;
END",
  '{ops}', :project || '_ops'),
  '{data}', :project || '_data');

-- COMMAND ----------

EXECUTE IMMEDIATE replace(replace(r"
CREATE OR REPLACE PROCEDURE {ops}.update_contact_details(
  IN new_phone STRING,
  IN new_address_line1 STRING,
  IN new_city STRING,
  IN new_postcode STRING,
  IN request_key STRING,
  OUT status STRING,
  OUT reference STRING,
  OUT acted_as STRING,
  OUT message STRING
)
LANGUAGE SQL
SQL SECURITY DEFINER
MODIFIES SQL DATA
COMMENT 'Updates the phone number and address of the calling customer. Name and email cannot change here.'
AS BEGIN ATOMIC
  DECLARE own_customer STRING;
  DECLARE failure STRING;
  SET acted_as = session_user();
  SET reference = (
    SELECT max(audit_id) FROM {ops}.action_audit
    WHERE action = 'update_contact_details' AND actor = session_user()
      AND idempotency_key = request_key AND outcome = 'OK'
  );
  IF reference IS NOT NULL THEN
    SET status = 'OK_REPLAYED';
    SET message = 'These contact details were already saved.';
  ELSE
    SET own_customer = (
      SELECT max(customer_id) FROM {data}.customers WHERE owner_email = session_user()
    );
    SET failure = CASE
      WHEN request_key IS NULL OR trim(request_key) = '' THEN 'An idempotency key is required.'
      WHEN own_customer IS NULL THEN 'We can\'t find your customer profile. Contact customer support.'
      WHEN new_phone IS NULL OR NOT new_phone RLIKE '^[+][1-9][0-9]{7,14}$'
        THEN 'The phone number must be in international format, for example +31612345678.'
      WHEN coalesce(trim(new_address_line1), '') = '' OR coalesce(trim(new_city), '') = '' OR coalesce(trim(new_postcode), '') = ''
        THEN 'Address, city and postcode are required.'
      WHEN length(new_address_line1) > 100 OR length(new_city) > 100 OR length(new_postcode) > 20
        THEN 'Address and city must be at most 100 characters, and the postcode at most 20.'
    END;
    IF failure IS NOT NULL THEN
      INSERT INTO {ops}.action_audit
      SELECT
        concat('REJ-', upper(substr(replace(uuid(), '-', ''), 1, 32))),
        current_timestamp(),
        'update_contact_details',
        session_user(),
        array(coalesce(own_customer, '')),
        CAST(NULL AS DECIMAL(12, 2)),
        'REJECTED',
        failure,
        request_key;
      SET status = 'REJECTED';
      SET message = failure;
    ELSE
      SET reference = concat('CON-', upper(substr(replace(uuid(), '-', ''), 1, 32)));
      UPDATE {data}.customers
      SET phone = new_phone, address_line1 = new_address_line1, city = new_city, postcode = new_postcode
      WHERE customer_id = own_customer AND owner_email = session_user();
      INSERT INTO {ops}.action_audit
      SELECT
        reference,
        current_timestamp(),
        'update_contact_details',
        session_user(),
        array(own_customer),
        CAST(NULL AS DECIMAL(12, 2)),
        'OK',
        CAST(NULL AS STRING),
        request_key;
      SET status = 'OK';
      SET message = 'Contact details updated.';
    END IF;
  END IF;
END",
  '{ops}', :project || '_ops'),
  '{data}', :project || '_data');
