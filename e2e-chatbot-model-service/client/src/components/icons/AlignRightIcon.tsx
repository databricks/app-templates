import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface AlignRightIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const AlignRightIcon = forwardRef<SVGSVGElement, AlignRightIconProps>(
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
              d="M1 2.5h14V1H1zM15 5.75H8v-1.5h7zM1 8.75v-1.5h14v1.5zM1 15v-1.5h14V15zM8 11.75h7v-1.5H8z"
            />
    </svg>
  )
);
AlignRightIcon.displayName = "AlignRightIcon";
