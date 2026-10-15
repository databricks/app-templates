import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface RadioIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const RadioIcon = forwardRef<SVGSVGElement, RadioIconProps>(
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
              d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8m5 0a3 3 0 1 1 6 0 3 3 0 0 1-6 0m3-1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3"
              clipRule="evenodd"
            />
    </svg>
  )
);
RadioIcon.displayName = "RadioIcon";
