import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface BarsDescendingHorizontalIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const BarsDescendingHorizontalIcon = forwardRef<SVGSVGElement, BarsDescendingHorizontalIconProps>(
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
      <path fill="currentColor" d="M12.75 9v6h-1.5V9zM4.75 1v14h-1.5V1zM7.25 15V5h1.5v10z" />
    </svg>
  )
);
BarsDescendingHorizontalIcon.displayName = "BarsDescendingHorizontalIcon";
