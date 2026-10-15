# Databricks notebook source
# Generates synthetic inventory data in Unity Catalog, mirroring the schema that
# Lakehouse Sync produces when replicating Lakebase (Postgres) tables.
#
# Run this job before the inventory_analytics DLT pipeline when using sample data
# instead of a real Lakebase + Lakehouse Sync setup.
#
# Output tables (all in {catalog}.lakebase.*):
#   lb_stores_history              — 5 synthetic stores
#   lb_products_history            — 25 products across 5 categories
#   lb_stock_levels_history        — one row per store×product with current stock
#   lb_sales_transactions_history  — 90 days of synthetic daily sales

# COMMAND ----------

import random
import math
from datetime import datetime, timedelta, date, timezone

dbutils.widgets.text("catalog", "", "Unity Catalog catalog name")
dbutils.widgets.text("lakebase_schema", "lakebase", "Schema for Lakehouse Sync mirror tables")

catalog = dbutils.widgets.get("catalog")
lakebase_schema = dbutils.widgets.get("lakebase_schema")

if not catalog or catalog == "REPLACE_ME":
    raise ValueError("Set the 'catalog' widget to your Unity Catalog catalog name.")

print(f"Generating sample data in {catalog}.{lakebase_schema}.*")

# COMMAND ----------

# Ensure schemas exist
for schema in [lakebase_schema, "silver", "gold"]:
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS `{catalog}`.`{schema}`")

print("Schemas ready.")

# COMMAND ----------

# ── Reference data (mirrors seed/seed.ts) ────────────────────────────────────

STORES = [
    {"id": "s1", "name": "Chicago Flagship",  "region": "Midwest",   "city": "Chicago", "timezone": "America/Chicago"},
    {"id": "s2", "name": "Austin South",       "region": "South",     "city": "Austin",  "timezone": "America/Chicago"},
    {"id": "s3", "name": "Seattle Pike",       "region": "West",      "city": "Seattle", "timezone": "America/Los_Angeles"},
    {"id": "s4", "name": "Boston Harbor",      "region": "Northeast", "city": "Boston",  "timezone": "America/New_York"},
    {"id": "s5", "name": "Phoenix Desert",     "region": "Southwest", "city": "Phoenix", "timezone": "America/Phoenix"},
]

