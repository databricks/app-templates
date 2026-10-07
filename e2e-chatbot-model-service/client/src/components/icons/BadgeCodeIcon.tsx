import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface BadgeCodeIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const BadgeCodeIcon = forwardRef<SVGSVGElement, BadgeCodeIconProps>(
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
              d="m5.56 8.53 1.97 1.97-1.06 1.06-3.03-3.03L6.47 5.5l1.06 1.06zM10.49 8.53 8.52 6.56 9.58 5.5l3.03 3.03-3.03 3.03-1.06-1.06z"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M8 0a3.25 3.25 0 0 0-3 2H1.75a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h12.5a.75.75 0 0 0 .75-.75V2.75a.75.75 0 0 0-.75-.75H11a3.25 3.25 0 0 0-3-2M6.285 2.9a1.75 1.75 0 0 1 3.43 0c.07.349.378.6.735.6h3.05v10h-11v-10h3.05a.75.75 0 0 0 .735-.6"
              clipRule="evenodd"
            />
    </svg>
  )
);
BadgeCodeIcon.displayName = "BadgeCodeIcon";
