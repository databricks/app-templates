import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ClockKeyIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ClockKeyIcon = forwardRef<SVGSVGElement, ClockKeyIconProps>(
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
              d="M8 1.5a6.5 6.5 0 0 0-5.07 10.57l-1.065 1.065A8 8 0 1 1 15.418 11h-1.65A6.5 6.5 0 0 0 8 1.5"
            />
            <path fill="currentColor" d="M7.25 8V4h1.5v3.25H11v1.5H8A.75.75 0 0 1 7.25 8" />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M4 13a3 3 0 0 1 5.959-.5h4.291a.75.75 0 0 1 .75.75V16h-1.5v-2h-1v2H11v-2H9.83A3.001 3.001 0 0 1 4 13m3-1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3"
              clipRule="evenodd"
            />
    </svg>
  )
);
ClockKeyIcon.displayName = "ClockKeyIcon";
