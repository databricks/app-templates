import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface LibrariesIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const LibrariesIcon = forwardRef<SVGSVGElement, LibrariesIconProps>(
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
      <path fill="currentColor" d="m8.301 1.522 5.25 13.5 1.398-.544-5.25-13.5zM1 15V1h1.5v14zM5 15V1h1.5v14z" />
    </svg>
  )
);
LibrariesIcon.displayName = "LibrariesIcon";
