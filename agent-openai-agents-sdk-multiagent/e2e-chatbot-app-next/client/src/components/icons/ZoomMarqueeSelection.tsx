import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ZoomMarqueeSelectionProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ZoomMarqueeSelection = forwardRef<SVGSVGElement, ZoomMarqueeSelectionProps>(
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
              d="M1 1.75V4h1.5V2.5H4V1H1.75a.75.75 0 0 0-.75.75M14.25 1H12v1.5h1.5V4H15V1.75a.75.75 0 0 0-.75-.75M4 15H1.75a.75.75 0 0 1-.75-.75V12h1.5v1.5H4zM6 2.5h4V1H6zM1 10V6h1.5v4z"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M4.053 9.27a5.217 5.217 0 1 1 9.397 3.122l1.69 1.69-1.062 1.06-1.688-1.69A5.217 5.217 0 0 1 4.053 9.27M9.27 5.555a3.717 3.717 0 1 0 0 7.434 3.717 3.717 0 0 0 0-7.434"
              clipRule="evenodd"
            />
    </svg>
  )
);
ZoomMarqueeSelection.displayName = "ZoomMarqueeSelection";
