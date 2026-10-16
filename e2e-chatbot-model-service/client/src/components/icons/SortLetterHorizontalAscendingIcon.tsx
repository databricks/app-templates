import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface SortLetterHorizontalAscendingIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const SortLetterHorizontalAscendingIcon = forwardRef<SVGSVGElement, SortLetterHorizontalAscendingIconProps>(
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
      <g fill="currentColor" clipPath="url(#SortLetterHorizontalAscendingIcon_svg__a)">
              <path d="m14.06 4-4.03 4.03-1.06-1.06 2.22-2.22H5v-1.5h6.19L8.97 1.03l1.06-1.06z" />
              <path
                fillRule="evenodd"
                d="M4.307 9a.75.75 0 0 1 .697.473L7.596 16H5.982l-.238-.6H2.855l-.24.6H1l2.61-6.528A.75.75 0 0 1 4.307 9m-.852 4.9h1.693l-.844-2.124z"
                clipRule="evenodd"
              />
              <path d="M11.777 10.5H8.5V9h4.75a.75.75 0 0 1 .607 1.191l-3.134 4.31H14V16H9.25a.75.75 0 0 1-.607-1.192z" />
            </g>
            <defs>
              <clipPath>
                <path fill="#fff" d="M0 0h16v16H0z" />
              </clipPath>
            </defs>
    </svg>
  )
);
SortLetterHorizontalAscendingIcon.displayName = "SortLetterHorizontalAscendingIcon";
