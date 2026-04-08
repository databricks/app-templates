import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface BarGroupedIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const BarGroupedIcon = forwardRef<SVGSVGElement, BarGroupedIconProps>(
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
              fillRule="evenodd"
              d="M12.25 2a.75.75 0 0 0-.75.75V7H9.25a.75.75 0 0 0-.75.75v5.5c0 .414.336.75.75.75h6a.75.75 0 0 0 .75-.75V2.75a.75.75 0 0 0-.75-.75zm-.75 10.5v-4H10v4zm1.5 0h1.5v-9H13zM3.75 5a.75.75 0 0 0-.75.75V9H.75a.75.75 0 0 0-.75.75v3.5c0 .414.336.75.75.75h6a.75.75 0 0 0 .75-.75v-7.5A.75.75 0 0 0 6.75 5zM3 12.5v-2H1.5v2zm1.5 0H6v-6H4.5z"
              clipRule="evenodd"
            />
    </svg>
  )
);
BarGroupedIcon.displayName = "BarGroupedIcon";
