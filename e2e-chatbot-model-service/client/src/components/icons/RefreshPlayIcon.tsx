import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface RefreshPlayIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const RefreshPlayIcon = forwardRef<SVGSVGElement, RefreshPlayIconProps>(
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
              d="M8 1c1.878 0 3.583.74 4.84 1.943l.66.596V2H15v4h-4V4.5h1.326l-.491-.443-.009-.008-.01-.009a5.5 5.5 0 1 0 .083 7.839l1.064 1.057A7 7 0 1 1 8 1"
            />
            <path
              fill="currentColor"
              d="M6.375 5.186a.75.75 0 0 1 .75 0l3.75 2.165.083.055a.75.75 0 0 1-.083 1.243l-3.75 2.166A.75.75 0 0 1 6 10.165v-4.33a.75.75 0 0 1 .375-.65"
            />
    </svg>
  )
);
RefreshPlayIcon.displayName = "RefreshPlayIcon";
