import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ArrowUpFillIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ArrowUpFillIcon = forwardRef<SVGSVGElement, ArrowUpFillIconProps>(
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
              d="M8 .25c.199 0 .39.08.53.22l6.25 6.25A.75.75 0 0 1 14.25 8H10.5v7.25a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1-.75-.75V8H1.75a.751.751 0 0 1-.53-1.28L7.47.47l.114-.094A.75.75 0 0 1 8 .25"
            />
    </svg>
  )
);
ArrowUpFillIcon.displayName = "ArrowUpFillIcon";
