import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CalendarSyncIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CalendarSyncIcon = forwardRef<SVGSVGElement, CalendarSyncIconProps>(
  ({ size = 16, className, ariaLabel, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden={!ariaLabel}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      {...props}
    >
      <path
              fill="currentColor"
              d="M11.5 13.75h-.926a2.251 2.251 0 0 0 3.855-.937l1.453.373A3.75 3.75 0 0 1 12.25 16a3.74 3.74 0 0 1-2.75-1.203v.953H8v-3.5h3.5z"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M6 2h4V0h1.5v2h2.75a.75.75 0 0 1 .75.75V7H2.5v6.5h4V15H1.75a.75.75 0 0 1-.75-.75V2.75A.75.75 0 0 1 1.75 2H4.5V0H6zM2.5 5.5h11v-2h-11z"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              d="M11.75 8c1.087 0 2.066.464 2.75 1.202V8.25H16v3.5h-3.5v-1.5h.926a2.251 2.251 0 0 0-3.855.937l-1.453-.373A3.75 3.75 0 0 1 11.75 8"
            />
    </svg>
  )
);
CalendarSyncIcon.displayName = "CalendarSyncIcon";
