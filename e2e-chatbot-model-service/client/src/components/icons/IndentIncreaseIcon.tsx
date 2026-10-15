import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface IndentIncreaseIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const IndentIncreaseIcon = forwardRef<SVGSVGElement, IndentIncreaseIconProps>(
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
              d="M16 2H0v1.5h16zM16 5.5H8V7h8zM16 9H8v1.5h8zM0 12.5V14h16v-1.5zM1.97 6.03l1.06-1.06L6.06 8l-3.03 3.03-1.06-1.06L3.94 8z"
            />
    </svg>
  )
);
IndentIncreaseIcon.displayName = "IndentIncreaseIcon";
