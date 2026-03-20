import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ShareIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ShareIcon = forwardRef<SVGSVGElement, ShareIconProps>(
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
      <path fill="currentColor" d="M3.97 5.03 8 1l4.03 4.03-1.06 1.061-2.22-2.22v7.19h-1.5V3.87l-2.22 2.22z" />
            <path
              fill="currentColor"
              d="M2.5 13.56v-6.5H1v7.25c0 .415.336.75.75.75h12.5a.75.75 0 0 0 .75-.75V7.06h-1.5v6.5z"
            />
    </svg>
  )
);
ShareIcon.displayName = "ShareIcon";