PRODUCTS = [
    {"id": "p01", "sku": "ELEC-001", "name": "Wireless Earbuds Pro",         "category": "Electronics",   "unit_cost_cents": 4999,  "reorder_point": 20, "reorder_quantity": 50,  "lead_time_days": 7},
    {"id": "p02", "sku": "ELEC-002", "name": "Smart Watch Series 3",         "category": "Electronics",   "unit_cost_cents": 14999, "reorder_point": 10, "reorder_quantity": 25,  "lead_time_days": 10},
    {"id": "p03", "sku": "ELEC-003", "name": "Portable Charger 20000mAh",    "category": "Electronics",   "unit_cost_cents": 2999,  "reorder_point": 30, "reorder_quantity": 60,  "lead_time_days": 5},
    {"id": "p04", "sku": "ELEC-004", "name": "Bluetooth Speaker Mini",       "category": "Electronics",   "unit_cost_cents": 3999,  "reorder_point": 25, "reorder_quantity": 50,  "lead_time_days": 7},
    {"id": "p05", "sku": "ELEC-005", "name": "USB-C Hub 7-in-1",             "category": "Electronics",   "unit_cost_cents": 5999,  "reorder_point": 15, "reorder_quantity": 40,  "lead_time_days": 7},
    {"id": "p06", "sku": "APRL-001", "name": "Classic Crewneck Hoodie",      "category": "Apparel",       "unit_cost_cents": 4500,  "reorder_point": 40, "reorder_quantity": 100, "lead_time_days": 14},
    {"id": "p07", "sku": "APRL-002", "name": "Performance Running Shorts",   "category": "Apparel",       "unit_cost_cents": 2800,  "reorder_point": 35, "reorder_quantity": 80,  "lead_time_days": 14},
    {"id": "p08", "sku": "APRL-003", "name": "Merino Wool Beanie",           "category": "Apparel",       "unit_cost_cents": 1800,  "reorder_point": 50, "reorder_quantity": 120, "lead_time_days": 10},
    {"id": "p09", "sku": "APRL-004", "name": "Waterproof Trail Jacket",      "category": "Apparel",       "unit_cost_cents": 8900,  "reorder_point": 15, "reorder_quantity": 40,  "lead_time_days": 21},
    {"id": "p10", "sku": "APRL-005", "name": "Yoga Pants High-Waist",        "category": "Apparel",       "unit_cost_cents": 3500,  "reorder_point": 30, "reorder_quantity": 80,  "lead_time_days": 14},
    {"id": "p11", "sku": "HOME-001", "name": 'Cast Iron Skillet 12"',        "category": "Home & Garden", "unit_cost_cents": 4200,  "reorder_point": 20, "reorder_quantity": 40,  "lead_time_days": 7},
    {"id": "p12", "sku": "HOME-002", "name": "Bamboo Cutting Board Set",     "category": "Home & Garden", "unit_cost_cents": 2200,  "reorder_point": 25, "reorder_quantity": 60,  "lead_time_days": 7},
    {"id": "p13", "sku": "HOME-003", "name": "Stainless Steel Water Bottle", "category": "Home & Garden", "unit_cost_cents": 1900,  "reorder_point": 40, "reorder_quantity": 100, "lead_time_days": 5},
    {"id": "p14", "sku": "HOME-004", "name": "Soy Wax Candle Set",           "category": "Home & Garden", "unit_cost_cents": 2800,  "reorder_point": 30, "reorder_quantity": 75,  "lead_time_days": 7},
    {"id": "p15", "sku": "HOME-005", "name": "Herb Garden Starter Kit",      "category": "Home & Garden", "unit_cost_cents": 3400,  "reorder_point": 20, "reorder_quantity": 50,  "lead_time_days": 10},
    {"id": "p16", "sku": "SPRT-001", "name": "Resistance Band Set (5pc)",    "category": "Sports",        "unit_cost_cents": 2400,  "reorder_point": 30, "reorder_quantity": 80,  "lead_time_days": 5},
    {"id": "p17", "sku": "SPRT-002", "name": "Foam Roller Pro",              "category": "Sports",        "unit_cost_cents": 2900,  "reorder_point": 20, "reorder_quantity": 50,  "lead_time_days": 7},
    {"id": "p18", "sku": "SPRT-003", "name": "Jump Rope Speed Cable",        "category": "Sports",        "unit_cost_cents": 1500,  "reorder_point": 40, "reorder_quantity": 100, "lead_time_days": 5},
    {"id": "p19", "sku": "SPRT-004", "name": "Yoga Mat Premium 6mm",         "category": "Sports",        "unit_cost_cents": 4800,  "reorder_point": 20, "reorder_quantity": 50,  "lead_time_days": 10},
    {"id": "p20", "sku": "SPRT-005", "name": "Adjustable Dumbbell Pair",     "category": "Sports",        "unit_cost_cents": 12900, "reorder_point": 8,  "reorder_quantity": 20,  "lead_time_days": 14},
    {"id": "p21", "sku": "GROC-001", "name": "Cold Brew Coffee Concentrate", "category": "Grocery",       "unit_cost_cents": 1200,  "reorder_point": 60, "reorder_quantity": 150, "lead_time_days": 3},
    {"id": "p22", "sku": "GROC-002", "name": "Organic Protein Powder 2lb",  "category": "Grocery",       "unit_cost_cents": 4500,  "reorder_point": 30, "reorder_quantity": 80,  "lead_time_days": 5},
    {"id": "p23", "sku": "GROC-003", "name": "Raw Honey 16oz",               "category": "Grocery",       "unit_cost_cents": 1800,  "reorder_point": 40, "reorder_quantity": 100, "lead_time_days": 3},
    {"id": "p24", "sku": "GROC-004", "name": "Mixed Nut Trail Mix 1lb",      "category": "Grocery",       "unit_cost_cents": 1100,  "reorder_point": 50, "reorder_quantity": 120, "lead_time_days": 3},
    {"id": "p25", "sku": "GROC-005", "name": "Matcha Green Tea Powder",      "category": "Grocery",       "unit_cost_cents": 2200,  "reorder_point": 35, "reorder_quantity": 90,  "lead_time_days": 5},
]

