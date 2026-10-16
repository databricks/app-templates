import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ShieldIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ShieldIcon = forwardRef<SVGSVGElement, ShieldIconProps>(
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
              d="M2 1.75A.75.75 0 0 1 2.75 1h10.5a.75.75 0 0 1 .75.75v7.465a5.75 5.75 0 0 1-2.723 4.889l-2.882 1.784a.75.75 0 0 1-.79 0l-2.882-1.784A5.75 5.75 0 0 1 2 9.214zm1.5.75V7h3.75V2.5zm5.25 0V7h3.75V2.5zm3.75 6H8.75v5.404l1.737-1.076A4.25 4.25 0 0 0 12.5 9.215zm-5.25 5.404V8.5H3.5v.715a4.25 4.25 0 0 0 2.013 3.613z"
              clipRule="evenodd"
            />
    </svg>
  )
);
ShieldIcon.displayName = "ShieldIcon";
