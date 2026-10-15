import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CloudKeyIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CloudKeyIcon = forwardRef<SVGSVGElement, CloudKeyIconProps>(
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
              d="M3.394 5.586a4.752 4.752 0 0 1 9.351.946A3.75 3.75 0 0 1 15.787 9H14.12a2.25 2.25 0 0 0-1.871-1H12a.75.75 0 0 1-.75-.75v-.5a3.25 3.25 0 0 0-6.475-.402.75.75 0 0 1-.698.657A2.75 2.75 0 0 0 4 12.49V14a.8.8 0 0 1-.179-.021 4.25 4.25 0 0 1-.427-8.393M15.25 10.5h-4.291a3 3 0 1 0-.13 1.5H12v2h1.5v-2h1v2H16v-2.75a.75.75 0 0 0-.75-.75M8 9.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3"
              clipRule="evenodd"
            />
    </svg>
  )
);
CloudKeyIcon.displayName = "CloudKeyIcon";
