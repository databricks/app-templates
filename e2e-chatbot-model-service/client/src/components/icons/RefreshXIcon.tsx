import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface RefreshXIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const RefreshXIcon = forwardRef<SVGSVGElement, RefreshXIconProps>(
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
              d="M8 1c1.878 0 3.583.74 4.84 1.943l.66.596V2H15v4h-4V4.5h1.326l-.491-.443-.009-.008-.01-.009a5.5 5.5 0 1 0 .083 7.839l1.064 1.057A7 7 0 1 1 8 1"
            />
            <path
              fill="currentColor"
              d="M5 6.05 6.95 8 5 9.95 6.05 11 8 9.05 9.95 11 11 9.95 9.05 8 11 6.05 9.95 5 8 6.95 6.05 5z"
            />
    </svg>
  )
);
RefreshXIcon.displayName = "RefreshXIcon";
