import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface BranchCheckIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const BranchCheckIcon = forwardRef<SVGSVGElement, BranchCheckIconProps>(
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
              d="M3.75 1a2.748 2.748 0 0 1 .75 5.393v3.213A2.749 2.749 0 0 1 3.75 15 2.75 2.75 0 0 1 3 9.606V6.393A2.748 2.748 0 0 1 3.75 1m0 10a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5m0-8.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5"
              clipRule="evenodd"
            />
            <path fill="currentColor" d="M15.03 5.53 9.5 11.06 6.47 8.03l1.06-1.06L9.5 8.94l4.47-4.47z" />
    </svg>
  )
);
BranchCheckIcon.displayName = "BranchCheckIcon";
