import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface HashIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const HashIcon = forwardRef<SVGSVGElement, HashIconProps>(
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
              d="M11.67 5H15v1.5h-3.536l-.414 3H15V11h-4.156l-.552 4H8.777l.552-4H5.844l-.552 4H3.777l.552-4H1V9.5h3.535l.414-3H1V5h4.156l.552-4h1.515L6.67 5h3.485l.552-4h1.515zM6.05 9.5h3.485l.414-3H6.464z"
              clipRule="evenodd"
            />
    </svg>
  )
);
HashIcon.displayName = "HashIcon";
