import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface InfinityIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const InfinityIcon = forwardRef<SVGSVGElement, InfinityIconProps>(
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
              d="m8 6.94 1.59-1.592a3.75 3.75 0 1 1 0 5.304L8 9.06l-1.591 1.59a3.75 3.75 0 1 1 0-5.303zm2.652-.531a2.25 2.25 0 1 1 0 3.182L9.06 8zM6.939 8 5.35 6.409a2.25 2.25 0 1 0 0 3.182l1.588-1.589z"
              clipRule="evenodd"
            />
    </svg>
  )
);
InfinityIcon.displayName = "InfinityIcon";
