import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ZoomToFitIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ZoomToFitIcon = forwardRef<SVGSVGElement, ZoomToFitIconProps>(
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
              d="m2.5 3.56 2.97 2.97 1.06-1.06L3.56 2.5H6V1H1v5h1.5zM10.53 6.53l2.97-2.97V6H15V1h-5v1.5h2.44L9.47 5.47zM9.47 10.53l2.97 2.97H10V15h5v-5h-1.5v2.44l-2.97-2.97zM5.47 9.47 2.5 12.44V10H1v5h5v-1.5H3.56l2.97-2.97z"
            />
    </svg>
  )
);
ZoomToFitIcon.displayName = "ZoomToFitIcon";
