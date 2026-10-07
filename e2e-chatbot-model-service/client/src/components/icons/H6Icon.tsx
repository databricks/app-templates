import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface H6IconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const H6Icon = forwardRef<SVGSVGElement, H6IconProps>(
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
              d="M2.5 7.25H6V3h1.5v10H6V8.75H2.5V13H1V3h1.5zM12.125 3c1.167 0 2.17.695 2.62 1.69l-1.366.62a1.38 1.38 0 0 0-1.254-.81h-.375c-.69 0-1.25.56-1.25 1.25v1.154A3 3 0 0 1 15 9.5v.5a3 3 0 0 1-5.996.154L9 10V5.75A2.75 2.75 0 0 1 11.75 3zM12 8a1.5 1.5 0 0 0-1.5 1.5v.5a1.5 1.5 0 0 0 3 0v-.5A1.5 1.5 0 0 0 12 8"
            />
    </svg>
  )
);
H6Icon.displayName = "H6Icon";
