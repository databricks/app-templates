import type { ReactNode } from "react";

type PageSectionProps = {
  titleId: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
};

// Page section with heading that receives focus on navigation, then content.
export function PageSection({ titleId, title, description, action, children }: PageSectionProps) {
  return (
    <section className="mx-auto flex max-w-290 flex-col gap-6 px-8 pt-8 pb-18 max-md:gap-4.5 max-md:px-4 max-md:pt-5 max-md:pb-10" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 id={titleId} className="text-[28px] leading-tight font-semibold tracking-tight max-md:text-2xl" tabIndex={-1}>
            {title}
          </h1>
          {description ? <p className="text-muted-foreground mt-1.5 max-w-[64ch]">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// Pill group of links/toggle buttons with active state highlighted.
export const SEGMENTED =
  "bg-card inline-flex gap-0.5 self-start rounded-full border p-[3px] max-md:flex max-md:self-stretch [&>*]:text-muted-foreground [&>*]:hover:text-foreground [&>*]:rounded-full [&>*]:px-3.5 [&>*]:py-1.5 [&>*]:text-sm [&>*]:font-medium [&>*]:whitespace-nowrap max-md:[&>*]:flex-1 max-md:[&>*]:px-2.5 max-md:[&>*]:text-center max-md:[&>*]:whitespace-normal [&>[aria-current=page]]:bg-primary [&>[aria-current=page]]:text-primary-foreground [&>[aria-pressed=true]]:bg-primary [&>[aria-pressed=true]]:text-primary-foreground [&>[aria-current=page]]:hover:text-primary-foreground [&>[aria-pressed=true]]:hover:text-primary-foreground";

export function EmptyPanel({ children }: { children: ReactNode }) {
  return <p className="bg-card text-muted-foreground rounded-xl border p-5">{children}</p>;
}
