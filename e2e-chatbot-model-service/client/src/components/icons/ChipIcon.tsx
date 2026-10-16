import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ChipIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ChipIcon = forwardRef<SVGSVGElement, ChipIconProps>(
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
      <path fill="currentColor" d="M10 10H6V6h4z" />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M7 3h2V1h1.5v2h1.75a.75.75 0 0 1 .75.75V5.5h2V7h-2v2h2v1.5h-2v1.75a.75.75 0 0 1-.75.75H10.5v2H9v-2H7v2H5.5v-2H3.75a.75.75 0 0 1-.75-.75V10.5H1V9h2V7H1V5.5h2V3.75A.75.75 0 0 1 3.75 3H5.5V1H7zm-2.5 8.5h7v-7h-7z"
              clipRule="evenodd"
            />
    </svg>
  )
);
ChipIcon.displayName = "ChipIcon";
