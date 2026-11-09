import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface UndoIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const UndoIcon = forwardRef<SVGSVGElement, UndoIconProps>(
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
      <g clipPath="url(#UndoIcon_svg__a)">
              <path
                fill="currentColor"
                d="M2.81 6.5h8.69a3 3 0 0 1 0 6H7V14h4.5a4.5 4.5 0 0 0 0-9H2.81l2.72-2.72-1.06-1.06-4.53 4.53 4.53 4.53 1.06-1.06z"
              />
            </g>
            <defs>
              <clipPath>
                <path fill="#fff" d="M16 16H0V0h16z" />
              </clipPath>
            </defs>
    </svg>
  )
);
UndoIcon.displayName = "UndoIcon";
