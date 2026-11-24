-- Databricks notebook source
-- Adds sample customers, accounts and transactions for the two demo users and eight made-up customers. The demo's jobs run it after the test data.
USE CATALOG IDENTIFIER(:catalog);

-- COMMAND ----------

INSERT INTO IDENTIFIER(:project || '_data.customers') VALUES
  ('C001', :demo_user_one_email, :demo_user_one_name, '+31612345601', 'Keizersgracht 101', 'Amsterdam', '1015 CJ', 'NL482913571', DATE'1988-04-12', 'RETAIL', TIMESTAMP'2019-03-01 09:00:00'),
  ('C002', :demo_user_two_email, :demo_user_two_name, '+4915112345602', 'Lindenstrasse 22', 'Berlin', '10969', 'DE736204918', DATE'1990-09-23', 'RETAIL', TIMESTAMP'2020-06-15 10:30:00'),
  ('C003', 'anna.devries@example.com', 'Anna de Vries', '+31612345603', 'Oudegracht 45', 'Utrecht', '3511 AB', 'NL193847562', DATE'1979-01-30', 'PREMIER', TIMESTAMP'2016-11-02 14:10:00'),
  ('C004', 'luca.romano@example.com', 'Luca Romano', '+393401234504', 'Via Torino 8', 'Milan', '20123', 'IT574920183', DATE'1995-07-05', 'RETAIL', TIMESTAMP'2022-02-20 08:45:00'),
  ('C005', 'sofia.lindqvist@example.com', 'Sofia Lindqvist', '+46701234505', 'Sveavagen 31', 'Stockholm', '111 34', 'SE820461937', DATE'1984-12-18', 'PREMIER', TIMESTAMP'2017-05-09 16:20:00'),
  ('C006', 'tomasz.nowak@example.com', 'Tomasz Nowak', '+48501234506', 'Ulica Prosta 12', 'Warsaw', '00-850', 'PL361958204', DATE'1992-03-27', 'RETAIL', TIMESTAMP'2021-08-30 11:05:00'),
  ('C007', 'claire.dubois@example.com', 'Claire Dubois', '+33612345607', 'Rue Merciere 19', 'Lyon', '69002', 'FR647203918', DATE'1987-10-11', 'RETAIL', TIMESTAMP'2018-04-17 09:40:00'),
  ('C008', 'jonas.becker@example.com', 'Jonas Becker', '+4915112345608', 'Ost-West-Strasse 70', 'Hamburg', '20457', 'DE205839461', DATE'1975-06-02', 'PREMIER', TIMESTAMP'2015-09-23 13:15:00'),
  ('C009', 'elena.garcia@example.com', 'Elena Garcia', '+34612345609', 'Calle Mayor 5', 'Madrid', '28013', 'ES938170264', DATE'1998-02-14', 'RETAIL', TIMESTAMP'2023-01-12 10:00:00'),
  ('C010', 'pieter.janssens@example.com', 'Pieter Janssens', '+32470123410', 'Meir 50', 'Antwerp', '2000', 'BE472019385', DATE'1981-08-08', 'RETAIL', TIMESTAMP'2019-12-05 15:30:00');

-- COMMAND ----------

