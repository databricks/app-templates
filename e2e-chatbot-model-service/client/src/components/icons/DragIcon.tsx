import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface DragIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const DragIcon = forwardRef<SVGSVGElement, DragIconProps>(
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
              d="M5.25 1a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5M10.75 1a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5M5.25 6.25a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5M10.75 6.25a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5M5.25 11.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5M10.75 11.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5"
            />
    </svg>
  )
);
DragIcon.displayName = "DragIcon";
