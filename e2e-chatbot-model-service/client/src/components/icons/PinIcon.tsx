import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface PinIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const PinIcon = forwardRef<SVGSVGElement, PinIconProps>(
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
              d="M5.75 0A.75.75 0 0 0 5 .75v4.007a2.25 2.25 0 0 1-.659 1.591L2.22 8.47A.75.75 0 0 0 2 9v2.25c0 .414.336.75.75.75h4.5v4h1.5v-4h4.5a.75.75 0 0 0 .75-.75V9a.75.75 0 0 0-.22-.53L11.66 6.348A2.25 2.25 0 0 1 11 4.758V.75a.75.75 0 0 0-.75-.75zm.75 4.757V1.5h3v3.257a3.75 3.75 0 0 0 1.098 2.652L12.5 9.311V10.5h-9V9.31L5.402 7.41A3.75 3.75 0 0 0 6.5 4.757"
              clipRule="evenodd"
            />
    </svg>
  )
);
PinIcon.displayName = "PinIcon";
