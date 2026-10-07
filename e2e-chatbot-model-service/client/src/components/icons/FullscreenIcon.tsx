import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface FullscreenIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const FullscreenIcon = forwardRef<SVGSVGElement, FullscreenIconProps>(
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
              d="M6 1H1.75a.75.75 0 0 0-.75.75V6h1.5V2.5H6zM10 2.5V1h4.25a.75.75 0 0 1 .75.75V6h-1.5V2.5zM10 13.5h3.5V10H15v4.25a.75.75 0 0 1-.75.75H10zM2.5 10v3.5H6V15H1.75a.75.75 0 0 1-.75-.75V10z"
            />
    </svg>
  )
);
FullscreenIcon.displayName = "FullscreenIcon";