BASE_DAILY_SALES = {
    "s1": {"p01":3.2,"p02":1.1,"p03":4.5,"p04":2.8,"p05":2.1,"p06":5.2,"p07":4.1,"p08":6.3,"p09":1.8,"p10":3.9,"p11":2.4,"p12":3.1,"p13":5.8,"p14":3.5,"p15":2.2,"p16":4.2,"p17":2.9,"p18":5.1,"p19":2.7,"p20":0.9,"p21":8.2,"p22":3.5,"p23":4.8,"p24":6.1,"p25":3.3},
    "s2": {"p01":2.5,"p02":0.9,"p03":3.8,"p04":2.3,"p05":1.7,"p06":3.1,"p07":5.2,"p08":2.8,"p09":0.8,"p10":4.5,"p11":1.9,"p12":2.7,"p13":4.9,"p14":2.8,"p15":2.9,"p16":5.1,"p17":3.2,"p18":6.2,"p19":3.4,"p20":1.1,"p21":7.1,"p22":4.2,"p23":3.9,"p24":5.3,"p25":2.8},
    "s3": {"p01":4.1,"p02":1.5,"p03":5.2,"p04":3.4,"p05":2.8,"p06":4.5,"p07":3.8,"p08":5.1,"p09":2.6,"p10":3.2,"p11":2.8,"p12":3.5,"p13":6.2,"p14":3.9,"p15":3.5,"p16":3.5,"p17":2.5,"p18":4.3,"p19":3.1,"p20":0.8,"p21":9.1,"p22":4.8,"p23":5.2,"p24":6.8,"p25":4.5},
    "s4": {"p01":2.9,"p02":1.2,"p03":4.1,"p04":2.5,"p05":1.9,"p06":4.8,"p07":2.9,"p08":7.2,"p09":2.1,"p10":2.9,"p11":2.1,"p12":2.9,"p13":5.1,"p14":3.1,"p15":1.8,"p16":3.1,"p17":2.2,"p18":4.1,"p19":2.4,"p20":0.7,"p21":7.5,"p22":3.1,"p23":4.1,"p24":5.5,"p25":2.9},
    "s5": {"p01":2.1,"p02":0.8,"p03":3.2,"p04":1.9,"p05":1.4,"p06":2.2,"p07":4.8,"p08":2.1,"p09":0.5,"p10":3.8,"p11":1.5,"p12":2.1,"p13":4.2,"p14":2.2,"p15":2.5,"p16":4.8,"p17":2.8,"p18":5.5,"p19":2.8,"p20":0.9,"p21":6.2,"p22":3.8,"p23":3.5,"p24":4.8,"p25":2.4},
}

# COMMAND ----------

# ── Helper functions ──────────────────────────────────────────────────────────

random.seed(42)

def gaussian_random(mean, std):
    u = max(1e-10, 1 - random.random())
    v = random.random()
    z = math.sqrt(-2.0 * math.log(u)) * math.cos(2.0 * math.pi * v)
    return max(0, round(mean + std * z))

def weekend_multiplier(d):
    return 1.4 if d.weekday() >= 5 else 1.0

def seasonal_multiplier(d, category):
    m = d.month - 1
    if category == "Apparel":
        return [0.9, 0.9, 1.1, 1.2, 1.1, 0.9, 0.9, 1.0, 1.1, 1.3, 1.2, 1.0][m]
    if category == "Sports":
        return [1.3, 1.2, 1.1, 1.0, 1.0, 1.2, 1.3, 1.2, 1.0, 0.9, 0.9, 1.0][m]
    if category == "Grocery":
        return [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.1, 1.1, 1.0, 1.0, 1.1, 1.2][m]
    return 1.0

now_ts = datetime.now(timezone.utc)
lsn_counter = [0]

def next_lsn():
    lsn_counter[0] += 1
    return lsn_counter[0]

def pg_meta(change_type="insert"):
    lsn = next_lsn()
    return {
        "_pg_change_type": change_type,
        "_pg_lsn": lsn,
        "_pg_xid": lsn,
        "_timestamp": now_ts,
        "_sort_by": lsn,
    }

# COMMAND ----------

# ── Stores ────────────────────────────────────────────────────────────────────

stores_rows = []
for s in STORES:
    row = {**s, "created_at": now_ts, **pg_meta()}
    stores_rows.append(row)

stores_df = spark.createDataFrame(stores_rows)
(
    stores_df.write
    .format("delta")
    .mode("overwrite")
    .option("overwriteSchema", "true")
    .saveAsTable(f"`{catalog}`.`{lakebase_schema}`.lb_stores_history")
)
print(f"Written {len(stores_rows)} stores to {catalog}.{lakebase_schema}.lb_stores_history")

