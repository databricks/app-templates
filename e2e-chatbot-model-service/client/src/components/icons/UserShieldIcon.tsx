import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface UserShieldIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const UserShieldIcon = forwardRef<SVGSVGElement, UserShieldIconProps>(
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
              d="M8 3.5A2.75 2.75 0 1 1 8 9a2.75 2.75 0 0 1 0-5.5M8 5a1.25 1.25 0 1 0 0 2.5A1.25 1.25 0 0 0 8 5"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M13.25 1a.75.75 0 0 1 .75.75v7.465a5.75 5.75 0 0 1-2.724 4.889l-2.881 1.784a.75.75 0 0 1-.79 0l-2.881-1.784A5.75 5.75 0 0 1 2 9.214V1.75A.75.75 0 0 1 2.75 1zM8 11.5a5.9 5.9 0 0 0-3.078.884q.273.246.59.444L8 14.368l2.487-1.54q.317-.198.59-.444A5.9 5.9 0 0 0 8 11.5M3.5 9.215c0 .702.175 1.38.492 1.982A7.37 7.37 0 0 1 8 10c1.445 0 2.85.441 4.007 1.197.318-.602.493-1.28.493-1.982V2.5h-9z"
              clipRule="evenodd"
            />
    </svg>
  )
);
UserShieldIcon.displayName = "UserShieldIcon";
