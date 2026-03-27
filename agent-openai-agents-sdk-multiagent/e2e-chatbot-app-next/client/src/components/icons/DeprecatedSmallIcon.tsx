import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface DeprecatedSmallIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const DeprecatedSmallIcon = forwardRef<SVGSVGElement, DeprecatedSmallIconProps>(
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
              d="M8 3a5 5 0 1 1 0 10A5 5 0 0 1 8 3m-3.268 7.585q.301.379.68.68l5.856-5.85a4.2 4.2 0 0 0-.682-.683z"
            />
    </svg>
  )
);
DeprecatedSmallIcon.displayName = "DeprecatedSmallIcon";
