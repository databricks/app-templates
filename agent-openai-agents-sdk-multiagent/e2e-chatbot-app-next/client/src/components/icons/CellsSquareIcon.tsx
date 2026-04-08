import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CellsSquareIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CellsSquareIcon = forwardRef<SVGSVGElement, CellsSquareIconProps>(
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
              d="M1 1.75A.75.75 0 0 1 1.75 1h12.5a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75H1.75a.75.75 0 0 1-.75-.75zm1.5.75v4.75h4.75V2.5zm6.25 0v4.75h4.75V2.5zm-1.5 6.25H2.5v4.75h4.75zm1.5 4.75V8.75h4.75v4.75z"
              clipRule="evenodd"
            />
    </svg>
  )
);
CellsSquareIcon.displayName = "CellsSquareIcon";
