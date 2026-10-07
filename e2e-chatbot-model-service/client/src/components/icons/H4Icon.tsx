import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface H4IconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const H4Icon = forwardRef<SVGSVGElement, H4IconProps>(
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
      <path
              fill="currentColor"
              d="M2.5 7.25H6V3h1.5v10H6V8.75H2.5V13H1V3h1.5zM13.249 3a.75.75 0 0 1 .75.75L14 9.5h1V11h-1v2h-1.5v-2H9.25a.75.75 0 0 1-.75-.75V9.5a.75.75 0 0 1 .097-.37l3.25-5.75.055-.083A.75.75 0 0 1 12.5 3zm-3.137 6.5H12.5l-.001-4.224z"
            />
    </svg>
  )
);
H4Icon.displayName = "H4Icon";
