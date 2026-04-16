import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface PageLastIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const PageLastIcon = forwardRef<SVGSVGElement, PageLastIconProps>(
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
              d="M3.06 1 2 2.06l5.97 5.97L2 14l1.06 1.06 7.031-7.03zm10.47 14.03h1.5v-14h-1.5z"
              clipRule="evenodd"
            />
    </svg>
  )
);
PageLastIcon.displayName = "PageLastIcon";
