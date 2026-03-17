import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface PauseIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const PauseIcon = forwardRef<SVGSVGElement, PauseIconProps>(
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
      <path fill="currentColor" fillRule="evenodd" d="M10 12V4h1.5v8zm-5.5 0V4H6v8z" clipRule="evenodd" />
    </svg>
  )
);
PauseIcon.displayName = "PauseIcon";
