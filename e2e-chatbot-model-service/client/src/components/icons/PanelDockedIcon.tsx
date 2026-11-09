import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface PanelDockedIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const PanelDockedIcon = forwardRef<SVGSVGElement, PanelDockedIconProps>(
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
              d="M1.75 1a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75H14.3a.7.7 0 0 0 .7-.7V1.75a.75.75 0 0 0-.75-.75zM8 13.5V8.7a.7.7 0 0 1 .7-.7h4.8V2.5h-11v11z"
              clipRule="evenodd"
            />
    </svg>
  )
);
PanelDockedIcon.displayName = "PanelDockedIcon";
