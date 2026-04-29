import { createBrowserRouter, RouterProvider, NavLink, Outlet } from 'react-router';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@databricks/appkit-ui/react';
import { GeniePage } from './pages/genie/GeniePage';
import { GenieAdvancedPage } from './pages/genie-advanced/GenieAdvancedPage';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
    isActive
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }`;

function Layout() {
  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <header className="border-b px-6 py-3 flex items-center gap-4 shrink-0">
        <h1 className="text-lg font-semibold text-foreground">appkit-genie-advanced</h1>
        <nav className="flex gap-1">
          <NavLink to="/" end className={navLinkClass}>
            Home
          </NavLink>
          <NavLink to="/genie" className={navLinkClass}>
            Genie (basic)
          </NavLink>
          <NavLink to="/genie-advanced" className={navLinkClass}>
            Genie Advanced
          </NavLink>
        </nav>
      </header>

      <main className="flex-1 min-h-0 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      {
        path: '/',
        element: (
          <div className="h-full overflow-y-auto">
            <HomePage />
          </div>
        ),
      },
      {
        path: '/genie',
        element: (
          <div className="h-full overflow-y-auto p-6">
            <GeniePage />
          </div>
        ),
      },
      { path: '/genie-advanced', element: <GenieAdvancedPage /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}

function HomePage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6 mt-8 p-6">
      <div className="text-center">
        <h2 className="text-3xl font-bold mb-2 text-foreground">
          appkit-genie-advanced
        </h2>
        <p className="text-lg text-muted-foreground">
          AppKit + extended Genie Conversation API
        </p>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>What this template demonstrates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Two pages compare the AppKit-bundled Genie surface against a richer one
            that calls additional Genie REST endpoints directly.
          </p>
          <ul className="space-y-2 text-sm">
            <li>
              <NavLink to="/genie" className="text-primary underline underline-offset-4 hover:text-primary/80">
                /genie — minimal: AppKit&apos;s &lt;GenieChat&gt; on a single space →
              </NavLink>
            </li>
            <li>
              <NavLink to="/genie-advanced" className="text-primary underline underline-offset-4 hover:text-primary/80">
                /genie-advanced — multi-space picker, conversation history, feedback, CSV export →
              </NavLink>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Custom plugin</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Genie Advanced features are powered by a custom AppKit plugin
            (<code className="text-xs">server/plugins/genie-advanced.ts</code>) that exposes:
          </p>
          <ul className="mt-2 space-y-1 text-xs font-mono text-muted-foreground">
            <li>GET /api/genieAdvanced/spaces</li>
            <li>GET /api/genieAdvanced/spaces/:alias/conversations</li>
            <li>
              GET
              /api/genieAdvanced/spaces/:alias/conversations/:cid/messages/:mid/attachments/:aid/result
            </li>
            <li>
              POST
              /api/genieAdvanced/spaces/:alias/conversations/:cid/messages/:mid/feedback
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
