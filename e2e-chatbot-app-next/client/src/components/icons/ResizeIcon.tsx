import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ResizeIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ResizeIcon = forwardRef<SVGSVGElement, ResizeIconProps>(
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
      <path fill="currentColor" fillRule="evenodd" d="M15 6.75H1v-1.5h14zm0 4.75H1V10h14z" clipRule="evenodd" />
    </svg>
  )
);
ResizeIcon.displayName = "ResizeIcon";
