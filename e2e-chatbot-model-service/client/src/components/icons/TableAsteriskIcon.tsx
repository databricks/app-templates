import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface TableAsteriskIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const TableAsteriskIcon = forwardRef<SVGSVGElement, TableAsteriskIconProps>(
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
              d="m8.75 9.218 1.634-.531.463 1.426-1.634.53 1.01 1.391-1.213.882L8 11.526l-1.01 1.39-1.214-.882 1.01-1.39-1.634-.53.464-1.427 1.634.53V7.5h1.5z"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M14.25 1a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75H1.75a.75.75 0 0 1-.75-.75V1.75A.75.75 0 0 1 1.75 1zM2.5 13.5h11V7h-11zm0-8h11v-3h-11z"
              clipRule="evenodd"
            />
    </svg>
  )
);
TableAsteriskIcon.displayName = "TableAsteriskIcon";
