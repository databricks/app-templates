import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface H1IconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const H1Icon = forwardRef<SVGSVGElement, H1IconProps>(
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
              d="M1 3v10h1.5V8.75H6V13h1.5V3H6v4.25H2.5V3zM11.25 3A2.25 2.25 0 0 1 9 5.25v1.5c.844 0 1.623-.279 2.25-.75v5.5H9V13h6v-1.5h-2.25V3z"
            />
    </svg>
  )
);
H1Icon.displayName = "H1Icon";
