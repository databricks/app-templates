import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ChevronUpIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ChevronUpIcon = forwardRef<SVGSVGElement, ChevronUpIconProps>(
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
              d="M8 7.083 5.053 10 4 8.958 8 5l4 3.958L10.947 10z"
              clipRule="evenodd"
            />
    </svg>
  )
);
ChevronUpIcon.displayName = "ChevronUpIcon";
