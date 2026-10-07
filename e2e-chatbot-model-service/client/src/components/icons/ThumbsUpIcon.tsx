import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ThumbsUpIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ThumbsUpIcon = forwardRef<SVGSVGElement, ThumbsUpIconProps>(
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
      <g clipPath="url(#ThumbsUpIcon_svg__a)">
              <path
                fill="currentColor"
                fillRule="evenodd"
                d="M6.648 1.029a.75.75 0 0 1 .685-.446 2.75 2.75 0 0 1 2.75 2.75V5.25h3.02a2.083 2.083 0 0 1 2.079 2.396l-.92 6a2.085 2.085 0 0 1-2.08 1.77H2.668a2.083 2.083 0 0 1-2.084-2.082V8.667a2.083 2.083 0 0 1 2.084-2.083h1.512zM3.917 8.084h-1.25a.583.583 0 0 0-.584.583v4.667a.583.583 0 0 0 .584.583h1.25zm1.5 5.833h6.778a.58.58 0 0 0 .583-.496l.92-6a.584.584 0 0 0-.583-.67H9.333a.75.75 0 0 1-.75-.75V3.332a1.25 1.25 0 0 0-.8-1.166L5.417 7.493z"
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
ThumbsUpIcon.displayName = "ThumbsUpIcon";
