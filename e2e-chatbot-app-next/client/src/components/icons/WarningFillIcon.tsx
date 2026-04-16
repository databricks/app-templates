import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface WarningFillIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const WarningFillIcon = forwardRef<SVGSVGElement, WarningFillIconProps>(
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
              fillRule="evenodd"
              d="M8.649 1.374a.75.75 0 0 0-1.298 0l-7.25 12.5A.75.75 0 0 0 .75 15h14.5a.75.75 0 0 0 .649-1.126zM7.25 10V6.5h1.5V10zm1.5 1.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0"
              clipRule="evenodd"
            />
    </svg>
  )
);
WarningFillIcon.displayName = "WarningFillIcon";
