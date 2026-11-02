import type { createWorkspaceClient } from '@databricks/appkit';

// SDK 0.89's root WorkspaceClient alias is broken; the public factory retains its complete type.
export type WorkspaceClient = ReturnType<typeof createWorkspaceClient>;
