import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ImageIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ImageIcon = forwardRef<SVGSVGElement, ImageIconProps>(
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
              d="M6.25 3.998a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5m-.75 2.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M1 1.75A.75.75 0 0 1 1.75 1h12.5a.75.75 0 0 1 .75.75v12.492a.75.75 0 0 1-.75.75H5.038l-.009.009-.008-.009H1.75a.75.75 0 0 1-.75-.75zm12.5 11.742H6.544l4.455-4.436 2.47 2.469.031-.03zm0-10.992v6.934l-1.97-1.968a.75.75 0 0 0-1.06-.001l-6.052 6.027H2.5V2.5z"
              clipRule="evenodd"
            />
    </svg>
  )
);
ImageIcon.displayName = "ImageIcon";
