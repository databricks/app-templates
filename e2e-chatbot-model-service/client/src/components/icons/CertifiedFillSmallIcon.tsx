import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CertifiedFillSmallIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CertifiedFillSmallIcon = forwardRef<SVGSVGElement, CertifiedFillSmallIconProps>(
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
              d="M8 3c.71 0 1.33.37 1.686.928a1.997 1.997 0 0 1 2.385 2.385 1.996 1.996 0 0 1 0 3.373 1.996 1.996 0 0 1-2.385 2.385 1.996 1.996 0 0 1-3.373 0 1.996 1.996 0 0 1-2.385-2.385 1.996 1.996 0 0 1 0-3.373 1.997 1.997 0 0 1 2.385-2.385A2 2 0 0 1 8 3m-.675 5.22-.87-.871-.955.954 1.825 1.825L10.5 6.954 9.546 6z"
            />
    </svg>
  )
);
CertifiedFillSmallIcon.displayName = "CertifiedFillSmallIcon";
