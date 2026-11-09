import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface RunningIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const RunningIcon = forwardRef<SVGSVGElement, RunningIconProps>(
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
      <g clipPath="url(#RunningIcon_svg__a)">
              <path
                fill="currentColor"
                fillRule="evenodd"
                d="M8 1.5A6.5 6.5 0 0 0 1.5 8H0a8 8 0 0 1 8-8zm0 13A6.5 6.5 0 0 0 14.5 8H16a8 8 0 0 1-8 8z"
                clipRule="evenodd"
              />
            </g>
            <defs>
              <clipPath>
                <path fill="#fff" d="M0 0h16v16H0z" />
              </clipPath>
            </defs>
    </svg>
  )
);
RunningIcon.displayName = "RunningIcon";
