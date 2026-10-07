import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CommandIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CommandIcon = forwardRef<SVGSVGElement, CommandIconProps>(
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
              d="M6.75 3.875A2.875 2.875 0 1 0 3.875 6.75H5.25v2.5H3.875a2.875 2.875 0 1 0 2.875 2.875V10.75h2.5v1.375a2.875 2.875 0 1 0 2.875-2.875H10.75v-2.5h1.375A2.875 2.875 0 1 0 9.25 3.875V5.25h-2.5zm0 5.375h2.5v-2.5h-2.5zm-1.5 1.5H3.875a1.375 1.375 0 1 0 1.375 1.375zm0-6.875V5.25H3.875A1.375 1.375 0 1 1 5.25 3.875m5.5 6.875v1.375a1.375 1.375 0 1 0 1.375-1.375zm1.375-5.5H10.75V3.875a1.375 1.375 0 1 1 1.375 1.375"
              clipRule="evenodd"
            />
    </svg>
  )
);
CommandIcon.displayName = "CommandIcon";
