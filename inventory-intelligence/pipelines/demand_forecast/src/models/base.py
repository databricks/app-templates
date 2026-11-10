
from abc import ABC, abstractmethod
import pandas as pd


class ForecastModel(ABC):
    """
    Base class for demand forecasting models.

    Implement fit_predict to receive daily sales history and return
    a 30-day unit forecast with confidence level per (store_id, product_id) pair.
    """

    @abstractmethod
    def fit_predict(self, history: pd.DataFrame) -> pd.DataFrame:
        """
        Args:
            history: DataFrame with columns:
                - store_id (str)
                - product_id (str)
                - sale_date (date)
                - units_sold (int)
                - reorder_point (int)
                - lead_time_days (int)
                - quantity_on_hand (int)
                - quantity_on_order (int)

        Returns:
            DataFrame with columns:
                - store_id (str)
                - product_id (str)
                - forecast_30d_units (float)  — predicted units sold in next 30 days
                - confidence (str)            — "high" | "medium" | "low"
        """
        ...

    @staticmethod
    def data_confidence(days_of_history: int) -> str:
        if days_of_history >= 60:
            return "high"
        if days_of_history >= 30:
            return "medium"
        return "low"
