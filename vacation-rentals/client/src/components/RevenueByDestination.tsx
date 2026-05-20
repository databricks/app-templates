import { useAnalyticsQuery, Skeleton } from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';

interface Row {
  destination: string;
  country: string;
  total_bookings: number;
  total_revenue: number;
  avg_rating: number | null;
}

export function RevenueByDestination() {
  const { data, loading, error } = useAnalyticsQuery('revenue_by_destination', {
    limit: sql.number(10),
  });

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }
  if (error) {
    return <div className="text-destructive bg-destructive/10 p-3 rounded-md">Error: {error}</div>;
  }
  const rows = (Array.isArray(data) ? data : []) as Row[];
  if (rows.length === 0) {
    return <div className="text-muted-foreground">No revenue data</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground border-b">
          <tr>
            <th className="py-2 pr-4">Destination</th>
            <th className="py-2 pr-4">Country</th>
            <th className="py-2 pr-4 text-right">Bookings</th>
            <th className="py-2 pr-4 text-right">Revenue</th>
            <th className="py-2 text-right">Rating</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.destination}-${row.country}`} className="border-b last:border-b-0">
              <td className="py-2 pr-4 font-medium">{row.destination}</td>
              <td className="py-2 pr-4 text-muted-foreground">{row.country}</td>
              <td className="py-2 pr-4 text-right">{row.total_bookings}</td>
              <td className="py-2 pr-4 text-right">${Number(row.total_revenue).toLocaleString()}</td>
              <td className="py-2 text-right">{row.avg_rating ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
