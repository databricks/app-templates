import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ListClearIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ListClearIcon = forwardRef<SVGSVGElement, ListClearIconProps>(
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
      <g fill="currentColor" clipPath="url(#ListClearIcon_svg__a)">
              <path d="M15.03 13.97 13.06 12l1.97-1.97-1.06-1.06L12 10.94l-1.97-1.97-1.06 1.06L10.94 12l-1.97 1.97 1.06 1.06L12 13.06l1.97 1.97zM5 11.5H1V10h4zM11 3.5H1V2h10zM7 7.5H1V6h6z" />
            </g>
            <defs>
              <clipPath>
                <path fill="#fff" d="M0 16h16V0H0z" />
              </clipPath>
            </defs>
    </svg>
  )
);
ListClearIcon.displayName = "ListClearIcon";
