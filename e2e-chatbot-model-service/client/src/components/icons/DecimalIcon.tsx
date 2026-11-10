import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface DecimalIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const DecimalIcon = forwardRef<SVGSVGElement, DecimalIconProps>(
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
              d="M3 10a3 3 0 1 0 6 0V6a3 3 0 0 0-6 0zm3 1.5A1.5 1.5 0 0 1 4.5 10V6a1.5 1.5 0 1 1 3 0v4A1.5 1.5 0 0 1 6 11.5M10 10a3 3 0 1 0 6 0V6a3 3 0 1 0-6 0zm3 1.5a1.5 1.5 0 0 1-1.5-1.5V6a1.5 1.5 0 0 1 3 0v4a1.5 1.5 0 0 1-1.5 1.5"
              clipRule="evenodd"
            />
            <path fill="currentColor" d="M1 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2" />
    </svg>
  )
);
DecimalIcon.displayName = "DecimalIcon";
