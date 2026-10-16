import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ChevronDoubleDownIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ChevronDoubleDownIcon = forwardRef<SVGSVGElement, ChevronDoubleDownIconProps>(
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
      <path fill="currentColor" d="M10.947 7.954 8 10.891 5.056 7.954 3.997 9.016l4.004 3.993 4.005-3.993z" />
            <path fill="currentColor" d="M10.947 3.994 8 6.931 5.056 3.994 3.997 5.056 8.001 9.05l4.005-3.993z" />
    </svg>
  )
);
ChevronDoubleDownIcon.displayName = "ChevronDoubleDownIcon";
