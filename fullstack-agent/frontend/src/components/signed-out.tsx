import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BrandMark, PRODUCT_NAME, SUPPORT_NAME } from "../config/brand";

// Shown on 401; reloading triggers sign-in via Apps proxy. `reference` is an error code.
export function SignedOut({ reference }: { reference: string }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-6" id="main">
      <Card className="w-full max-w-110 gap-0 px-8 py-9 max-md:px-6">
        <div className="mb-8 flex items-center gap-2.5 text-[17px] font-semibold tracking-tight">
          <BrandMark />
          <span>{PRODUCT_NAME}</span>
        </div>
        <h1 className="text-2xl font-semibold" tabIndex={-1}>
          You've been signed out
        </h1>
        <p className="text-muted-foreground mt-2.5">We couldn't verify your sign-in, so we signed you out to protect your account.</p>
        <Button className="mt-6 w-full" size="lg" onClick={() => window.location.reload()}>
          Sign in again
        </Button>
        <p className="text-muted-foreground mt-5 text-sm wrap-anywhere">
          If this happens again, contact {SUPPORT_NAME} and quote error code{" "}
          <strong className="text-foreground font-semibold">{reference}</strong>.
        </p>
      </Card>
    </main>
  );
}