INSERT INTO IDENTIFIER(:project || '_data.accounts')
SELECT a.account_id, a.customer_id, c.owner_email, a.account_type, a.nickname, a.iban, 'EUR', a.balance, a.credit_limit, 'OPEN'
FROM VALUES
  ('ACC-1001', 'C001', 'CURRENT', 'Current account', 'NL01RIVB0000100101', 3240.15BD, NULL),
  ('ACC-1002', 'C001', 'SAVINGS', 'Holiday fund', 'NL01RIVB0000100102', 8500.00BD, NULL),
  ('ACC-1003', 'C001', 'CREDIT_CARD', 'Credit card', 'NL01RIVB0000100103', -612.40BD, 3000.00BD),
  ('ACC-1098', 'C001', 'SAVINGS', 'Joint account', 'NL01RIVB0000100998', NULL, NULL),
  ('ACC-2001', 'C002', 'CURRENT', 'Current account', 'DE01RIVB0000200101', 2150.80BD, NULL),
  ('ACC-2002', 'C002', 'SAVINGS', 'Bike fund', 'DE01RIVB0000200102', 1200.00BD, NULL),
  ('ACC-3001', 'C003', 'CURRENT', 'Current account', 'NL01RIVB0000300101', 1840.22BD, NULL),
  ('ACC-3002', 'C003', 'SAVINGS', 'Rainy day', 'NL01RIVB0000300102', 4200.00BD, NULL),
  ('ACC-4001', 'C004', 'CURRENT', 'Current account', 'IT01RIVB0000400101', 965.40BD, NULL),
  ('ACC-5001', 'C005', 'CURRENT', 'Current account', 'SE01RIVB0000500101', 3120.75BD, NULL),
  ('ACC-5002', 'C005', 'SAVINGS', 'House deposit', 'SE01RIVB0000500102', 22500.00BD, NULL),
  ('ACC-5003', 'C005', 'CREDIT_CARD', 'Credit card', 'SE01RIVB0000500103', -230.10BD, 2500.00BD),
  ('ACC-6001', 'C006', 'CURRENT', 'Current account', 'PL01RIVB0000600101', 412.88BD, NULL),
  ('ACC-7001', 'C007', 'CURRENT', 'Current account', 'FR01RIVB0000700101', 2788.00BD, NULL),
  ('ACC-7002', 'C007', 'SAVINGS', 'Travel', 'FR01RIVB0000700102', 3100.00BD, NULL),
  ('ACC-8001', 'C008', 'CURRENT', 'Current account', 'DE01RIVB0000800101', 5630.45BD, NULL),
  ('ACC-9001', 'C009', 'CURRENT', 'Current account', 'ES01RIVB0000900101', 1299.99BD, NULL),
  ('ACC-9002', 'C009', 'CREDIT_CARD', 'Credit card', 'ES01RIVB0000900102', -845.60BD, 4000.00BD),
  ('ACC-10001', 'C010', 'CURRENT', 'Current account', 'BE01RIVB0001000101', 760.30BD, NULL)
  AS a(account_id, customer_id, account_type, nickname, iban, balance, credit_limit)
JOIN IDENTIFIER(:project || '_data.customers') AS c USING (customer_id);

-- COMMAND ----------

