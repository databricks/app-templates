import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface SortVerticalDescendingIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const SortVerticalDescendingIcon = forwardRef<SVGSVGElement, SortVerticalDescendingIconProps>(
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
<path fillRule="evenodd" clipRule="evenodd" d="M1 3.5H11V2H1V3.5ZM1 11.5H5V10H1V11.5ZM8 7.5H1V6H8V7.5ZM10.9697 14.5303L11.5 15.0607L12.0303 14.5303L15.5303 11.0303L14.4697 9.96967L12.25 12.1893V6H10.75V12.1893L8.53033 9.96967L7.46967 11.0303L10.9697 14.5303Z" fill="currentColor"/>
</svg>
  )
);
SortVerticalDescendingIcon.displayName = "SortVerticalDescendingIcon";
