import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ForkIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ForkIcon = forwardRef<SVGSVGElement, ForkIconProps>(
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
              d="M2 2.75a2.75 2.75 0 1 1 3.5 2.646V6.75h3.75A2.75 2.75 0 0 1 12 9.5v.104a2.751 2.751 0 1 1-1.5 0V9.5c0-.69-.56-1.25-1.25-1.25H5.5v1.354a2.751 2.751 0 1 1-1.5 0V5.396A2.75 2.75 0 0 1 2 2.75M4.75 1.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5M3.5 12.25a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0m6.5 0a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0"
              clipRule="evenodd"
            />
    </svg>
  )
);
ForkIcon.displayName = "ForkIcon";
