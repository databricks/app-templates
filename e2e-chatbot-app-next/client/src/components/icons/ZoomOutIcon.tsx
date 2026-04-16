import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ZoomOutIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ZoomOutIcon = forwardRef<SVGSVGElement, ZoomOutIconProps>(
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
      <path fill="currentColor" d="M11 7.25H5v1.5h6z" />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M1 8a7 7 0 1 1 12.45 4.392l2.55 2.55-1.06 1.061-2.55-2.55A7 7 0 0 1 1 8m7-5.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11"
              clipRule="evenodd"
            />
    </svg>
  )
);
ZoomOutIcon.displayName = "ZoomOutIcon";
