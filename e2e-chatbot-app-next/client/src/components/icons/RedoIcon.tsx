import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface RedoIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const RedoIcon = forwardRef<SVGSVGElement, RedoIconProps>(
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
      <g clipPath="url(#RedoIcon_svg__a)">
              <path
                fill="currentColor"
                fillRule="evenodd"
                d="m13.19 5-2.72-2.72 1.06-1.06 4.53 4.53-4.53 4.53-1.06-1.06 2.72-2.72H4.5a3 3 0 1 0 0 6H9V14H4.5a4.5 4.5 0 0 1 0-9z"
                clipRule="evenodd"
              />
            </g>
            <defs>
              <clipPath>
                <path fill="#fff" d="M0 16h16V0H0z" />
              </clipPath>
            </defs>
    </svg>
  )
);
RedoIcon.displayName = "RedoIcon";
