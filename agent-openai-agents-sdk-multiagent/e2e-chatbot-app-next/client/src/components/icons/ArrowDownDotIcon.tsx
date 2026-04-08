import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ArrowDownDotIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ArrowDownDotIcon = forwardRef<SVGSVGElement, ArrowDownDotIconProps>(
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
              d="M8 15a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M3.47 6.53 8 11.06l4.53-4.53-1.06-1.06-2.72 2.72V1h-1.5v7.19L4.53 5.47z"
            />
    </svg>
  )
);
ArrowDownDotIcon.displayName = "ArrowDownDotIcon";
