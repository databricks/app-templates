import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CheckIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CheckIcon = forwardRef<SVGSVGElement, CheckIconProps>(
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
              d="m15.06 3.56-9.53 9.531L1 8.561 2.06 7.5l3.47 3.47L14 2.5z"
              clipRule="evenodd"
            />
    </svg>
  )
);
CheckIcon.displayName = "CheckIcon";
