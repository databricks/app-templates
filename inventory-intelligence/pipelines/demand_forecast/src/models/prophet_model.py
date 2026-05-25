
import pandas as pd
from prophet import Prophet
from models.base import ForecastModel


class ProphetModel(ForecastModel):
    """
    Meta Prophet forecasting model.

    Handles missing data, holidays, and multiple seasonality components automatically.
    Best for products with strong weekly or yearly patterns.

    Requires: pip install prophet (add to job cluster libraries in databricks.yml)
    """

    def __init__(self, yearly_seasonality: bool = False, weekly_seasonality: bool = True):
        self.yearly_seasonality = yearly_seasonality
        self.weekly_seasonality = weekly_seasonality

    def fit_predict(self, history: pd.DataFrame) -> pd.DataFrame:
        results = []

        for (store_id, product_id), group in history.groupby(["store_id", "product_id"]):
            days_of_history = group["sale_date"].nunique()

            prophet_df = (
                group
                .groupby("sale_date")["units_sold"]
                .sum()
                .reset_index()
                .rename(columns={"sale_date": "ds", "units_sold": "y"})
            )

            try:
                model = Prophet(
                    yearly_seasonality=self.yearly_seasonality,
                    weekly_seasonality=self.weekly_seasonality,
                    daily_seasonality=False,
                    interval_width=0.80,
                    # Suppress Stan output
                    stan_backend="CMDSTANPY",
                )
                model.fit(prophet_df)

                future = model.make_future_dataframe(periods=30)
                forecast = model.predict(future)
                next_30 = forecast.tail(30)["yhat"].clip(lower=0).sum()
                forecast_30d = round(float(next_30), 1)
            except Exception as e:
                print(f"[prophet] fit failed for {store_id}/{product_id}: {e} — falling back to average")
                avg_daily = prophet_df["y"].mean()
                forecast_30d = round(avg_daily * 30, 1)

            results.append({
                "store_id": store_id,
                "product_id": product_id,
                "forecast_30d_units": forecast_30d,
                "confidence": self.data_confidence(days_of_history),
            })

        return pd.DataFrame(results)
