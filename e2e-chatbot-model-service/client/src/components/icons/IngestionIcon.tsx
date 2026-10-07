import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface IngestionIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const IngestionIcon = forwardRef<SVGSVGElement, IngestionIconProps>(
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
              d="M15 2.5a.75.75 0 0 0-.75-.75h-3a.75.75 0 0 0-.75.75V6H12V3.25h1.5v9.5H12V10h-1.5v3.5c0 .414.336.75.75.75h3a.75.75 0 0 0 .75-.75z"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M3.75 0c1.26 0 2.322.848 2.648 2.004A2.75 2.75 0 0 1 9 4.75v2.5h3v1.5H9v2.5a2.75 2.75 0 0 1-2.602 2.746 2.751 2.751 0 1 1-3.47-3.371 2.751 2.751 0 0 1 0-5.25A2.751 2.751 0 0 1 3.75 0M5 2.75a1.25 1.25 0 1 0-2.5 0 1.25 1.25 0 0 0 2.5 0m-.428 2.625a2.76 2.76 0 0 0 1.822-1.867A1.25 1.25 0 0 1 7.5 4.75v2.5H6.396a2.76 2.76 0 0 0-1.824-1.875M6.396 8.75H7.5v2.5a1.25 1.25 0 0 1-1.106 1.242 2.76 2.76 0 0 0-1.822-1.867A2.76 2.76 0 0 0 6.396 8.75M3.75 12a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5m0-5.25a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5"
              clipRule="evenodd"
            />
    </svg>
  )
);
IngestionIcon.displayName = "IngestionIcon";
