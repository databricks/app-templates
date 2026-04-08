import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface WarningIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const WarningIcon = forwardRef<SVGSVGElement, WarningIconProps>(
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
      <path fill="currentColor" d="M7.25 10V6.5h1.5V10zM8 12.5A.75.75 0 1 0 8 11a.75.75 0 0 0 0 1.5" />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M8 1a.75.75 0 0 1 .649.374l7.25 12.5A.75.75 0 0 1 15.25 15H.75a.75.75 0 0 1-.649-1.126l7.25-12.5A.75.75 0 0 1 8 1m0 2.245L2.052 13.5h11.896z"
              clipRule="evenodd"
            />
    </svg>
  )
);
WarningIcon.displayName = "WarningIcon";
