"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { CheckIcon, Loader2Icon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { field, ghostButton, inkButton, mono, paper } from "./surfaces";
import { useReceiptFocus } from "./receipt-focus";

export type ApprovalState = "request" | "running" | "done" | "denied";

const RECEIPT_ICON: Record<Exclude<ApprovalState, "request">, ReactNode> = {
  running: <Loader2Icon className="text-muted-foreground size-3.5 animate-spin motion-reduce:animate-none" />,
  denied: <XIcon className="text-muted-foreground size-3.5" />,
  done: <CheckIcon className="size-3.5 text-emerald-600" />,
};

const BUTTON = "flex h-11 items-center justify-center rounded-full px-4 text-sm font-medium whitespace-nowrap max-md:flex-1";

/**
 * A proposed action and its decision. Button takes focus first so the receipt
 * that replaces it gets focus on every browser, including WebKit on tap.
 */
export function ApprovalCard({
  state,
  title,
  subtitle,
  description,
  details,
  icon,
  onAllowOnce,
  onDeny,
  allowOnceLabel,
  denyLabel,
  statusLabel,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "title"> & {
  state: ApprovalState;
  title: string;
  subtitle: string;
  description: string;
  details: readonly { label: string; value: ReactNode }[];
  icon: ReactNode;
  onAllowOnce: () => void;
  onDeny: () => void;
  allowOnceLabel: string;
  denyLabel: string;
  statusLabel: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const { receiptRef, focusHandlers } = useReceiptFocus<HTMLDivElement>(props);

  return (
    <div
      {...props}
      {...focusHandlers}
      role="group"
      data-slot="approval-card"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={cn(paper, "flex w-full max-w-sm flex-col gap-3.5 rounded-[20px] p-4", className)}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="bg-foreground/[0.05] text-foreground flex size-9 shrink-0 items-center justify-center rounded-xl"
        >
          {icon}
        </span>
        <div className="flex min-w-0 flex-col">
          <h2 id={titleId} className="text-[13.5px] font-medium">
            {title}
          </h2>
          <p data-slot="approval-card-subtitle" className="text-muted-foreground text-xs">
            {subtitle}
          </p>
        </div>
      </div>

      <p id={descriptionId} className="text-foreground/80 text-[13px]">
        {description}
      </p>

      {details.length ? (
        <dl className={cn(field, "flex flex-col gap-2 rounded-xl px-3.5 py-2.5")}>
          {details.map((detail, index) => (
            <div
              key={`${detail.label}-${index}`}
              data-slot="approval-card-detail"
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4 text-xs"
            >
              <dt className={cn(mono, "text-foreground")}>{detail.label}</dt>
              <dd className="text-foreground wrap-anywhere">{detail.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="flex min-h-8 flex-wrap items-center justify-end gap-2">
        {state === "request" ? (
          <>
            <button
              type="button"
              data-slot="approval-card-deny"
              onClick={(event) => {
                event.currentTarget.focus();
                onDeny();
              }}
              className={cn(ghostButton, BUTTON, "text-foreground")}
            >
              {denyLabel}
            </button>
            <button type="button" data-slot="approval-card-allow-once" onClick={(event) => {
                event.currentTarget.focus();
                onAllowOnce();
              }} className={cn(inkButton, BUTTON)}>
              {allowOnceLabel}
            </button>
          </>
        ) : (
          <div
            key={state}
            ref={receiptRef}
            tabIndex={-1}
            data-slot="approval-card-receipt"
            className="fade-in animate-in text-foreground me-auto flex items-center gap-2 text-xs wrap-anywhere duration-300 outline-none motion-reduce:animate-none"
          >
            <span className="shrink-0">{RECEIPT_ICON[state]}</span>
            {statusLabel}
          </div>
        )}
      </div>
    </div>
  );
}
