import {
  createBrowserRouter,
  RouterProvider,
  NavLink,
  Outlet,
} from "react-router";
import { SubmissionsPage } from "./pages/SubmissionsPage";
import { SubmitContentPage } from "./pages/SubmitContentPage";
import { SubmissionDetailPage } from "./pages/SubmissionDetailPage";
import { GuidelinesPage } from "./pages/GuidelinesPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
    isActive
      ? "bg-foreground/10 text-foreground"
      : "text-muted-foreground hover:text-foreground"
  }`;

function Layout() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border/50 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            Content Moderator
          </h1>
          <nav className="flex gap-1">
            <NavLink to="/" end className={navLinkClass}>
              Review Queue
            </NavLink>
            <NavLink to="/submit" className={navLinkClass}>
              Submit
            </NavLink>
            <NavLink to="/guidelines" className={navLinkClass}>
              Guidelines
            </NavLink>
            <NavLink to="/analytics" className={navLinkClass}>
              Analytics
            </NavLink>
          </nav>
        </div>
        <span className="text-xs text-muted-foreground uppercase tracking-widest">
          Content Ops
        </span>
      </header>

      <main className="flex-1 flex flex-col min-h-0">
        <Outlet />
      </main>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <SubmissionsPage /> },
      { path: "/submit", element: <SubmitContentPage /> },
      { path: "/submissions/:id", element: <SubmissionDetailPage /> },
      { path: "/guidelines", element: <GuidelinesPage /> },
      { path: "/analytics", element: <AnalyticsPage /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
