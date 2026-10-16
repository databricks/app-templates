import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface BrushIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const BrushIcon = forwardRef<SVGSVGElement, BrushIconProps>(
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
              d="M11.563 1.377a1.75 1.75 0 0 1 2.474 0l.586.586a1.75 1.75 0 0 1 0 2.475l-6.875 6.874A3.75 3.75 0 0 1 4 15H.75a.751.751 0 0 1-.61-1.185l.668-.936c.287-.402.442-.885.442-1.38A3.25 3.25 0 0 1 4.5 8.25h.19zM4.499 9.75A1.75 1.75 0 0 0 2.75 11.5c0 .706-.193 1.398-.557 2H4a2.25 2.25 0 0 0 2.246-2.193L4.69 9.75zm8.478-7.312a.25.25 0 0 0-.354 0L6.061 9l.94.94 6.562-6.563a.25.25 0 0 0 0-.353z"
            />
    </svg>
  )
);
BrushIcon.displayName = "BrushIcon";
