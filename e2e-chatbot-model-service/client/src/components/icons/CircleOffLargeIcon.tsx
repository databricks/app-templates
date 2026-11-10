import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CircleOffLargeIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CircleOffLargeIcon = forwardRef<SVGSVGElement, CircleOffLargeIconProps>(
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
              d="m15.352 1.729-1.182 1.18A8 8 0 0 1 2.91 14.17l-1.182 1.183-1.08-1.08L14.273.649zM3.978 13.1A6.46 6.46 0 0 0 8 14.5a6.5 6.5 0 0 0 5.102-10.523z"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              d="M8 0c1.373 0 2.664.346 3.793.955l-1.12 1.12a6.5 6.5 0 0 0-8.598 8.598L.957 11.79A8 8 0 0 1 8 0"
            />
    </svg>
  )
);
CircleOffLargeIcon.displayName = "CircleOffLargeIcon";
