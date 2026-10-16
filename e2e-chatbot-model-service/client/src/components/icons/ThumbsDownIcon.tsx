import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ThumbsDownIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ThumbsDownIcon = forwardRef<SVGSVGElement, ThumbsDownIconProps>(
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
      <g clipPath="url(#ThumbsDownIcon_svg__a)">
              <path
                fill="currentColor"
                fillRule="evenodd"
                d="M13.655 2.274a.8.8 0 0 0-.528-.19h-1.044v5.833h1.044a.79.79 0 0 0 .79-.643V2.725a.8.8 0 0 0-.262-.451m-3.072 6.233V2.083H3.805a.58.58 0 0 0-.583.496v.001l-.92 6a.585.585 0 0 0 .583.67h3.782a.75.75 0 0 1 .75.75v2.667a1.25 1.25 0 0 0 .8 1.166zm1.238.91L9.352 14.97a.75.75 0 0 1-.685.446 2.75 2.75 0 0 1-2.75-2.75V10.75h-3.02A2.082 2.082 0 0 1 .82 8.354l.92-6A2.085 2.085 0 0 1 3.816.584h9.29a2.29 2.29 0 0 1 2.303 1.982 1 1 0 0 1 .007.1v4.667a1 1 0 0 1-.007.1 2.29 2.29 0 0 1-2.303 1.984z"
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
ThumbsDownIcon.displayName = "ThumbsDownIcon";
