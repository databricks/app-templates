import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface TableCombineIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const TableCombineIcon = forwardRef<SVGSVGElement, TableCombineIconProps>(
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
              d="M11.327 1.004A.75.75 0 0 1 12 1.75V5.5H5.5V12H1.75l-.077-.004a.75.75 0 0 1-.67-.669L1 11.25v-9.5a.75.75 0 0 1 .673-.746L1.75 1h9.5zM2.5 5.5v5H4v-5zm0-1.5h8V2.5h-8z"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M14.327 4.004A.75.75 0 0 1 15 4.75v9.5l-.004.077a.75.75 0 0 1-.669.67L14.25 15h-9.5l-.077-.004a.75.75 0 0 1-.67-.669L4 14.25v-9.5a.75.75 0 0 1 .673-.746L4.75 4h9.5zM5.5 13.5H7v-5H5.5zm6.5 0h1.5v-5H12zm-3.5 0h2v-5h-2zM5.5 7h8V5.5h-8z"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M11.327 1.004A.75.75 0 0 1 12 1.75V4h2.25l.077.004A.75.75 0 0 1 15 4.75v9.5l-.004.077a.75.75 0 0 1-.669.67L14.25 15h-9.5l-.077-.004a.75.75 0 0 1-.67-.669L4 14.25V12H1.75l-.077-.004a.75.75 0 0 1-.67-.669L1 11.25v-9.5a.75.75 0 0 1 .673-.746L1.75 1h9.5zM5.5 13.5H7v-5H5.5zm3 0h2v-5h-2zm3.5 0h1.5v-5H12zm-9.5-3H4v-5H2.5zm3-3.5h8V5.5h-8zm-3-3h8V2.5h-8z"
              clipRule="evenodd"
            />
    </svg>
  )
);
TableCombineIcon.displayName = "TableCombineIcon";
