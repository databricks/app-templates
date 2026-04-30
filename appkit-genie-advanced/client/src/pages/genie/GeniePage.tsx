import { GenieChat } from '@databricks/appkit-ui/react';

export function GeniePage() {
  return (
    <div className="space-y-6 w-full max-w-4xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Genie</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Ask questions about your data using Databricks AI/BI Genie.
        </p>
      </div>
      <div className="h-[600px] border rounded-lg overflow-hidden">
        <GenieChat alias="default" />
      </div>
    </div>
  );
}
