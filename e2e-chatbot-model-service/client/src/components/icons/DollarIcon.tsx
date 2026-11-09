import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface DollarIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const DollarIcon = forwardRef<SVGSVGElement, DollarIconProps>(
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
              d="M8.75 4.75h1.75v1.5H7a.5.5 0 0 0 0 1h2a2 2 0 1 1 0 4h-.25v1.25h-1.5v-1.25H5.5v-1.5H9a.5.5 0 0 0 0-1H7a2 2 0 1 1 0-4h.25V3.5h1.5z"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M12.25 1A2.75 2.75 0 0 1 15 3.75v8.5A2.75 2.75 0 0 1 12.25 15h-8.5A2.75 2.75 0 0 1 1 12.25v-8.5A2.75 2.75 0 0 1 3.75 1zm-8.5 1.5c-.69 0-1.25.56-1.25 1.25v8.5c0 .69.56 1.25 1.25 1.25h8.5c.69 0 1.25-.56 1.25-1.25v-8.5c0-.69-.56-1.25-1.25-1.25z"
              clipRule="evenodd"
            />
    </svg>
  )
);
DollarIcon.displayName = "DollarIcon";
