import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface H5IconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const H5Icon = forwardRef<SVGSVGElement, H5IconProps>(
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
              d="M2.5 7.25H6V3h1.5v10H6V8.75H2.5V13H1V3h1.5zM14.5 4.5h-4v2.097a3.4 3.4 0 0 1 2.013-.27C13.803 6.55 15 7.556 15 9.25V10a3 3 0 0 1-6 0h1.5a1.5 1.5 0 0 0 3 0v-.75c0-.834-.539-1.324-1.244-1.446-.679-.118-1.381.133-1.756.71V8.5H9V3.75A.75.75 0 0 1 9.75 3h4.75z"
            />
    </svg>
  )
);
H5Icon.displayName = "H5Icon";
