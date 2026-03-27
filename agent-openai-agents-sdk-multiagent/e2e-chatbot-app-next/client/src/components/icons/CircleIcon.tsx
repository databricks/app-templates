import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CircleIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CircleIcon = forwardRef<SVGSVGElement, CircleIconProps>(
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
      <path fill="currentColor" d="M12.5 8a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0" />
    </svg>
  )
);
CircleIcon.displayName = "CircleIcon";
