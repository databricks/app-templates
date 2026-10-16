import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface FlowIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const FlowIcon = forwardRef<SVGSVGElement, FlowIconProps>(
  ({ size = 16, className, ariaLabel, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 15 16"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden={!ariaLabel}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      {...props}
    >
      <path
              fill="currentColor"
              d="m4.94 8.018.732.732H3.75a2 2 0 1 0 0 4H9V12a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-.75H3.75a3.5 3.5 0 1 1 0-7h1.957zM10.5 14.5h3v-2h-3zM5 0a1 1 0 0 1 1 1v.75h5.25a3.5 3.5 0 0 1 0 7H9.025l1.035 1.036L9 10.846 6.172 8.019 9 5.189l1.06 1.061-1 1h2.19a2 2 0 0 0 0-4H6V4a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1V1a1 1 0 0 1 1-1zM1.5 3.5h3v-2h-3z"
            />
    </svg>
  )
);
FlowIcon.displayName = "FlowIcon";
