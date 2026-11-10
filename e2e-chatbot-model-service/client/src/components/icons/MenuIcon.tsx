import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface MenuIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const MenuIcon = forwardRef<SVGSVGElement, MenuIconProps>(
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
              d="M15 4H1V2.5h14zm0 4.75H1v-1.5h14zm0 4.75H1V12h14z"
              clipRule="evenodd"
            />
    </svg>
  )
);
MenuIcon.displayName = "MenuIcon";
