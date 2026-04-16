import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface LockShareIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const LockShareIcon = forwardRef<SVGSVGElement, LockShareIconProps>(
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
              d="M13.962 6.513a3.24 3.24 0 0 0-2.057.987H3.5v6.95H8v1.5H2.75A.75.75 0 0 1 2 15.2V6.75A.75.75 0 0 1 2.75 6H4V4a4 4 0 1 1 8 0v2h1.25a.75.75 0 0 1 .712.513M10.5 4v2h-5V4a2.5 2.5 0 0 1 5 0"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              d="M11.5 12.036v-.072l1.671-.836a1.75 1.75 0 1 0-.67-1.342l-1.672.836a1.75 1.75 0 1 0 0 2.756l1.671.836v.036a1.75 1.75 0 1 0 .671-1.378z"
            />
    </svg>
  )
);
LockShareIcon.displayName = "LockShareIcon";
