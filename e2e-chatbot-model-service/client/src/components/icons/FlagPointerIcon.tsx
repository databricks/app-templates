import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface FlagPointerIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const FlagPointerIcon = forwardRef<SVGSVGElement, FlagPointerIconProps>(
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
              d="M3 2.5h5.439a.5.5 0 0 1 .39.188l4 5a.5.5 0 0 1 0 .624l-4 5a.5.5 0 0 1-.39.188H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5M1 3a2 2 0 0 1 2-2h5.439A2 2 0 0 1 10 1.75l4 5a2 2 0 0 1 0 2.5l-4 5a2 2 0 0 1-1.562.75H3a2 2 0 0 1-2-2zm6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4"
              clipRule="evenodd"
            />
    </svg>
  )
);
FlagPointerIcon.displayName = "FlagPointerIcon";
