import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface DomainsIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const DomainsIcon = forwardRef<SVGSVGElement, DomainsIconProps>(
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
              d="M6.25 3.25a1.75 1.75 0 1 1 3.5 0 1.75 1.75 0 0 1-3.5 0m-1.5 0a3.25 3.25 0 1 0 6.5 0 3.25 3.25 0 0 0-6.5 0M11 11.75a1.75 1.75 0 1 1 3.5 0 1.75 1.75 0 0 1-3.5 0m-1.5 0a3.25 3.25 0 1 0 6.5 0 3.25 3.25 0 0 0-6.5 0M1.5 11.75a1.75 1.75 0 1 1 3.5 0 1.75 1.75 0 0 1-3.5 0m-1.5 0a3.25 3.25 0 1 0 6.5 0 3.25 3.25 0 0 0-6.5 0"
            />
    </svg>
  )
);
DomainsIcon.displayName = "DomainsIcon";
