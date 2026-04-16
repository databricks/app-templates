import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface SidebarSyncIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const SidebarSyncIcon = forwardRef<SVGSVGElement, SidebarSyncIconProps>(
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
              d="M1 3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3.5a.5.5 0 0 1-.5.5H14a.5.5 0 0 1-.5-.5v-3H5v9h2.5a.5.5 0 0 1 .5.5v.5a.5.5 0 0 1-.5.5H2a1 1 0 0 1-1-1zm3 1.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0 0 1h1a.5.5 0 0 0 .5-.5m0 2a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0 0 1h1a.5.5 0 0 0 .5-.5"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              d="M12 8c.794 0 1.525.282 2.082.752a.627.627 0 0 1-.809.958A1.97 1.97 0 0 0 12 9.253c-.415 0-.794.124-1.102.33h.263a.627.627 0 0 1 0 1.253H9.626A.627.627 0 0 1 9 10.209V8.626a.626.626 0 0 1 1.241-.11A3.24 3.24 0 0 1 12 8m3 5.374a.627.627 0 0 1-1.242.108A3.23 3.23 0 0 1 12 14a3.22 3.22 0 0 1-2.082-.753.627.627 0 0 1 .809-.957c.333.281.778.457 1.273.457.415 0 .794-.124 1.102-.33h-.263a.626.626 0 0 1 0-1.253h1.535c.345 0 .626.281.626.627z"
            />
    </svg>
  )
);
SidebarSyncIcon.displayName = "SidebarSyncIcon";
