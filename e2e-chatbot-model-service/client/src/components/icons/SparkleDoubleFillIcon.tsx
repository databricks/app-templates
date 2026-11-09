import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface SparkleDoubleFillIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const SparkleDoubleFillIcon = forwardRef<SVGSVGElement, SparkleDoubleFillIconProps>(
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
              d="M4.739 9.622a.75.75 0 0 0-1.478 0l-.152.876a.75.75 0 0 1-.61.61l-.878.153a.75.75 0 0 0 0 1.478l.877.152a.75.75 0 0 1 .61.61l.153.878a.75.75 0 0 0 1.478 0l.152-.877a.75.75 0 0 1 .61-.61l.878-.153a.75.75 0 0 0 0-1.478l-.877-.152a.75.75 0 0 1-.61-.61zM10.737.611a.75.75 0 0 0-1.474 0l-.264 1.398A3.75 3.75 0 0 1 6.01 5l-1.398.264a.75.75 0 0 0 0 1.474l1.398.264A3.75 3.75 0 0 1 9 9.99l.264 1.398a.75.75 0 0 0 1.474 0l.264-1.398A3.75 3.75 0 0 1 13.99 7l1.398-.264a.75.75 0 0 0 0-1.474l-1.398-.264A3.75 3.75 0 0 1 11 2.01z"
              clipRule="evenodd"
            />
    </svg>
  )
);
SparkleDoubleFillIcon.displayName = "SparkleDoubleFillIcon";
