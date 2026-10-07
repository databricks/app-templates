import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ZoomInIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ZoomInIcon = forwardRef<SVGSVGElement, ZoomInIconProps>(
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
      <path fill="currentColor" d="M8.75 7.25H11v1.5H8.75V11h-1.5V8.75H5v-1.5h2.25V5h1.5z" />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M8 1a7 7 0 1 0 4.39 12.453l2.55 2.55 1.06-1.06-2.55-2.55A7 7 0 0 0 8 1M2.5 8a5.5 5.5 0 1 1 11 0 5.5 5.5 0 0 1-11 0"
              clipRule="evenodd"
            />
    </svg>
  )
);
ZoomInIcon.displayName = "ZoomInIcon";
