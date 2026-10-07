import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ChevronDoubleRightIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ChevronDoubleRightIcon = forwardRef<SVGSVGElement, ChevronDoubleRightIconProps>(
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
      <path fill="currentColor" d="m7.954 5.056 2.937 2.946-2.937 2.945 1.062 1.059 3.993-4.004-3.993-4.005z" />
            <path fill="currentColor" d="m3.994 5.056 2.937 2.946-2.937 2.945 1.062 1.059L9.05 8.002 5.056 3.997z" />
    </svg>
  )
);
ChevronDoubleRightIcon.displayName = "ChevronDoubleRightIcon";
