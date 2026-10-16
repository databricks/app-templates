import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CertifiedFillIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CertifiedFillIcon = forwardRef<SVGSVGElement, CertifiedFillIconProps>(
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
              d="M8 1c.682 0 1.283.342 1.644.862a1.998 1.998 0 0 1 2.848 1.645 1.997 1.997 0 0 1 1.644 2.847 1.997 1.997 0 0 1 .001 3.29 1.997 1.997 0 0 1-1.645 2.848 1.997 1.997 0 0 1-2.848 1.645 1.996 1.996 0 0 1-3.288 0 1.997 1.997 0 0 1-2.85-1.645 1.997 1.997 0 0 1-1.643-2.848 1.996 1.996 0 0 1 0-3.289 1.997 1.997 0 0 1 1.644-2.848 1.998 1.998 0 0 1 2.849-1.645C6.716 1.342 7.319 1 8 1m-.81 7.252L6.146 7.206 5 8.351l2.19 2.19L11 6.731 9.856 5.587z"
            />
    </svg>
  )
);
CertifiedFillIcon.displayName = "CertifiedFillIcon";
