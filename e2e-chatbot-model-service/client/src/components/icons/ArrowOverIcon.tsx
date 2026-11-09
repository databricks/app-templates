import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ArrowOverIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ArrowOverIcon = forwardRef<SVGSVGElement, ArrowOverIconProps>(
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
              d="M8 2.5a5.48 5.48 0 0 1 3.817 1.54l.009.009.5.451H11V6h4V2h-1.5v1.539l-.651-.588A7.003 7.003 0 0 0 1.367 5.76l1.42.48A5.5 5.5 0 0 1 8 2.5M8 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3"
            />
    </svg>
  )
);
ArrowOverIcon.displayName = "ArrowOverIcon";
