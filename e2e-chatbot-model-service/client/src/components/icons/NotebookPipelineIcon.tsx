import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface NotebookPipelineIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const NotebookPipelineIcon = forwardRef<SVGSVGElement, NotebookPipelineIconProps>(
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
              d="M3 1.75A.75.75 0 0 1 3.75 1h10.5a.75.75 0 0 1 .75.75V8h-1.5V2.5h-6v11h2V15H3.75a.75.75 0 0 1-.75-.75V12.5H1V11h2V8.75H1v-1.5h2V5H1V3.5h2zm1.5.75v11H6v-11z"
              clipRule="evenodd"
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
NotebookPipelineIcon.displayName = "NotebookPipelineIcon";
