import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface TableViewIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const TableViewIcon = forwardRef<SVGSVGElement, TableViewIconProps>(
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
      <g fill="currentColor" fillRule="evenodd" clipPath="url(#TableViewIcon_svg__a)" clipRule="evenodd">
              <path d="M1.75 1a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75H4v-1.5H2.5V7H5v2h1.5V7h3v2H11V7h2.5v2H15V1.75a.75.75 0 0 0-.75-.75zM13.5 5.5v-3h-11v3z" />
              <path d="M11.75 10a.75.75 0 0 0-.707.5H9.957a.75.75 0 0 0-.707-.5h-3.5a.75.75 0 0 0-.75.75v1.75a2.5 2.5 0 0 0 5 0V12h1v.5a2.5 2.5 0 0 0 5 0v-1.75a.75.75 0 0 0-.75-.75zm.75 2.5v-1h2v1a1 1 0 1 1-2 0m-6-1v1a1 1 0 1 0 2 0v-1z" />
            </g>
            <defs>
              <clipPath>
                <path fill="#fff" d="M0 0h16v16H0z" />
              </clipPath>
            </defs>
    </svg>
  )
);
TableViewIcon.displayName = "TableViewIcon";