INSERT INTO IDENTIFIER(:project || '_data.transactions')
WITH merchants AS (
  SELECT array(
    named_struct('merchant', 'GREENLEAF GROCERS', 'category', 'GROCERIES'),
    named_struct('merchant', 'CITY TRANSIT', 'category', 'TRANSPORT'),
    named_struct('merchant', 'STREAMBOX', 'category', 'SUBSCRIPTIONS'),
    named_struct('merchant', 'FUEL STOP', 'category', 'TRANSPORT'),
    named_struct('merchant', 'BOOKNOOK', 'category', 'SHOPPING'),
    named_struct('merchant', 'CORNER CAFE', 'category', 'EATING_OUT'),
    named_struct('merchant', 'HOMEWARE HALL', 'category', 'HOME'),
    named_struct('merchant', 'RIDE NOW', 'category', 'TRANSPORT'),
    named_struct('merchant', 'FRESH MARKET', 'category', 'GROCERIES'),
    named_struct('merchant', 'STYLE STREET', 'category', 'SHOPPING'),
    named_struct('merchant', 'CINEMA PLUS', 'category', 'ENTERTAINMENT'),
    named_struct('merchant', 'PHARMA PLUS', 'category', 'HEALTH')
  ) AS choices
),
series AS (
  SELECT
    account_id,
    owner_email,
    account_type,
    explode(sequence(1, CASE account_type WHEN 'CURRENT' THEN 40 WHEN 'CREDIT_CARD' THEN 12 ELSE 3 END)) AS n
  FROM IDENTIFIER(:project || '_data.accounts')
  WHERE account_id NOT IN (SELECT account_id FROM IDENTIFIER(:project || '_data.transactions'))
),
generated AS (
  SELECT
    s.account_id,
    s.owner_email,
    s.account_type,
    s.n,
    element_at(m.choices, 1 + pmod(s.n * 7 + abs(hash(s.account_id)), 12)) AS pick,
    CASE
      WHEN s.account_type = 'SAVINGS' THEN 'CREDIT'
      WHEN s.account_type = 'CURRENT' AND s.n % 10 = 5 THEN 'CREDIT'
      ELSE 'DEBIT'
    END AS direction
  FROM series AS s
  CROSS JOIN merchants AS m
)
SELECT
  concat('TX-', substr(account_id, 5), '-', lpad(CAST(n AS STRING), 3, '0')),
  account_id,
  owner_email,
  timestampadd(
    MINUTE,
    480 + pmod(n * 53, 720),
    CAST(date_sub(current_date(), CASE account_type WHEN 'SAVINGS' THEN n * 30 ELSE n * 2 END) AS TIMESTAMP)
  ),
  CASE
    WHEN account_type = 'SAVINGS' THEN 250.00BD
    WHEN direction = 'CREDIT' THEN CAST(2400 + pmod(abs(hash(account_id, n)), 800) AS DECIMAL(12, 2))
    ELSE CAST(round(3 + pmod(abs(hash(account_id, n)), 17700) / 100.0, 2) AS DECIMAL(12, 2))
  END,
  direction,
  CASE
    WHEN account_type = 'SAVINGS' THEN 'TRANSFER FROM CURRENT ACCOUNT'
    WHEN direction = 'CREDIT' THEN 'ACME PAYROLL'
    ELSE pick.merchant
  END,
  CASE
    WHEN account_type = 'SAVINGS' THEN 'TRANSFER'
    WHEN direction = 'CREDIT' THEN 'INCOME'
    ELSE pick.category
  END,
  CASE
    WHEN account_type = 'SAVINGS' OR direction = 'CREDIT' THEN 'TRANSFER'
    WHEN n % 3 = 0 THEN 'ONLINE'
    ELSE 'CARD'
  END,
  round(pmod(abs(hash(account_id, n, 'score')), 25) / 100.0, 2),
  'BOOKED'
FROM generated
UNION ALL
SELECT
  'TX-1003-899',
  'ACC-1003',
  owner_email,
  timestampadd(MINUTE, 1427, CAST(date_sub(current_date(), 6) AS TIMESTAMP)),
  899.00BD,
  'DEBIT',
  'ELECTROSHOP ONLINE',
  'ELECTRONICS',
  'ONLINE',
  0.91,
  'BOOKED'
FROM IDENTIFIER(:project || '_data.accounts')
WHERE account_id = 'ACC-1003'
UNION ALL
SELECT
  'TX-1001-998',
  'ACC-1001',
  owner_email,
  CAST(NULL AS TIMESTAMP),
  150.50BD,
  'DEBIT',
  'INTERNATIONAL TRANSFER',
  'TRANSFER',
  'ONLINE',
  0.0,
  'PENDING'
FROM IDENTIFIER(:project || '_data.accounts')
WHERE account_id = 'ACC-1001';

-- COMMAND ----------

SELECT
  (SELECT count(*) FROM IDENTIFIER(:project || '_data.customers')) AS customers,
  (SELECT count(*) FROM IDENTIFIER(:project || '_data.accounts')) AS accounts,
  (SELECT count(*) FROM IDENTIFIER(:project || '_data.transactions')) AS transactions,
  (SELECT count(*) FROM IDENTIFIER(:project || '_reference.products')) AS products;
