import { BarChart } from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';

export function RevenueChart() {
  return (
    <BarChart
      queryKey="revenue_by_destination"
      parameters={{ limit: sql.number(10) }}
      xKey="destination"
      yKey="total_revenue"
    />
  );
}
