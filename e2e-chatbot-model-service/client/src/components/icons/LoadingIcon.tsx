import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface LoadingIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const LoadingIcon = forwardRef<SVGSVGElement, LoadingIconProps>(
  ({ size = 16, className, ariaLabel, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
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
              d="M23.212 12a.79.79 0 0 1-.789-.788 9.6 9.6 0 0 0-.757-3.751 9.66 9.66 0 0 0-5.129-5.129 9.6 9.6 0 0 0-3.749-.755.788.788 0 0 1 0-1.577c1.513 0 2.983.296 4.365.882a11.1 11.1 0 0 1 3.562 2.403 11.157 11.157 0 0 1 3.283 7.927.785.785 0 0 1-.786.788"
              clipRule="evenodd"
            />
    </svg>
  )
);
LoadingIcon.displayName = "LoadingIcon";
