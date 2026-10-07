import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ReaderModeIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ReaderModeIcon = forwardRef<SVGSVGElement, ReaderModeIconProps>(
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
      <path fill="currentColor" d="M13 4.5h-3V6h3zM13 7.25h-3v1.5h3zM13 10h-3v1.5h3z" />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M.75 2a.75.75 0 0 0-.75.75v10.5c0 .414.336.75.75.75h14.5a.75.75 0 0 0 .75-.75V2.75a.75.75 0 0 0-.75-.75zm.75 10.5v-9h5.75v9zm7.25 0h5.75v-9H8.75z"
              clipRule="evenodd"
            />
    </svg>
  )
);
ReaderModeIcon.displayName = "ReaderModeIcon";
