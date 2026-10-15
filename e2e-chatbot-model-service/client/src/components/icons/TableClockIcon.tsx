import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface TableClockIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const TableClockIcon = forwardRef<SVGSVGElement, TableClockIconProps>(
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
              d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8m-.75 4.31 1.72 1.72 1.06-1.06-1.28-1.28V9.5h-1.5z"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M14.327 1.004A.75.75 0 0 1 15 1.75V7H6.5v8H1.75a.75.75 0 0 1-.75-.75V1.75l.004-.077A.75.75 0 0 1 1.75 1h12.5zM2.5 13.5H5V7H2.5zm0-8h11v-3h-11z"
              clipRule="evenodd"
            />
    </svg>
  )
);
TableClockIcon.displayName = "TableClockIcon";