# COMMAND ----------

# ── Products ──────────────────────────────────────────────────────────────────

products_rows = []
for p in PRODUCTS:
    row = {**p, "created_at": now_ts, **pg_meta()}
    products_rows.append(row)

products_df = spark.createDataFrame(products_rows)
(
    products_df.write
    .format("delta")
    .mode("overwrite")
    .option("overwriteSchema", "true")
    .saveAsTable(f"`{catalog}`.`{lakebase_schema}`.lb_products_history")
)
print(f"Written {len(products_rows)} products to {catalog}.{lakebase_schema}.lb_products_history")

# COMMAND ----------

# ── Stock levels ──────────────────────────────────────────────────────────────

stock_rows = []
random.seed(42)
for store in STORES:
    for product in PRODUCTS:
        base_sales = BASE_DAILY_SALES.get(store["id"], {}).get(product["id"], 1.0)
        avg_daily = round(base_sales)

        rand = random.random()
        if rand < 0.1:
            days_of_supply = random.randint(0, 4)
            on_order = 0
        elif rand < 0.25:
            days_of_supply = 5 + random.randint(0, 6)
            on_order = 0 if rand < 0.18 else product["reorder_quantity"]
        else:
            days_of_supply = 14 + random.randint(0, 29)
            on_order = 0

        on_hand = max(0, avg_daily * days_of_supply + random.randint(0, 4))
        stock_id = f"{store['id']}_{product['id']}"

        row = {
            "id": stock_id,
            "store_id": store["id"],
            "product_id": product["id"],
            "quantity_on_hand": on_hand,
            "quantity_on_order": on_order,
            "last_counted_at": now_ts,
            **pg_meta(),
        }
        stock_rows.append(row)

stock_df = spark.createDataFrame(stock_rows)
(
    stock_df.write
    .format("delta")
    .mode("overwrite")
    .option("overwriteSchema", "true")
    .saveAsTable(f"`{catalog}`.`{lakebase_schema}`.lb_stock_levels_history")
)
print(f"Written {len(stock_rows)} stock level rows to {catalog}.{lakebase_schema}.lb_stock_levels_history")

# COMMAND ----------

# ── Sales transactions (90 days of history) ───────────────────────────────────

product_map = {p["id"]: p for p in PRODUCTS}
sales_rows = []
random.seed(99)
start_date = date.today() - timedelta(days=90)

for store in STORES:
    for product in PRODUCTS:
        base_sales = BASE_DAILY_SALES.get(store["id"], {}).get(product["id"], 1.0)
        current = start_date

        while current < date.today():
            season_mult = seasonal_multiplier(current, product["category"])
            week_mult = weekend_multiplier(datetime.combine(current, datetime.min.time()))
            mean = base_sales * season_mult * week_mult
            units = gaussian_random(mean, mean * 0.3)

            if units > 0:
                hour = 8 + random.randint(0, 11)
                sale_ts = datetime.combine(current, datetime.min.time()).replace(
                    hour=hour, minute=random.randint(0, 59), tzinfo=timezone.utc
                )
                price = round(product["unit_cost_cents"] * (1.4 + random.random() * 0.3))
                sales_rows.append({
                    "store_id": store["id"],
                    "product_id": product["id"],
                    "quantity_sold": units,
                    "unit_price_cents": price,
                    "sold_at": sale_ts,
                    **pg_meta(),
                })

            current += timedelta(days=1)

sales_df = spark.createDataFrame(sales_rows)
(
    sales_df.write
    .format("delta")
    .mode("overwrite")
    .option("overwriteSchema", "true")
    .saveAsTable(f"`{catalog}`.`{lakebase_schema}`.lb_sales_transactions_history")
)
print(f"Written {len(sales_rows)} sales transactions to {catalog}.{lakebase_schema}.lb_sales_transactions_history")

# COMMAND ----------

print(f"""
Sample data generation complete!

Tables written to {catalog}.{lakebase_schema}:
  lb_stores_history              — {len(stores_rows)} stores
  lb_products_history            — {len(products_rows)} products
  lb_stock_levels_history        — {len(stock_rows)} store×product pairs
  lb_sales_transactions_history  — {len(sales_rows)} sales transactions

Next step: trigger the inventory_analytics DLT pipeline to build silver + gold tables.
""")
