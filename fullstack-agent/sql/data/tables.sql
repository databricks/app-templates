-- Databricks notebook source
-- Creates the use-case tables (customers, accounts, transactions, disputes), each clustered on its owner_email row filter column, and the products reference table.
USE CATALOG IDENTIFIER(:catalog);

-- COMMAND ----------

CREATE TABLE IF NOT EXISTS IDENTIFIER(:project || '_data.customers') (
  customer_id STRING NOT NULL,
  owner_email STRING NOT NULL,
  full_name STRING,
  phone STRING,
  address_line1 STRING,
  city STRING,
  postcode STRING,
  national_id STRING,
  date_of_birth DATE,
  segment STRING,
  created_at TIMESTAMP
)
CLUSTER BY (owner_email)
TBLPROPERTIES ('delta.feature.catalogManaged' = 'supported');

-- COMMAND ----------

CREATE TABLE IF NOT EXISTS IDENTIFIER(:project || '_data.accounts') (
  account_id STRING NOT NULL,
  customer_id STRING NOT NULL,
  owner_email STRING NOT NULL,
  account_type STRING NOT NULL,
  nickname STRING,
  iban STRING,
  currency STRING,
  balance DECIMAL(12, 2),
  credit_limit DECIMAL(12, 2),
  status STRING
)
CLUSTER BY (owner_email)
TBLPROPERTIES ('delta.feature.catalogManaged' = 'supported');

-- COMMAND ----------

CREATE TABLE IF NOT EXISTS IDENTIFIER(:project || '_data.transactions') (
  transaction_id STRING NOT NULL,
  account_id STRING NOT NULL,
  owner_email STRING NOT NULL,
  booked_at TIMESTAMP,
  amount DECIMAL(12, 2),
  direction STRING,
  merchant STRING,
  category STRING,
  channel STRING,
  fraud_score DOUBLE,
  status STRING
)
CLUSTER BY (owner_email)
TBLPROPERTIES ('delta.feature.catalogManaged' = 'supported');

-- COMMAND ----------

CREATE TABLE IF NOT EXISTS IDENTIFIER(:project || '_data.disputes') (
  dispute_id STRING NOT NULL,
  transaction_id STRING NOT NULL,
  owner_email STRING NOT NULL,
  reason_code STRING,
  note STRING,
  status STRING,
  created_at TIMESTAMP,
  created_by STRING
)
CLUSTER BY (owner_email)
TBLPROPERTIES ('delta.feature.catalogManaged' = 'supported');

-- COMMAND ----------

CREATE TABLE IF NOT EXISTS IDENTIFIER(:project || '_reference.products') (
  product_id STRING NOT NULL,
  name STRING,
  type STRING,
  rate_pct DECIMAL(5, 2),
  monthly_fee DECIMAL(8, 2),
  terms STRING
)
TBLPROPERTIES ('delta.feature.catalogManaged' = 'supported');
