import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface StrikeThroughIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const StrikeThroughIcon = forwardRef<SVGSVGElement, StrikeThroughIconProps>(
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
              d="M7.784 4C6.6 4 5.75 4.736 5.75 5.72c0 .384.07.625.152.78.08.15.191.262.35.356.365.216.894.3 1.634.4l.07.01c.381.052.827.113 1.263.234H15V9H1V7.5h3.764a2.4 2.4 0 0 1-.188-.298c-.222-.421-.326-.916-.326-1.482 0-2.056 1.789-3.22 3.534-3.22 1.746 0 3.535 1.164 3.535 3.22h-1.5c0-.984-.85-1.72-2.035-1.72M4.257 10.5c.123 1.92 1.845 3 3.527 3s3.405-1.08 3.528-3H9.804c-.116.871-.925 1.5-2.02 1.5s-1.903-.629-2.02-1.5z"
            />
    </svg>
  )
);
StrikeThroughIcon.displayName = "StrikeThroughIcon";
