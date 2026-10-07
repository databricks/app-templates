import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface UserGroupFillIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const UserGroupFillIcon = forwardRef<SVGSVGElement, UserGroupFillIconProps>(
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
              d="M2.25 3.75a2.75 2.75 0 1 1 5.5 0 2.75 2.75 0 0 1-5.5 0M9.502 14H.75a.75.75 0 0 1-.75-.75V11a.75.75 0 0 1 .164-.469C1.298 9.115 3.077 8 5.125 8c1.76 0 3.32.822 4.443 1.952A5.55 5.55 0 0 1 11.75 9.5c1.642 0 3.094.745 4.041 1.73a.75.75 0 0 1 .209.52v1.5a.75.75 0 0 1-.75.75zM11.75 3.5a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5"
            />
    </svg>
  )
);
UserGroupFillIcon.displayName = "UserGroupFillIcon";
