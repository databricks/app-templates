import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface BarStackedPercentageIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const BarStackedPercentageIcon = forwardRef<SVGSVGElement, BarStackedPercentageIconProps>(
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
              d="M2.75 1a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h10.5a.75.75 0 0 0 .75-.75V1.75a.75.75 0 0 0-.75-.75zM9 8.5v5H7v-5zM9 7V2.5H7V7zm3.5 6.5h-2v-1.75h2zm-2-11v7.75h2V2.5zm-5 0h-2v7.75h2zm0 11v-1.75h-2v1.75z"
              clipRule="evenodd"
            />
    </svg>
  )
);
BarStackedPercentageIcon.displayName = "BarStackedPercentageIcon";
