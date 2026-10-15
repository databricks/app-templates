import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface BarChartIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const BarChartIcon = forwardRef<SVGSVGElement, BarChartIconProps>(
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
      <path fill="currentColor" d="M1 1v13.25c0 .414.336.75.75.75H15v-1.5H2.5V1z" />
            <path fill="currentColor" d="M7 1v11h1.5V1zM10 5v7h1.5V5zM4 5v7h1.5V5zM13 12V8h1.5v4z" />
    </svg>
  )
);
BarChartIcon.displayName = "BarChartIcon";
