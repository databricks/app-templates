import { Plugin, ServiceContext, defineManifest, toPlugin, type IAppRouter } from '@databricks/appkit';
import manifest from './manifest.json';
import { createDesignerRuntime } from './server/runtime';
import type { WorkspaceClient } from './server/workspaceClient';

class DesignerPlugin extends Plugin {
  static manifest = defineManifest<'designer'>(manifest);
  private runtime?: ReturnType<typeof createDesignerRuntime>;

  setup() {
    // Designer Jobs and files are App-owned. Forwarded identity is checked by
    // each route; it must not switch these operations to a viewer's credentials.
    this.runtime = createDesignerRuntime(ServiceContext.get().client as WorkspaceClient, this.telemetry);
    return Promise.resolve();
  }

  injectRoutes(router: IAppRouter) {
    this.runtime?.registerRoutes(router, (config) => this.route(router, config));
  }

  shutdown() {
    this.runtime?.close();
    this.runtime = undefined;
  }
}

/** Published Lakeflow Designer App runtime (beta). */
export const designer = toPlugin(DesignerPlugin);
