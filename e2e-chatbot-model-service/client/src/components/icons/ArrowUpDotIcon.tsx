import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ArrowUpDotIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ArrowUpDotIcon = forwardRef<SVGSVGElement, ArrowUpDotIconProps>(
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
              d="M8 1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M12.53 9.47 8 4.94 3.47 9.47l1.06 1.06 2.72-2.72V15h1.5V7.81l2.72 2.72z"
            />
    </svg>
  )
);
ArrowUpDotIcon.displayName = "ArrowUpDotIcon";
