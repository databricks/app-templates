import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface SidebarCollapseIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const SidebarCollapseIcon = forwardRef<SVGSVGElement, SidebarCollapseIconProps>(
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
              d="M1.75 1a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75H15v-1.5H5.5v-11H15V1zM4 2.5H2.5v11H4z"
              clipRule="evenodd"
            />
            <path fill="currentColor" d="m9.81 8.75 1.22 1.22-1.06 1.06L6.94 8l3.03-3.03 1.06 1.06-1.22 1.22H14v1.5z" />
    </svg>
  )
);
SidebarCollapseIcon.displayName = "SidebarCollapseIcon";
