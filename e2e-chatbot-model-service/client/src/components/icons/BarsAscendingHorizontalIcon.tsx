import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface BarsAscendingHorizontalIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const BarsAscendingHorizontalIcon = forwardRef<SVGSVGElement, BarsAscendingHorizontalIconProps>(
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
      <path fill="currentColor" d="M3.25 9v6h1.5V9zM11.25 1v14h1.5V1zM8.75 15V5h-1.5v10z" />
    </svg>
  )
);
BarsAscendingHorizontalIcon.displayName = "BarsAscendingHorizontalIcon";
