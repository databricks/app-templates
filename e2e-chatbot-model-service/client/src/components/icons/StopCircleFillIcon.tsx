import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface StopCircleFillIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const StopCircleFillIcon = forwardRef<SVGSVGElement, StopCircleFillIconProps>(
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
              fillRule="evenodd"
              d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16M6.125 5.5a.625.625 0 0 0-.625.625v3.75c0 .345.28.625.625.625h3.75c.345 0 .625-.28.625-.625v-3.75a.625.625 0 0 0-.625-.625z"
              clipRule="evenodd"
            />
    </svg>
  )
);
StopCircleFillIcon.displayName = "StopCircleFillIcon";
