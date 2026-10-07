import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface PageTopIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const PageTopIcon = forwardRef<SVGSVGElement, PageTopIconProps>(
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
              d="m1 12.97 1.06 1.06 5.97-5.97L14 14.03l1.06-1.06-7.03-7.03zM15.03 2.5V1h-14v1.5z"
              clipRule="evenodd"
            />
    </svg>
  )
);
PageTopIcon.displayName = "PageTopIcon";
