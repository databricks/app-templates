import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CheckCircleSmallIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CheckCircleSmallIcon = forwardRef<SVGSVGElement, CheckCircleSmallIconProps>(
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
              d="M8 3.5c.873 0 1.687.25 2.377.68L9.271 5.285a3 3 0 1 0 1.523 1.629l-2.787 2.79-1.882-1.882.79-.789 1.092 1.093 3.24-3.238A4.5 4.5 0 1 1 8 3.5"
            />
    </svg>
  )
);
CheckCircleSmallIcon.displayName = "CheckCircleSmallIcon";
