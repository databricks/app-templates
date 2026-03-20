import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface AlignJustifyIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const AlignJustifyIcon = forwardRef<SVGSVGElement, AlignJustifyIconProps>(
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
              d="M1 2.5h14V1H1zm14 3.25H1v-1.5h14zm-14 3v-1.5h14v1.5zM1 15v-1.5h14V15zm0-3.25h14v-1.5H1z"
            />
    </svg>
  )
);
AlignJustifyIcon.displayName = "AlignJustifyIcon";
