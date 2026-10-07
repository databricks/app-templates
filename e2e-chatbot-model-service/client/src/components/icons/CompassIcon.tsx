import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CompassIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CompassIcon = forwardRef<SVGSVGElement, CompassIconProps>(
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
              d="M10.842 4.263a.75.75 0 0 1 .863 1l-1.664 4.346a.75.75 0 0 1-.432.432l-4.346 1.664a.75.75 0 0 1-.968-.968l1.664-4.346a.75.75 0 0 1 .432-.432l4.346-1.664zM6.296 9.704l2.465-.943-1.522-1.522z"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0m0 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13"
              clipRule="evenodd"
            />
    </svg>
  )
);
CompassIcon.displayName = "CompassIcon";
