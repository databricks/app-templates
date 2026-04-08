import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface SortHorizontalAscendingIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const SortHorizontalAscendingIcon = forwardRef<SVGSVGElement, SortHorizontalAscendingIconProps>(
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
              d="M1.47 5.03.94 4.5l.53-.53 3.5-3.5 1.06 1.06-2.22 2.22H10v1.5H3.81l2.22 2.22-1.06 1.06zM4.5 15v-4H6v4zm8 0V5H14v10zm-4-7v7H10V8z"
              clipRule="evenodd"
            />
    </svg>
  )
);
SortHorizontalAscendingIcon.displayName = "SortHorizontalAscendingIcon";
