import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface MoonIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const MoonIcon = forwardRef<SVGSVGElement, MoonIconProps>(
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
              d="M5.25 5c0-.682.119-1.336.337-1.943a5.5 5.5 0 1 0 7.354 7.355A5.75 5.75 0 0 1 5.25 5m1.5 0a4.25 4.25 0 0 0 6.962 3.271.75.75 0 0 1 1.222.678A7 7 0 1 1 7.05 1.065l.114-.006a.75.75 0 0 1 .564 1.228A4.23 4.23 0 0 0 6.75 5"
            />
    </svg>
  )
);
MoonIcon.displayName = "MoonIcon";
