import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Icon } from "./icons";

export function ServiceProblem({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <Alert>
      <Icon name="alert" />
      <AlertTitle className="line-clamp-none">{title}</AlertTitle>
      <AlertDescription>
        <p>We're having a technical problem. Try again in a few minutes.</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          <Icon name="refresh" className="size-4" />
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}
