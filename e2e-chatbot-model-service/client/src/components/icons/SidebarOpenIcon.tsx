import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface SidebarOpenIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const SidebarOpenIcon = forwardRef<SVGSVGElement, SidebarOpenIconProps>(
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
              d="M14 2a2 2 0 0 1 2 2v8l-.01.204a2 2 0 0 1-1.786 1.785L14 14H2l-.204-.01A2 2 0 0 1 .01 12.203L0 12V4a2 2 0 0 1 2-2zM6.75 12.5H14a.5.5 0 0 0 .5-.5V4a.5.5 0 0 0-.5-.5H6.75z"
              clipRule="evenodd"
            />
    </svg>
  )
);
SidebarOpenIcon.displayName = "SidebarOpenIcon";
