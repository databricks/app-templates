import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface PlayIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const PlayIcon = forwardRef<SVGSVGElement, PlayIconProps>(
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
              d="M12.125 8.864a.75.75 0 0 0 0-1.3l-6-3.464A.75.75 0 0 0 5 4.75v6.928a.75.75 0 0 0 1.125.65z"
            />
    </svg>
  )
);
PlayIcon.displayName = "PlayIcon";
