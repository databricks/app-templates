import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface FolderSolidPipelineIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const FolderSolidPipelineIcon = forwardRef<SVGSVGElement, FolderSolidPipelineIconProps>(
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
              d="M.75 2a.75.75 0 0 0-.75.75v10.5c0 .414.336.75.75.75h8.166l-.01-.026A2.25 2.25 0 0 1 7 11.75v-2.5A2.25 2.25 0 0 1 9.25 7h1.25a5 5 0 0 1 4.595 3.026c.33.051.638.174.905.353V4.75a.75.75 0 0 0-.75-.75H7.81L6.617 2.805A2.75 2.75 0 0 0 4.672 2z"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M9.25 8.5a.75.75 0 0 0-.75.75v2.5c0 .414.336.75.75.75h.785a3.5 3.5 0 0 0 3.465 3h1.25a.75.75 0 0 0 .75-.75v-2.5a.75.75 0 0 0-.75-.75h-.785a3.5 3.5 0 0 0-3.465-3zM10 11v-1h.5a2 2 0 0 1 2 2 1 1 0 0 0 1 1h.5v1h-.5a2 2 0 0 1-2-2 1 1 0 0 0-1-1z"
              clipRule="evenodd"
            />
    </svg>
  )
);
FolderSolidPipelineIcon.displayName = "FolderSolidPipelineIcon";
