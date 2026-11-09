import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface SparkleRectangleIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const SparkleRectangleIcon = forwardRef<SVGSVGElement, SparkleRectangleIconProps>(
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
              fillRule="evenodd"
              d="M0 2.75A.75.75 0 0 1 .75 2H8v1.5H1.5v9h13V10H16v3.25a.75.75 0 0 1-.75.75H.75a.75.75 0 0 1-.75-.75zm12.987-.14a.75.75 0 0 0-1.474 0l-.137.728a1.93 1.93 0 0 1-1.538 1.538l-.727.137a.75.75 0 0 0 0 1.474l.727.137c.78.147 1.39.758 1.538 1.538l.137.727a.75.75 0 0 0 1.474 0l.137-.727c.147-.78.758-1.39 1.538-1.538l.727-.137a.75.75 0 0 0 0-1.474l-.727-.137a1.93 1.93 0 0 1-1.538-1.538z"
              clipRule="evenodd"
            />
    </svg>
  )
);
SparkleRectangleIcon.displayName = "SparkleRectangleIcon";
