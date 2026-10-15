import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface UsbIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const UsbIcon = forwardRef<SVGSVGElement, UsbIconProps>(
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
              d="M8 0a.75.75 0 0 1 .65.375l1.299 2.25a.75.75 0 0 1-.65 1.125H8.75V9.5h2.75V8h-.25a.75.75 0 0 1-.75-.75v-2a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 .75.75v2a.75.75 0 0 1-.75.75H13v2.25a.75.75 0 0 1-.75.75h-3.5v1.668a1.75 1.75 0 1 1-1.5 0V11h-3.5a.75.75 0 0 1-.75-.75V7.832a1.75 1.75 0 1 1 1.5 0V9.5h2.75V3.75h-.549a.75.75 0 0 1-.65-1.125l1.3-2.25A.75.75 0 0 1 8 0"
            />
    </svg>
  )
);
UsbIcon.displayName = "UsbIcon";
