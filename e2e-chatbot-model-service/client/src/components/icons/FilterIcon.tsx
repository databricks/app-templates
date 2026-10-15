import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface FilterIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const FilterIcon = forwardRef<SVGSVGElement, FilterIconProps>(
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
              d="M1 1.75A.75.75 0 0 1 1.75 1h12.5a.75.75 0 0 1 .75.75V4a.75.75 0 0 1-.22.53L10 9.31v4.94a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1-.75-.75V9.31L1.22 4.53A.75.75 0 0 1 1 4zm1.5.75v1.19l4.78 4.78c.141.14.22.331.22.53v4.5h1V9a.75.75 0 0 1 .22-.53l4.78-4.78V2.5z"
              clipRule="evenodd"
            />
    </svg>
  )
);
FilterIcon.displayName = "FilterIcon";
