import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface BarsDescendingVerticalIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const BarsDescendingVerticalIcon = forwardRef<SVGSVGElement, BarsDescendingVerticalIconProps>(
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
      <path fill="currentColor" d="M7 12.75H1v-1.5h6zM15 4.75H1v-1.5h14zM1 7.25h10v1.5H1z" />
    </svg>
  )
);
BarsDescendingVerticalIcon.displayName = "BarsDescendingVerticalIcon";
