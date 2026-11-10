import { useState, useEffect, createContext, useContext } from "react";
import {
  createBrowserRouter,
  RouterProvider,
  NavLink,
  Outlet,
} from "react-router";
import { DashboardPage } from "./pages/DashboardPage";
import { StoreViewPage } from "./pages/StoreViewPage";
import { ReplenishmentQueuePage } from "./pages/ReplenishmentQueuePage";
import { AnalyticsPage } from "./pages/AnalyticsPage";

const GenieContext = createContext(false);

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
    isActive
      ? "bg-foreground/10 text-foreground"
      : "text-muted-foreground hover:text-foreground"
  }`;

function Layout() {
  const genieEnabled = useContext(GenieContext);
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border/50 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            Inventory Intelligence
          </h1>
          <nav className="flex gap-1">
            <NavLink to="/" end className={navLinkClass}>
              Dashboard
            </NavLink>
            <NavLink to="/replenishment" className={navLinkClass}>
              Replenishment
            </NavLink>
            {genieEnabled && (
              <NavLink to="/analytics" className={navLinkClass}>
                Analytics
              </NavLink>
            )}
          </nav>
        </div>
        <span className="text-xs text-muted-foreground uppercase tracking-widest">
          Demand Forecasting
        </span>
      </header>

      <main className="flex-1 flex flex-col min-h-0">
        <Outlet />
      </main>
    </div>
  );
}

// Created once — all routes always present so React Router never 404s on
// /analytics regardless of when the /api/config fetch resolves.
const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <DashboardPage /> },
      { path: "/stores/:storeId", element: <StoreViewPage /> },
      { path: "/replenishment", element: <ReplenishmentQueuePage /> },
      { path: "/analytics", element: <AnalyticsPage /> },
    ],
  },
]);

export default function App() {
  const [genieEnabled, setGenieEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg: { genieEnabled: boolean }) =>
        setGenieEnabled(cfg.genieEnabled),
      )
      .catch(() => {});
  }, []);

  return (
    <GenieContext value={genieEnabled}>
      <RouterProvider router={router} />
    </GenieContext>
  );
}
