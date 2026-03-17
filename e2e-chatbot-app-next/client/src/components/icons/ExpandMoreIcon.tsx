import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ExpandMoreIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ExpandMoreIcon = forwardRef<SVGSVGElement, ExpandMoreIconProps>(
  ({ size = 16, className, ariaLabel, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 16 17"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden={!ariaLabel}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      {...props}
    >
      <path
              fill="currentColor"
              d="m4 4.03 1.06 1.061 2.97-2.97L11 5.091l1.06-1.06L8.03 0zM12.06 12.091l-4.03 4.03L4 12.091l1.06-1.06L8.03 14 11 11.03z"
            />
    </svg>
  )
);
ExpandMoreIcon.displayName = "ExpandMoreIcon";
