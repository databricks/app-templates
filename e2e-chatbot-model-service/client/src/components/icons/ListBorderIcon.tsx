import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ListBorderIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ListBorderIcon = forwardRef<SVGSVGElement, ListBorderIconProps>(
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
              d="M12 8.75H7v-1.5h5zM7 5.5h5V4H7zM12 12H7v-1.5h5zM4.75 5.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5M5.5 8A.75.75 0 1 1 4 8a.75.75 0 0 1 1.5 0M4.75 12a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M1 1.75A.75.75 0 0 1 1.75 1h12.5a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75H1.75a.75.75 0 0 1-.75-.75zm1.5.75v11h11v-11z"
              clipRule="evenodd"
            />
    </svg>
  )
);
ListBorderIcon.displayName = "ListBorderIcon";
