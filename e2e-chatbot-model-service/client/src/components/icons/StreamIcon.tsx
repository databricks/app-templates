import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface StreamIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const StreamIcon = forwardRef<SVGSVGElement, StreamIconProps>(
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
              d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0M1.52 7.48a6.5 6.5 0 0 1 12.722-1.298l-.09-.091a3.75 3.75 0 0 0-5.304 0L6.091 8.848a2.25 2.25 0 0 1-3.182 0L1.53 7.47zm.238 2.338A6.5 6.5 0 0 0 14.48 8.52l-.01.01-1.379-1.378a2.25 2.25 0 0 0-3.182 0L7.152 9.909a3.75 3.75 0 0 1-5.304 0z"
              clipRule="evenodd"
            />
    </svg>
  )
);
StreamIcon.displayName = "StreamIcon";
