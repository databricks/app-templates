import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface GavelIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const GavelIcon = forwardRef<SVGSVGElement, GavelIconProps>(
  ({ size = 16, className, ariaLabel, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden={!ariaLabel}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      {...props}
    >
      <path
              fill="currentColor"
              d="M4 21v-2h12v2zm5.65-4.85L4 10.5l2.1-2.15L11.8 14zM16 9.8l-5.65-5.7L12.5 2l5.65 5.65zM20.6 20 7.55 6.95l1.4-1.4L22 18.6z"
            />
    </svg>
  )
);
GavelIcon.displayName = "GavelIcon";
