import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ZaHorizontalIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ZaHorizontalIcon = forwardRef<SVGSVGElement, ZaHorizontalIconProps>(
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
              d="M11.654 4.5a.75.75 0 0 1 .695.468L15 11.5h-1.619l-.406-1h-2.643l-.406 1H8.307l2.652-6.532a.75.75 0 0 1 .695-.468M10.94 9h1.425l-.712-1.756zM4.667 6H1V4.5h5.25a.75.75 0 0 1 .58 1.225L3.333 10H7v1.5H1.75a.75.75 0 0 1-.58-1.225z"
              clipRule="evenodd"
            />
    </svg>
  )
);
ZaHorizontalIcon.displayName = "ZaHorizontalIcon";
