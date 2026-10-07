import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CheckCircleIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CheckCircleIcon = forwardRef<SVGSVGElement, CheckCircleIconProps>(
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
      <path fill="currentColor" d="M11.53 6.53 7 11.06 4.47 8.53l1.06-1.06L7 8.94l3.47-3.47z" />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8m8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13"
              clipRule="evenodd"
            />
    </svg>
  )
);
CheckCircleIcon.displayName = "CheckCircleIcon";
