
import pandas as pd
import numpy as np
from models.base import ForecastModel


class WeightedMovingAverageModel(ForecastModel):
    """
    Weighted moving average over trailing weeks.

    More recent weeks receive higher weight. No external dependencies required.
    Works well as a baseline for products with stable demand patterns.
    """

    def __init__(self, weeks: int = 4):
        self.weeks = weeks

    def fit_predict(self, history: pd.DataFrame) -> pd.DataFrame:
        results = []

        for (store_id, product_id), group in history.groupby(["store_id", "product_id"]):
            group = group.sort_values("sale_date")
            days_of_history = len(group["sale_date"].unique())

            # Assign each day to a week bucket (most recent = highest weight)
            group = group.copy()
            max_date = group["sale_date"].max()
            group["days_ago"] = group["sale_date"].apply(lambda d: (max_date - d).days)
            group["week_bucket"] = (group["days_ago"] // 7).clip(upper=self.weeks - 1)

            # Weights: week 0 (most recent) has weight=weeks, older weeks decrease
            weekly_sales = group.groupby("week_bucket")["units_sold"].sum()
            weights = np.array([self.weeks - i for i in range(self.weeks)])

            weighted_sum = 0.0
            weight_total = 0.0
            for bucket in range(self.weeks):
                if bucket in weekly_sales.index:
                    w = weights[bucket]
                    weighted_sum += weekly_sales[bucket] * w
                    weight_total += w * 7  # normalize per day

            avg_daily = weighted_sum / weight_total if weight_total > 0 else 0.0
            forecast_30d = round(avg_daily * 30, 1)

            results.append({
                "store_id": store_id,
                "product_id": product_id,
                "forecast_30d_units": forecast_30d,
                "confidence": self.data_confidence(days_of_history),
            })

        return pd.DataFrame(results)
