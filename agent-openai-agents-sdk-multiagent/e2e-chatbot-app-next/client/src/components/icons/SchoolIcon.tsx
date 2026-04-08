import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface SchoolIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const SchoolIcon = forwardRef<SVGSVGElement, SchoolIconProps>(
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
              d="M16 7a.75.75 0 0 0-.37-.647l-7.25-4.25a.75.75 0 0 0-.76 0L.37 6.353a.75.75 0 0 0 0 1.294L3 9.188V12a.75.75 0 0 0 .4.663l4.25 2.25a.75.75 0 0 0 .7 0l4.25-2.25A.75.75 0 0 0 13 12V9.188l1.5-.879V12H16zm-7.62 4.897 3.12-1.83v1.481L8 13.401l-3.5-1.853v-1.48l3.12 1.829a.75.75 0 0 0 .76 0M8 3.619 2.233 7 8 10.38 13.767 7z"
              clipRule="evenodd"
            />
    </svg>
  )
);
SchoolIcon.displayName = "SchoolIcon";
