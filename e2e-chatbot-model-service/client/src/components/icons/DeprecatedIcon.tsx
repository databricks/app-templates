import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface DeprecatedIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const DeprecatedIcon = forwardRef<SVGSVGElement, DeprecatedIconProps>(
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
              d="M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2m-3.92 9.103q.36.454.815.816l7.026-7.023a5 5 0 0 0-.817-.817z"
            />
    </svg>
  )
);
DeprecatedIcon.displayName = "DeprecatedIcon";
