import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface DomainCirclesThreeProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const DomainCirclesThree = forwardRef<SVGSVGElement, DomainCirclesThreeProps>(
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
              d="M11.75 13.375a2.625 2.625 0 1 0 0-5.25 2.625 2.625 0 0 0 0 5.25m0-1.25a1.375 1.375 0 1 0 0-2.75 1.375 1.375 0 0 0 0 2.75M4.25 13.375a2.625 2.625 0 1 0 0-5.25 2.625 2.625 0 0 0 0 5.25m0-1.25a1.375 1.375 0 1 0 0-2.75 1.375 1.375 0 0 0 0 2.75M8 7.375a2.625 2.625 0 1 0 0-5.25 2.625 2.625 0 0 0 0 5.25m0-1.25a1.375 1.375 0 1 0 0-2.75 1.375 1.375 0 0 0 0 2.75"
              clipRule="evenodd"
            />
    </svg>
  )
);
DomainCirclesThree.displayName = "DomainCirclesThree";
