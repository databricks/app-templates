import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CheckCircleFillIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CheckCircleFillIcon = forwardRef<SVGSVGElement, CheckCircleFillIconProps>(
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
              d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8m11.53-1.47-1.06-1.06L7 8.94 5.53 7.47 4.47 8.53l2 2 .53.53.53-.53z"
              clipRule="evenodd"
            />
    </svg>
  )
);
CheckCircleFillIcon.displayName = "CheckCircleFillIcon";
