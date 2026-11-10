
import pandas as pd
import mlflow.deployments
from models.base import ForecastModel


class ModelServingModel(ForecastModel):
    """
    Calls a registered Databricks Model Serving endpoint for forecasting.

    Use this to plug in any MLflow model you've trained and deployed — scikit-learn,
    XGBoost, LightGBM, PyTorch, or custom pyfunc. The endpoint receives a JSON payload
    of the sales history and must return forecast_30d_units and confidence per row.

    Expected endpoint input format (dataframe_records orientation):
        [
          {
            "store_id": "s1",
            "product_id": "p01",
            "units_7d": 25,
            "units_30d": 98,
            "units_60d": 191,
            "units_90d": 284,
            "avg_daily_30d": 3.27,
            "quantity_on_hand": 45,
            "reorder_point": 20
          },
          ...
        ]

    Expected endpoint output:
        {
          "predictions": [
            {"store_id": "s1", "product_id": "p01", "forecast_30d_units": 102.5, "confidence": "high"},
            ...
          ]
        }
    """

    def __init__(self, endpoint: str):
        if not endpoint:
            raise ValueError(
                "model_serving_endpoint must be set when using the model_serving forecasting model. "
                "Pass --var model_serving_endpoint=<your-endpoint-name> when deploying."
            )
        self.endpoint = endpoint
        self.client = mlflow.deployments.get_deploy_client("databricks")

    def fit_predict(self, history: pd.DataFrame) -> pd.DataFrame:
        # Aggregate history into features per (store_id, product_id)
        features = (
            history.groupby(["store_id", "product_id", "reorder_point", "quantity_on_hand"])
            .apply(self._compute_features)
            .reset_index(drop=True)
        )

        payload = features.to_dict(orient="records")

        response = self.client.predict(
            endpoint=self.endpoint,
            inputs={"dataframe_records": payload},
        )

        predictions = response.get("predictions", [])
        result_df = pd.DataFrame(predictions)

        if "forecast_30d_units" not in result_df.columns or "confidence" not in result_df.columns:
            raise ValueError(
                f"Model Serving endpoint '{self.endpoint}' must return 'forecast_30d_units' and 'confidence' fields. "
                f"Got columns: {list(result_df.columns)}"
            )

        return result_df[["store_id", "product_id", "forecast_30d_units", "confidence"]]

    @staticmethod
    def _compute_features(group: pd.DataFrame) -> pd.Series:
        store_id = group["store_id"].iloc[0]
        product_id = group["product_id"].iloc[0]
        reorder_point = group["reorder_point"].iloc[0]
        quantity_on_hand = group["quantity_on_hand"].iloc[0]

        group = group.sort_values("sale_date")
        max_date = group["sale_date"].max()

        def units_last_n(n: int) -> float:
            cutoff = max_date - pd.Timedelta(days=n)
            return float(group[group["sale_date"] >= cutoff]["units_sold"].sum())

        return pd.Series({
            "store_id": store_id,
            "product_id": product_id,
            "units_7d": units_last_n(7),
            "units_30d": units_last_n(30),
            "units_60d": units_last_n(60),
            "units_90d": units_last_n(90),
            "avg_daily_30d": round(units_last_n(30) / 30.0, 4),
            "quantity_on_hand": int(quantity_on_hand),
            "reorder_point": int(reorder_point),
        })
