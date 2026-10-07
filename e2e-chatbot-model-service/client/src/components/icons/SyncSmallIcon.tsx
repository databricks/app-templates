import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface SyncSmallIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const SyncSmallIcon = forwardRef<SVGSVGElement, SyncSmallIconProps>(
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
              d="M4.125 8.263c0 1.718 1.14 3.128 2.595 3.65 1.223.439 2.655.253 3.87-.795v1.504h1.285V8.666H7.751V9.99H9.89c-.913.862-1.93.965-2.747.672-1.004-.36-1.734-1.312-1.734-2.4zM4.125 7.334h4.124V6.01H6.11c.913-.862 1.93-.965 2.747-.672 1.004.36 1.734 1.312 1.734 2.4h1.284c0-1.72-1.14-3.129-2.596-3.651-1.223-.439-2.655-.253-3.87.795V3.378H4.124z"
            />
    </svg>
  )
);
SyncSmallIcon.displayName = "SyncSmallIcon";
