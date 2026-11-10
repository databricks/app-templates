import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface MinusCircleSmallIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const MinusCircleSmallIcon = forwardRef<SVGSVGElement, MinusCircleSmallIconProps>(
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
      <path fill="currentColor" d="M10.75 7v1.5h-6V7z" />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M7.75 1a6.75 6.75 0 1 1 0 13.5 6.75 6.75 0 0 1 0-13.5m0 1.5a5.25 5.25 0 1 0 0 10.5 5.25 5.25 0 0 0 0-10.5"
              clipRule="evenodd"
            />
    </svg>
  )
);
MinusCircleSmallIcon.displayName = "MinusCircleSmallIcon";
