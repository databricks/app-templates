import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ExpandLessIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ExpandLessIcon = forwardRef<SVGSVGElement, ExpandLessIconProps>(
  ({ size = 16, className, ariaLabel, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 16 17"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden={!ariaLabel}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      {...props}
    >
      <path
              fill="currentColor"
              d="M12.06 1.06 11 0 8.03 2.97 5.06 0 4 1.06l4.03 4.031zM4 15l4.03-4.03L12.06 15 11 16.06l-2.97-2.969-2.97 2.97z"
            />
    </svg>
  )
);
ExpandLessIcon.displayName = "ExpandLessIcon";
