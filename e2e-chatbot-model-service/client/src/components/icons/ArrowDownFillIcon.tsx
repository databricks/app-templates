import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ArrowDownFillIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ArrowDownFillIcon = forwardRef<SVGSVGElement, ArrowDownFillIconProps>(
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
              d="M8 15.75a.75.75 0 0 1-.53-.22L1.22 9.28A.75.75 0 0 1 1.75 8H5.5V.75A.75.75 0 0 1 6.25 0h3.5a.75.75 0 0 1 .75.75V8h3.75a.751.751 0 0 1 .53 1.28l-6.25 6.25-.114.094A.75.75 0 0 1 8 15.75"
            />
    </svg>
  )
);
ArrowDownFillIcon.displayName = "ArrowDownFillIcon";
