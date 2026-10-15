import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ChevronDoubleRightOffIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ChevronDoubleRightOffIcon = forwardRef<SVGSVGElement, ChevronDoubleRightOffIconProps>(
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
              d="m2.5 1.5 12 12-1 1-3.47-3.47-.97.97L8 10.94l.97-.97-.94-.94L5.06 12 4 10.94l2.97-2.97L1.5 2.5zM13.09 7.97l-1 1-4.03-4.03 1-1z"
            />
    </svg>
  )
);
ChevronDoubleRightOffIcon.displayName = "ChevronDoubleRightOffIcon";
