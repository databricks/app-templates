import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface TextJustifyIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const TextJustifyIcon = forwardRef<SVGSVGElement, TextJustifyIconProps>(
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
              d="M15 15H1v-1.5h14zM15 11.75H1v-1.5h14zM15 8.75H1v-1.5h14zM15 5.75H1v-1.5h14zM15 2.5H1V1h14z"
            />
    </svg>
  )
);
TextJustifyIcon.displayName = "TextJustifyIcon";
