import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CheckSmallIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CheckSmallIcon = forwardRef<SVGSVGElement, CheckSmallIconProps>(
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
              d="M12.03 6.03 7 11.06 3.97 8.03l1.06-1.06L7 8.94l3.97-3.97z"
              clipRule="evenodd"
            />
    </svg>
  )
);
CheckSmallIcon.displayName = "CheckSmallIcon";
