import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface DagVerticalIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const DagVerticalIcon = forwardRef<SVGSVGElement, DagVerticalIconProps>(
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
              d="M4.5 2.75A.75.75 0 0 1 5.25 2h5.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-.75.75h-.564l2.571 2h2.493a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-.75.75h-5.5a.75.75 0 0 1-.75-.75v-3.5A.75.75 0 0 1 9.75 9h.564L8 7.2 5.686 9h.564a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-.75.75H.75a.75.75 0 0 1-.75-.75v-3.5A.75.75 0 0 1 .75 9h2.493l2.571-2H5.25a.75.75 0 0 1-.75-.75zM6 3.5v2h4v-2zm-4.5 7v2h4v-2zm9 0v2h4v-2z"
              clipRule="evenodd"
            />
    </svg>
  )
);
DagVerticalIcon.displayName = "DagVerticalIcon";
