import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface PositionRightIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const PositionRightIcon = forwardRef<SVGSVGElement, PositionRightIconProps>(
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
      <path fill="currentColor" d="M12 12h-2V4h2z" />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M14.25 1a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75H1.75a.75.75 0 0 1-.75-.75V1.75A.75.75 0 0 1 1.75 1zM2.5 13.5h11v-11h-11z"
              clipRule="evenodd"
            />
    </svg>
  )
);
PositionRightIcon.displayName = "PositionRightIcon";
