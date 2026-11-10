import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ThreeDotsIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ThreeDotsIcon = forwardRef<SVGSVGElement, ThreeDotsIconProps>(
  ({ size = 16, className, ariaLabel, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 18 15"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden={!ariaLabel}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      {...props}
    >
      <path
              fill="currentColor"
              d="M9 7.375A3.437 3.437 0 1 1 9 .5a3.437 3.437 0 0 1 0 6.875M13.688 8a3.438 3.438 0 1 0 0 6.875 3.438 3.438 0 0 0 0-6.875M4.313 8a3.437 3.437 0 1 0 0 6.875 3.437 3.437 0 0 0 0-6.875"
            />
    </svg>
  )
);
ThreeDotsIcon.displayName = "ThreeDotsIcon";
