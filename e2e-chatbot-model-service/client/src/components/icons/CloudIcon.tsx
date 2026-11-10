import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CloudIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CloudIcon = forwardRef<SVGSVGElement, CloudIconProps>(
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
              d="M3.394 5.586a4.752 4.752 0 0 1 9.351.946 3.75 3.75 0 0 1-.668 7.464L12 14H4a.8.8 0 0 1-.179-.021 4.25 4.25 0 0 1-.427-8.393m.72 6.914h7.762a.8.8 0 0 1 .186-.008q.092.008.188.008a2.25 2.25 0 0 0 0-4.5H12a.75.75 0 0 1-.75-.75v-.5a3.25 3.25 0 0 0-6.475-.402.75.75 0 0 1-.698.657 2.75 2.75 0 0 0-.024 5.488z"
              clipRule="evenodd"
            />
    </svg>
  )
);
CloudIcon.displayName = "CloudIcon";
