import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface PinCancelIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const PinCancelIcon = forwardRef<SVGSVGElement, PinCancelIconProps>(
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
              d="M5.75 0A.75.75 0 0 0 5 .75v1.19l9 9V9a.75.75 0 0 0-.22-.53l-2.12-2.122a2.25 2.25 0 0 1-.66-1.59V.75a.75.75 0 0 0-.75-.75zM10.94 12l2.53 2.53 1.06-1.06-11.5-11.5-1.06 1.06 2.772 2.773q-.157.301-.4.545L2.22 8.47A.75.75 0 0 0 2 9v2.25c0 .414.336.75.75.75h4.5v4h1.5v-4z"
            />
    </svg>
  )
);
PinCancelIcon.displayName = "PinCancelIcon";
