import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface LeafIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const LeafIcon = forwardRef<SVGSVGElement, LeafIconProps>(
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
              d="M5 6a2.75 2.75 0 0 0 2.75 2.75h2.395a2 2 0 1 0 0-1.5H7.75C7.06 7.25 6.5 6.69 6.5 6V2H5zm6.5 2a.5.5 0 1 1 1 0 .5.5 0 0 1-1 0"
              clipRule="evenodd"
            />
    </svg>
  )
);
LeafIcon.displayName = "LeafIcon";
