import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface TargetIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const TargetIcon = forwardRef<SVGSVGElement, TargetIconProps>(
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
              d="M2.5 11v2.5H5V15H1.75a.75.75 0 0 1-.75-.75V11zM15 14.25a.75.75 0 0 1-.75.75H11v-1.5h2.5V11H15zM14.25 1a.75.75 0 0 1 .75.75V5h-1.5V2.5H11V1zM5 2.5H2.5V5H1V1.75A.75.75 0 0 1 1.75 1H5z"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M8.75 5.098a3 3 0 0 1 2.152 2.152H12.5v1.5h-1.598a3 3 0 0 1-2.152 2.151V12.5h-1.5v-1.599a3 3 0 0 1-2.153-2.156H3.5v-1.5h1.6a3 3 0 0 1 2.15-2.147V3.5h1.5zM8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3"
              clipRule="evenodd"
            />
    </svg>
  )
);
TargetIcon.displayName = "TargetIcon";
