import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface BadgeCodeOffIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const BadgeCodeOffIcon = forwardRef<SVGSVGElement, BadgeCodeOffIconProps>(
  ({ size = 16, className, ariaLabel, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 17 17"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden={!ariaLabel}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      {...props}
    >
      <path
              fill="currentColor"
              d="M16 2.75v11.19l-1.5-1.5V3.5h-3.05a.75.75 0 0 1-.735-.6 1.75 1.75 0 0 0-3.43 0 .75.75 0 0 1-.735.6h-.99L4.06 2H6a3.25 3.25 0 0 1 6 0h3.25a.75.75 0 0 1 .75.75"
            />
            <path fill="currentColor" d="m12.1 10.04-1.06-1.06.48-.48-1.97-1.97 1.06-1.06 3.031 3.03z" />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="m12.94 15 1.03 1.03 1.06-1.06-13-13L.97 3.03 2 4.06v10.19c0 .414.336.75.75.75zm-4.455-4.454L7.47 11.56 4.44 8.53l1.015-1.016L3.5 5.561V13.5h7.94z"
              clipRule="evenodd"
            />
    </svg>
  )
);
BadgeCodeOffIcon.displayName = "BadgeCodeOffIcon";
