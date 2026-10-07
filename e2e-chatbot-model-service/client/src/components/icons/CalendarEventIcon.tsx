import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CalendarEventIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CalendarEventIcon = forwardRef<SVGSVGElement, CalendarEventIconProps>(
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
      <path fill="currentColor" d="M8.5 10.25a1.75 1.75 0 1 1 3.5 0 1.75 1.75 0 0 1-3.5 0" />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M10 2H6V0H4.5v2H1.75a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h12.5a.75.75 0 0 0 .75-.75V2.75a.75.75 0 0 0-.75-.75H11.5V0H10zM2.5 3.5v2h11v-2zm0 10V7h11v6.5z"
              clipRule="evenodd"
            />
    </svg>
  )
);
CalendarEventIcon.displayName = "CalendarEventIcon";
