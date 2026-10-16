import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface AzHorizontalIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const AzHorizontalIcon = forwardRef<SVGSVGElement, AzHorizontalIconProps>(
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
              d="M4.346 4.5a.75.75 0 0 0-.695.468L1 11.5h1.619l.406-1h2.643l.406 1h1.619L5.04 4.968a.75.75 0 0 0-.695-.468M5.06 9H3.634l.712-1.756zM12.667 6H9V4.5h5.25a.75.75 0 0 1 .58 1.225L11.333 10H15v1.5H9.75a.75.75 0 0 1-.58-1.225z"
              clipRule="evenodd"
            />
    </svg>
  )
);
AzHorizontalIcon.displayName = "AzHorizontalIcon";
