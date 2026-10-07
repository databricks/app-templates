import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface TriangleIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const TriangleIcon = forwardRef<SVGSVGElement, TriangleIconProps>(
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
              d="M8 3a.75.75 0 0 1 .65.375l4.33 7.5A.75.75 0 0 1 12.33 12H3.67a.75.75 0 0 1-.65-1.125l4.33-7.5.056-.083A.75.75 0 0 1 8 3"
            />
    </svg>
  )
);
TriangleIcon.displayName = "TriangleIcon";
