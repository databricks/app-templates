import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface LifesaverIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const LifesaverIcon = forwardRef<SVGSVGElement, LifesaverIconProps>(
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
              d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0m2.3 11.361A3.94 3.94 0 0 1 8 12.1c-.86 0-1.652-.275-2.302-.739l-1.732 1.733A6.47 6.47 0 0 0 8 14.5a6.47 6.47 0 0 0 4.033-1.406zM2.906 3.966A6.47 6.47 0 0 0 1.5 8a6.47 6.47 0 0 0 1.405 4.033l1.755-1.755A4.07 4.07 0 0 1 4 8.05c0-.848.258-1.637.7-2.29zM11.3 5.76c.442.652.701 1.441.701 2.289 0 .821-.243 1.588-.661 2.228l1.755 1.755A6.47 6.47 0 0 0 14.5 8a6.47 6.47 0 0 0-1.406-4.034zM8 5.5c-1.37 0-2.5 1.13-2.5 2.55S6.63 10.6 8 10.6s2.5-1.131 2.5-2.55C10.5 6.63 9.37 5.5 8 5.5m0-4a6.47 6.47 0 0 0-4.034 1.405l1.79 1.79A3.95 3.95 0 0 1 8 4c.833 0 1.605.257 2.243.695l1.79-1.79A6.47 6.47 0 0 0 8 1.5"
              clipRule="evenodd"
            />
    </svg>
  )
);
LifesaverIcon.displayName = "LifesaverIcon";
