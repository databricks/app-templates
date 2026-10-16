import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface DotsCircleIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const DotsCircleIcon = forwardRef<SVGSVGElement, DotsCircleIconProps>(
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
      <g fill="currentColor" clipPath="url(#DotsCircleIcon_svg__a)">
              <path d="M6 8a.75.75 0 1 1-1.5 0A.75.75 0 0 1 6 8M8 8.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5M10.75 8.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5" />
              <path
                fillRule="evenodd"
                d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0M1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0"
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
DotsCircleIcon.displayName = "DotsCircleIcon";
