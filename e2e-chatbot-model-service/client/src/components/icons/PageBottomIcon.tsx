import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface PageBottomIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const PageBottomIcon = forwardRef<SVGSVGElement, PageBottomIconProps>(
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
              d="M1 3.06 2.06 2l5.97 5.97L14 2l1.06 1.06-7.03 7.031zm14.03 10.47v1.5h-14v-1.5z"
              clipRule="evenodd"
            />
    </svg>
  )
);
PageBottomIcon.displayName = "PageBottomIcon";
