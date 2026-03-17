import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface TrendingIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const TrendingIcon = forwardRef<SVGSVGElement, TrendingIconProps>(
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
              d="M6.332.14a.99.99 0 0 1 .98-.018c4.417 2.052 6.918 6.313 6.764 9.876-.066 1.497-.602 2.883-1.64 3.895-1.04 1.012-2.531 1.604-4.42 1.607a5.745 5.745 0 0 1-6.097-5.504v-.008a4.85 4.85 0 0 1 2.495-4.366.554.554 0 0 1 .776.261c.27.613.648 1.17 1.115 1.646.547-.714.8-1.637.792-2.652-.009-1.208-.388-2.502-1.024-3.605A.84.84 0 0 1 6.333.14"
            />
    </svg>
  )
);
TrendingIcon.displayName = "TrendingIcon";
