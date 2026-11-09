import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface SortLetterUnsortedIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const SortLetterUnsortedIcon = forwardRef<SVGSVGElement, SortLetterUnsortedIconProps>(
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
              d="m11.5.94-.53.53-3.5 3.5 1.06 1.06 2.22-2.22v8.379999999999999L8.53 9.97l-1.06 1.06 3.5 3.5.53.53.53-.53 3.5-3.5-1.06-1.06-2.22 2.22V3.81l2.22 2.22 1.06-1.06-3.5-3.5zM4 1c.274 0 .52.173.623.437L7 7.533H5.549L5.185 6.6h-2.37l-.364.933H1l2.377-6.096A.67.67 0 0 1 4 1m-.639 4.2H4.64L4 3.561zM4.598 9.867H1.311v-1.4h4.706a.67.67 0 0 1 .608.4.72.72 0 0 1-.087.743L3.402 13.6H6.69V15H1.983a.67.67 0 0 1-.608-.4.72.72 0 0 1 .087-.743z"
              clipRule="evenodd"
            />
    </svg>
  )
);
SortLetterUnsortedIcon.displayName = "SortLetterUnsortedIcon";
