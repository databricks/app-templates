import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ChevronRightIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ChevronRightIcon = forwardRef<SVGSVGElement, ChevronRightIconProps>(
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
              d="M8.917 8 6 5.053 7.042 4 11 8l-3.958 4L6 10.947z"
              clipRule="evenodd"
            />
    </svg>
  )
);
ChevronRightIcon.displayName = "ChevronRightIcon";
