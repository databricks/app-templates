import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CloudModelIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CloudModelIcon = forwardRef<SVGSVGElement, CloudModelIconProps>(
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
              d="M3.394 5.586a4.752 4.752 0 0 1 9.351.946A3.75 3.75 0 0 1 15.787 9H14.12a2.25 2.25 0 0 0-1.871-1H12a.75.75 0 0 1-.75-.75v-.5a3.25 3.25 0 0 0-6.475-.402.75.75 0 0 1-.698.657A2.75 2.75 0 0 0 4 12.49V14a.8.8 0 0 1-.179-.021 4.25 4.25 0 0 1-.427-8.393"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M8 7a2.25 2.25 0 0 1 2.03 3.22l.5.5a2.25 2.25 0 1 1-1.06 1.06l-.5-.5A2.25 2.25 0 1 1 8 7m.75 2.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0m3.5 3.5a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0"
              clipRule="evenodd"
            />
    </svg>
  )
);
CloudModelIcon.displayName = "CloudModelIcon";
