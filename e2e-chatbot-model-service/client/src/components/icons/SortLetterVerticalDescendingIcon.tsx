import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface SortLetterVerticalDescendingIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const SortLetterVerticalDescendingIcon = forwardRef<SVGSVGElement, SortLetterVerticalDescendingIconProps>(
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
      <g fill="currentColor" clipPath="url(#SortLetterVerticalDescendingIcon_svg__a)">
              <path
                fillRule="evenodd"
                d="M4.307 0a.75.75 0 0 1 .697.473L7.596 7H5.982l-.238-.6H2.855l-.24.6H1L3.61.472A.75.75 0 0 1 4.307 0m-.852 4.9h1.693l-.844-2.124z"
                clipRule="evenodd"
              />
              <path d="M4.777 9.5H1.5V8h4.75a.75.75 0 0 1 .607 1.191L3.723 13.5H7V15H2.25a.75.75 0 0 1-.607-1.191zM12 15.06l-4.03-4.03 1.06-1.06 2.22 2.22V6h1.5v6.19l2.22-2.22 1.06 1.06z" />
            </g>
            <defs>
              <clipPath>
                <path fill="#fff" d="M0 0h16v16H0z" />
              </clipPath>
            </defs>
    </svg>
  )
);
SortLetterVerticalDescendingIcon.displayName = "SortLetterVerticalDescendingIcon";
