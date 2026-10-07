import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CatalogHIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CatalogHIcon = forwardRef<SVGSVGElement, CatalogHIconProps>(
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
<path fillRule="evenodd" clipRule="evenodd" d="M3.5 13.25V4.79198C3.80623 4.92578 4.14445 5 4.5 5H12.5V8H14V0.75C14 0.335786 13.6642 0 13.25 0H4.5C3.11929 0 2 1.11929 2 2.5V13.25C2 14.7688 3.23122 16 4.75 16H8.5V14.5H4.75C4.05964 14.5 3.5 13.9404 3.5 13.25ZM12.5 3.5H4.5C3.94772 3.5 3.5 3.05228 3.5 2.5C3.5 1.94772 3.94772 1.5 4.5 1.5H12.5V3.5Z" fill="currentColor"/>
<path d="M10 9V16H11.5V13.25H14.5V16H16V9H14.5V11.75H11.5V9H10Z" fill="currentColor"/>
</svg>
  )
);
CatalogHIcon.displayName = "CatalogHIcon";
