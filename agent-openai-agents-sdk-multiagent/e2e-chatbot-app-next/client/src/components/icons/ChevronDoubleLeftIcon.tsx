import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ChevronDoubleLeftIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ChevronDoubleLeftIcon = forwardRef<SVGSVGElement, ChevronDoubleLeftIconProps>(
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
      <path fill="currentColor" d="M8.047 10.944 5.11 8l2.937-2.944-1.062-1.06L2.991 8l3.994 4.003z" />
            <path fill="currentColor" d="M12.008 10.944 9.07 8l2.938-2.944-1.062-1.06L6.952 8l3.994 4.003z" />
    </svg>
  )
);
ChevronDoubleLeftIcon.displayName = "ChevronDoubleLeftIcon";
