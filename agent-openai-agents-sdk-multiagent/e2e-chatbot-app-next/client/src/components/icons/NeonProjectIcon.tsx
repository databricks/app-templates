import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface NeonProjectIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const NeonProjectIcon = forwardRef<SVGSVGElement, NeonProjectIconProps>(
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
              d="M8 5.25a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5m0 1.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M8 0a2 2 0 0 1 1.84 2.78l3.379 3.378a2 2 0 1 1 0 3.683L9.84 13.219a2 2 0 1 1-3.683 0L2.78 9.84a2 2 0 1 1 0-3.683L6.158 2.78A2 2 0 0 1 8 0m.78 3.84a2 2 0 0 1-1.561 0L3.84 7.22a2 2 0 0 1 0 1.561l3.378 3.378a2 2 0 0 1 1.561 0l3.378-3.378a2 2 0 0 1 0-1.561z"
              clipRule="evenodd"
            />
    </svg>
  )
);
NeonProjectIcon.displayName = "NeonProjectIcon";
