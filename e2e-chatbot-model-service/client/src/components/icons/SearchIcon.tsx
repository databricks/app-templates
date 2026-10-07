import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface SearchIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const SearchIcon = forwardRef<SVGSVGElement, SearchIconProps>(
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
      <g clipPath="url(#SearchIcon_svg__a)">
              <path
                fill="currentColor"
                fillRule="evenodd"
                d="M8 1a7 7 0 1 0 4.39 12.453l2.55 2.55 1.06-1.06-2.55-2.55A7 7 0 0 0 8 1M2.5 8a5.5 5.5 0 1 1 11 0 5.5 5.5 0 0 1-11 0"
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
SearchIcon.displayName = "SearchIcon";
