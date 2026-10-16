import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface LayerIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const LayerIcon = forwardRef<SVGSVGElement, LayerIconProps>(
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
      <path fill="currentColor" d="M13.5 2.5H7V1h7.25a.75.75 0 0 1 .75.75V9h-1.5z" />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M1 7.75A.75.75 0 0 1 1.75 7h6.5a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-.75.75h-6.5a.75.75 0 0 1-.75-.75zm1.5.75v5h5v-5z"
              clipRule="evenodd"
            />
            <path fill="currentColor" d="M4 5.32h6.5V12H12V4.57a.75.75 0 0 0-.75-.75H4z" />
    </svg>
  )
);
LayerIcon.displayName = "LayerIcon";
