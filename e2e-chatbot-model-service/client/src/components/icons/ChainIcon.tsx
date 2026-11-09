import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ChainIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ChainIcon = forwardRef<SVGSVGElement, ChainIconProps>(
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
              d="m6.144 12.331.972-.972 1.06 1.06-.971.973a3.625 3.625 0 1 1-5.127-5.127l2.121-2.121A3.625 3.625 0 0 1 10.32 8H8.766a2.125 2.125 0 0 0-3.507-.795l-2.121 2.12a2.125 2.125 0 0 0 3.005 3.006"
            />
            <path
              fill="currentColor"
              d="m9.856 3.669-.972.972-1.06-1.06.971-.973a3.625 3.625 0 1 1 5.127 5.127l-2.121 2.121A3.625 3.625 0 0 1 5.68 8h1.552a2.125 2.125 0 0 0 3.507.795l2.121-2.12a2.125 2.125 0 0 0-3.005-3.006"
            />
    </svg>
  )
);
ChainIcon.displayName = "ChainIcon";
