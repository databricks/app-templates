import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface DangerFillIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const DangerFillIcon = forwardRef<SVGSVGElement, DangerFillIconProps>(
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
              d="m15.78 11.533-4.242 4.243a.75.75 0 0 1-.53.22H4.996a.75.75 0 0 1-.53-.22L.224 11.533a.75.75 0 0 1-.22-.53v-6.01a.75.75 0 0 1 .22-.53L4.467.22a.75.75 0 0 1 .53-.22h6.01a.75.75 0 0 1 .53.22l4.243 4.242c.141.141.22.332.22.53v6.011a.75.75 0 0 1-.22.53m-8.528-.785a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0m1.5-5.75v4h-1.5v-4z"
              clipRule="evenodd"
            />
    </svg>
  )
);
DangerFillIcon.displayName = "DangerFillIcon";
