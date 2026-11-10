import {
  GenieChat,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@databricks/appkit-ui/react";

export function AnalyticsPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-6 pb-3 border-b border-border/50">
        <h2 className="text-xl font-bold tracking-tight">Analytics</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Ask questions about inventory, stock levels, and demand in natural
          language.
        </p>
      </div>

      <div className="flex-1 min-h-0 p-6">
        <Card className="flex flex-col h-full overflow-hidden">
          <CardHeader className="shrink-0 pb-2">
            <CardTitle className="text-sm">Ask about your inventory</CardTitle>
            <p className="text-xs text-muted-foreground">
              e.g. "Which stores have the most critical stock alerts?" or "What
              is the total inventory value by category?"
            </p>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden p-0">
            <GenieChat
              alias="default"
              placeholder="Ask a question about inventory, sales, or replenishment..."
              className="h-full"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
