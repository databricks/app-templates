import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface NoIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const NoIcon = forwardRef<SVGSVGElement, NoIconProps>(
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
              d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0M1.5 8a6.5 6.5 0 0 1 10.535-5.096l-9.131 9.131A6.47 6.47 0 0 1 1.5 8m2.465 5.096a6.5 6.5 0 0 0 9.131-9.131z"
              clipRule="evenodd"
            />
    </svg>
  )
);
NoIcon.displayName = "NoIcon";
