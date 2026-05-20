
import pandas as pd
from statsmodels.tsa.holtwinters import ExponentialSmoothing
from models.base import ForecastModel


class ExponentialSmoothingModel(ForecastModel):
    """
    Holt-Winters exponential smoothing with optional trend and seasonality.

    Handles trend and weekly seasonality better than a simple moving average.
    Uses statsmodels (pre-installed on Databricks runtimes).
    """

    def __init__(self, seasonal_periods: int = 7):
        self.seasonal_periods = seasonal_periods

    def fit_predict(self, history: pd.DataFrame) -> pd.DataFrame:
        results = []

        for (store_id, product_id), group in history.groupby(["store_id", "product_id"]):
            group = group.sort_values("sale_date").copy()
            group["sale_date"] = pd.to_datetime(group["sale_date"])
            group = group.set_index("sale_date")
            days_of_history = len(group)

            daily = group["units_sold"].resample("D").sum().fillna(0)

            try:
                if days_of_history >= 2 * self.seasonal_periods:
                    model = ExponentialSmoothing(
                        daily,
                        trend="add",
                        seasonal="add",
                        seasonal_periods=self.seasonal_periods,
                        damped_trend=True,
                    )
                    fit = model.fit(optimized=True, disp=False)
                    forecast = fit.forecast(30)
                    forecast_30d = max(0.0, round(float(forecast.sum()), 1))
                else:
                    # Fall back to simple average when not enough data for seasonal model
                    avg_daily = daily.mean()
                    forecast_30d = round(avg_daily * 30, 1)
            except Exception as e:
                print(f"[exp_smoothing] fit failed for {store_id}/{product_id}: {e} — falling back to average")
                avg_daily = daily.mean()
                forecast_30d = round(avg_daily * 30, 1)

            results.append({
                "store_id": store_id,
                "product_id": product_id,
                "forecast_30d_units": forecast_30d,
                "confidence": self.data_confidence(days_of_history),
            })

        return pd.DataFrame(results)
