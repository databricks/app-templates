import { Card, CardContent, CardHeader, CardTitle } from '@databricks/appkit-ui/react';
import { RevenueByDestination } from './components/RevenueByDestination';
import { RevenueChart } from './components/RevenueChart';
import { BookingManager } from './components/BookingManager';
import { WanderbricksChat } from './components/WanderbricksChat';

export default function App() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-3">
        <h1 className="text-lg font-semibold text-foreground">vacation-rentals</h1>
        <p className="text-sm text-muted-foreground">Vacation rental marketplace operations console</p>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle>Revenue by destination</CardTitle>
            </CardHeader>
            <CardContent>
              <RevenueByDestination />
            </CardContent>
          </Card>

          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle>Revenue chart</CardTitle>
            </CardHeader>
            <CardContent>
              <RevenueChart />
            </CardContent>
          </Card>

          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle>Booking manager</CardTitle>
            </CardHeader>
            <CardContent>
              <BookingManager />
            </CardContent>
          </Card>

          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle>Ask Wanderbricks</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[500px] border rounded-lg overflow-hidden">
                <WanderbricksChat />
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
