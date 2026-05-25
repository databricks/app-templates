# Databricks notebook source

# COMMAND ----------

import sys
import importlib
from datetime import datetime

from pyspark.sql.types import (
    StructType,
    StructField,
    StringType,
    DoubleType,
    IntegerType,
    TimestampType,
)
from delta.tables import DeltaTable

# COMMAND ----------

catalog = dbutils.widgets.get("catalog")
forecast_model = dbutils.widgets.get("forecast_model")
model_serving_endpoint = dbutils.widgets.get("model_serving_endpoint")

print(f"Catalog: {catalog}")
print(f"Forecast model: {forecast_model}")

# COMMAND ----------

# Load sales history + current stock levels for all (store, product) pairs
history_df = spark.sql(f"""
    SELECT
        ds.store_id,
        ds.product_id,
        ds.sale_date,
        ds.units_sold,
        COALESCE(p.reorder_point, 0) AS reorder_point,
        COALESCE(p.lead_time_days, 7) AS lead_time_days,
        COALESCE(sl.quantity_on_hand, 0) AS quantity_on_hand,
        COALESCE(sl.quantity_on_order, 0) AS quantity_on_order
    FROM `{catalog}`.silver.daily_sales ds
    JOIN `{catalog}`.silver.products p ON ds.product_id = p.id
    LEFT JOIN `{catalog}`.silver.stock_levels sl
        ON ds.store_id = sl.store_id AND ds.product_id = sl.product_id
    WHERE ds.sale_date >= DATE_SUB(CURRENT_DATE(), 90)
""")

history_pd = history_df.toPandas()
history_pd["sale_date"] = history_pd["sale_date"].apply(
    lambda d: d if hasattr(d, "year") else datetime.strptime(str(d), "%Y-%m-%d").date()
)

print(f"Loaded {len(history_pd)} daily sales rows covering {history_pd['store_id'].nunique()} stores and {history_pd['product_id'].nunique()} products")

# COMMAND ----------

# Add the src directory to sys.path so model modules can import each other
sys.path.insert(0, "/Workspace" + dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get().rsplit("/", 1)[0])

MODEL_REGISTRY = {
    "weighted_moving_average": lambda: _load("models.weighted_moving_average", "WeightedMovingAverageModel")(),
    "exponential_smoothing":   lambda: _load("models.exponential_smoothing", "ExponentialSmoothingModel")(),
    "prophet":                 lambda: _load("models.prophet_model", "ProphetModel")(),
    "model_serving":           lambda: _load("models.model_serving", "ModelServingModel")(model_serving_endpoint),
}


def _load(module_path: str, class_name: str):
    module = importlib.import_module(module_path)
    return getattr(module, class_name)


if forecast_model not in MODEL_REGISTRY:
    raise ValueError(
        f"Unknown forecast_model: '{forecast_model}'. "
        f"Choose from: {list(MODEL_REGISTRY.keys())}"
    )

model = MODEL_REGISTRY[forecast_model]()
print(f"Running {type(model).__name__}...")

# COMMAND ----------

forecasts_pd = model.fit_predict(history_pd)

print(f"Generated {len(forecasts_pd)} forecasts")
print(forecasts_pd.head())

# COMMAND ----------

# Compute replenishment recommendations on top of forecasts
stock_snapshot = history_pd[["store_id", "product_id", "quantity_on_hand", "quantity_on_order", "reorder_point", "lead_time_days"]].drop_duplicates(subset=["store_id", "product_id"])

# Merge in reorder_quantity (not in base history — fetch it)
rq_df = spark.sql(f"""
    SELECT id AS product_id, reorder_quantity
    FROM `{catalog}`.silver.products
""").toPandas()

recommendations_pd = forecasts_pd.merge(stock_snapshot, on=["store_id", "product_id"], how="left")
recommendations_pd = recommendations_pd.merge(rq_df, on="product_id", how="left")

# recommended_order_qty: enough to cover forecast + buffer, minus what's already on hand or on order
recommendations_pd["recommended_order_qty"] = (
    recommendations_pd["forecast_30d_units"]
    + recommendations_pd["reorder_quantity"].fillna(0)
    - recommendations_pd["quantity_on_hand"].fillna(0)
    - recommendations_pd["quantity_on_order"].fillna(0)
).clip(lower=0).round(0).astype(int)

recommendations_pd["model_used"] = forecast_model
recommendations_pd["generated_at"] = datetime.utcnow()

# COMMAND ----------

schema = StructType([
    StructField("store_id", StringType(), False),
    StructField("product_id", StringType(), False),
    StructField("forecast_30d_units", DoubleType(), False),
    StructField("confidence", StringType(), False),
    StructField("recommended_order_qty", IntegerType(), False),
    StructField("model_used", StringType(), False),
    StructField("generated_at", TimestampType(), False),
])

output_cols = ["store_id", "product_id", "forecast_30d_units", "confidence", "recommended_order_qty", "model_used", "generated_at"]
output_df = spark.createDataFrame(recommendations_pd[output_cols], schema=schema)

table_name = f"`{catalog}`.gold.replenishment_recommendations"

# Create table if it doesn't exist, then merge
spark.sql(f"""
    CREATE TABLE IF NOT EXISTS {table_name} (
        store_id STRING NOT NULL,
        product_id STRING NOT NULL,
        forecast_30d_units DOUBLE,
        confidence STRING,
        recommended_order_qty INT,
        model_used STRING,
        generated_at TIMESTAMP
    )
    USING DELTA
    TBLPROPERTIES ('delta.feature.timestampNtz' = 'supported')
""")

target = DeltaTable.forName(spark, f"{catalog}.gold.replenishment_recommendations")
(
    target.alias("t")
    .merge(output_df.alias("s"), "t.store_id = s.store_id AND t.product_id = s.product_id")
    .whenMatchedUpdateAll()
    .whenNotMatchedInsertAll()
    .execute()
)

print(f"Merged {output_df.count()} recommendations into {table_name}")

# COMMAND ----------

print("\nSummary:")
summary = spark.sql(f"""
    SELECT
        confidence,
        COUNT(*) AS count,
        ROUND(AVG(forecast_30d_units), 1) AS avg_forecast_30d,
        ROUND(AVG(recommended_order_qty), 0) AS avg_recommended_qty
    FROM {table_name}
    GROUP BY confidence
    ORDER BY confidence
""")
summary.show()
