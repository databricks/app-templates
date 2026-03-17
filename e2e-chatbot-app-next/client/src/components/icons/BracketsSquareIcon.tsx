import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface BracketsSquareIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const BracketsSquareIcon = forwardRef<SVGSVGElement, BracketsSquareIconProps>(
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
              d="M1 1.75A.75.75 0 0 1 1.75 1H5v1.5H2.5v11H5V15H1.75a.75.75 0 0 1-.75-.75zm12.5.75H11V1h3.25a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75H11v-1.5h2.5z"
              clipRule="evenodd"
            />
    </svg>
  )
);
BracketsSquareIcon.displayName = "BracketsSquareIcon";
