import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface BoldIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const BoldIcon = forwardRef<SVGSVGElement, BoldIconProps>(
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
              d="M4.75 3a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h4.375a2.875 2.875 0 0 0 1.496-5.33A2.875 2.875 0 0 0 8.375 3zm.75 5.75v2.75h3.625a1.375 1.375 0 0 0 0-2.75zm2.877-1.5a1.375 1.375 0 0 0-.002-2.75H5.5v2.75z"
              clipRule="evenodd"
            />
    </svg>
  )
);
BoldIcon.displayName = "BoldIcon";
