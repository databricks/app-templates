import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface LockIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const LockIcon = forwardRef<SVGSVGElement, LockIconProps>(
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
      <path fill="currentColor" d="M7.25 9v4h1.5V9z" />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M12 6V4a4 4 0 0 0-8 0v2H2.75a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h10.5a.75.75 0 0 0 .75-.75v-8.5a.75.75 0 0 0-.75-.75zm.5 1.5v7h-9v-7zM5.5 4v2h5V4a2.5 2.5 0 0 0-5 0"
              clipRule="evenodd"
            />
    </svg>
  )
);
LockIcon.displayName = "LockIcon";
