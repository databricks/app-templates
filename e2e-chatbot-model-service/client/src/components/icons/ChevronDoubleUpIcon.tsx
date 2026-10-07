import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ChevronDoubleUpIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ChevronDoubleUpIcon = forwardRef<SVGSVGElement, ChevronDoubleUpIconProps>(
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
      <path fill="currentColor" d="M5.056 8.047 8 5.11l2.944 2.937 1.06-1.062L8 2.991 3.997 6.985z" />
            <path fill="currentColor" d="M5.056 12.008 8 9.07l2.944 2.937 1.06-1.062L8 6.952l-4.003 3.994z" />
    </svg>
  )
);
ChevronDoubleUpIcon.displayName = "ChevronDoubleUpIcon";
