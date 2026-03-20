import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CaretUpSquareIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CaretUpSquareIcon = forwardRef<SVGSVGElement, CaretUpSquareIconProps>(
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
              d="M8 5.75a.75.75 0 0 1 .59.286l2.164 2.75A.75.75 0 0 1 10.165 10h-4.33a.75.75 0 0 1-.59-1.214l2.166-2.75A.75.75 0 0 1 8 5.75"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M1.75 1a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h12.5a.75.75 0 0 0 .75-.75V1.75a.75.75 0 0 0-.75-.75zm.75 12.5v-11h11v11z"
              clipRule="evenodd"
            />
    </svg>
  )
);
CaretUpSquareIcon.displayName = "CaretUpSquareIcon";
