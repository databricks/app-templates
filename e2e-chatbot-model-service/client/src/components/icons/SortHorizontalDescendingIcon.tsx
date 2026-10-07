import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface SortHorizontalDescendingIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const SortHorizontalDescendingIcon = forwardRef<SVGSVGElement, SortHorizontalDescendingIconProps>(
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
              d="M3.5 15V5H2v10zm8 0v-4H10v4zm-4-7v7H6V8zm7.03-2.97.53-.53-.53-.53-3.5-3.5-1.06 1.06 2.22 2.22H6v1.5h6.19L9.97 7.47l1.06 1.06z"
              clipRule="evenodd"
            />
    </svg>
  )
);
SortHorizontalDescendingIcon.displayName = "SortHorizontalDescendingIcon";
