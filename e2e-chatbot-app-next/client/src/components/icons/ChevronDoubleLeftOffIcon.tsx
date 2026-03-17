import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ChevronDoubleLeftOffIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ChevronDoubleLeftOffIcon = forwardRef<SVGSVGElement, ChevronDoubleLeftOffIconProps>(
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
              d="m2.5 1.5 12 12-1 1-7.47-7.47-.94.94 2.97 2.97L7 12 2.97 7.97l2-2L1.5 2.5zM12.06 5l-1.97 1.97-1.06-1.06L11 3.94z"
            />
    </svg>
  )
);
ChevronDoubleLeftOffIcon.displayName = "ChevronDoubleLeftOffIcon";
