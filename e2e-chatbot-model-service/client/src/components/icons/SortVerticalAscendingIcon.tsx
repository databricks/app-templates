import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface SortVerticalAscendingIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const SortVerticalAscendingIcon = forwardRef<SVGSVGElement, SortVerticalAscendingIconProps>(
  ({ size = 16, className, ariaLabel, ...props }, ref) => (
    <svg
      ref={ref}
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      aria-hidden={!ariaLabel}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      {...props}
    >
<path fillRule="evenodd" clipRule="evenodd" d="M10.9697 1.46966L11.5 0.939331L12.0303 1.46966L15.5303 4.96966L14.4697 6.03032L12.25 3.81065V9.99999H10.75V3.81065L8.53033 6.03032L7.46967 4.96966L10.9697 1.46966ZM1 4.49999H5V5.99999H1V4.49999ZM1 12.5H11V14H1V12.5ZM8 8.49999H1V9.99999H8V8.49999Z" fill="currentColor"/>
</svg>
  )
);
SortVerticalAscendingIcon.displayName = "SortVerticalAscendingIcon";
