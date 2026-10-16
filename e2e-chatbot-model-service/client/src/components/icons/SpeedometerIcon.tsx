import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface SpeedometerIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const SpeedometerIcon = forwardRef<SVGSVGElement, SpeedometerIconProps>(
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
              d="M5.749 7.82a.75.75 0 0 1 .896.186v.003l.006.006.022.025.08.095c.07.081.172.198.293.34.242.286.57.675.91 1.086.337.409.688.844.979 1.221.272.354.541.723.664.969a1.75 1.75 0 0 1-3.135 1.558c-.126-.253-.252-.7-.362-1.133a44 44 0 0 1-.355-1.534 94 94 0 0 1-.288-1.395l-.088-.443-.023-.124-.006-.033-.002-.008v-.002l-.001-.001-.013-.124a.75.75 0 0 1 .423-.692"
            />
            <path
              fill="currentColor"
              d="M8 1a8 8 0 0 1 6.927 12H13.12a6.47 6.47 0 0 0 1.334-3.254l-1.953.004-.004-1.5 1.957-.004a6.47 6.47 0 0 0-1.363-3.284l-1.378 1.385-1.064-1.058 1.38-1.387a6.47 6.47 0 0 0-3.285-1.359V4.5h-1.5V2.544a6.47 6.47 0 0 0-3.278 1.36l1.38 1.385-1.064 1.058-1.378-1.382a6.47 6.47 0 0 0-1.361 3.281l1.958.004-.004 1.5-1.954-.004A6.47 6.47 0 0 0 2.879 13H1.073A8 8 0 0 1 8 1"
            />
    </svg>
  )
);
SpeedometerIcon.displayName = "SpeedometerIcon";
