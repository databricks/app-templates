import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ChevronDownIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ChevronDownIcon = forwardRef<SVGSVGElement, ChevronDownIconProps>(
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
              d="M8 8.917 10.947 6 12 7.042 8 11 4 7.042 5.053 6z"
              clipRule="evenodd"
            />
    </svg>
  )
);
ChevronDownIcon.displayName = "ChevronDownIcon";
