import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CheckCircleBadgeIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CheckCircleBadgeIcon = forwardRef<SVGSVGElement, CheckCircleBadgeIconProps>(
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
              d="m10.47 5.47 1.06 1.06L7 11.06 4.47 8.53l1.06-1.06L7 8.94zM16 12.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0"
            />
            <path
              fill="currentColor"
              d="M1.5 8a6.5 6.5 0 0 1 13-.084c.54.236 1.031.565 1.452.967Q16 8.448 16 8a8 8 0 1 0-7.117 7.952 5 5 0 0 1-.967-1.453A6.5 6.5 0 0 1 1.5 8"
            />
    </svg>
  )
);
CheckCircleBadgeIcon.displayName = "CheckCircleBadgeIcon";
