import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface FullscreenExitIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const FullscreenExitIcon = forwardRef<SVGSVGElement, FullscreenExitIconProps>(
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
              d="M6 1v4.25a.75.75 0 0 1-.75.75H1V4.5h3.5V1zM10 15v-4.25a.75.75 0 0 1 .75-.75H15v1.5h-3.5V15zM10.75 6H15V4.5h-3.5V1H10v4.25c0 .414.336.75.75.75M1 10h4.25a.75.75 0 0 1 .75.75V15H4.5v-3.5H1z"
            />
    </svg>
  )
);
FullscreenExitIcon.displayName = "FullscreenExitIcon";
