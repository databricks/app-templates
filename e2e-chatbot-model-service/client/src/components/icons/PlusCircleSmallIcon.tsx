import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface PlusCircleSmallIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const PlusCircleSmallIcon = forwardRef<SVGSVGElement, PlusCircleSmallIconProps>(
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
      <path fill="currentColor" d="M8.5 7h2.25v1.5H8.5v2.25H7V8.5H4.75V7H7V4.75h1.5z" />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M7.75 1a6.75 6.75 0 1 1 0 13.5 6.75 6.75 0 0 1 0-13.5m0 1.5a5.25 5.25 0 1 0 0 10.5 5.25 5.25 0 0 0 0-10.5"
              clipRule="evenodd"
            />
    </svg>
  )
);
PlusCircleSmallIcon.displayName = "PlusCircleSmallIcon";
