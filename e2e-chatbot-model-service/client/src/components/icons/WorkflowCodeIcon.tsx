import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface WorkflowCodeIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const WorkflowCodeIcon = forwardRef<SVGSVGElement, WorkflowCodeIconProps>(
  ({ size = 16, className, ariaLabel, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 17 17"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden={!ariaLabel}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      {...props}
    >
      <path
              fill="currentColor"
              d="m10.53 11.06-1.97 1.97L10.53 15l-1.06 1.06-3.03-3.03L9.47 10zM16.06 13.03l-3.03 3.03L11.97 15l1.97-1.97-1.97-1.97L13.03 10z"
            />
            <path
              fill="currentColor"
              d="M2.75 0c1.258 0 2.317.846 2.644 2h5.231a3.375 3.375 0 1 1 0 6.75h-.365L7 6.42 4.79 8l2.14 1.528-1.106 1.053L3.27 8.755a1.873 1.873 0 0 0 .106 3.745H5V14H3.375a3.375 3.375 0 0 1-.118-6.748L6.564 4.89l.102-.062a.75.75 0 0 1 .77.062l3.295 2.354a1.873 1.873 0 0 0-.106-3.744H5.394A2.749 2.749 0 0 1 0 2.75 2.75 2.75 0 0 1 2.75 0m0 1.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5"
            />
    </svg>
  )
);
WorkflowCodeIcon.displayName = "WorkflowCodeIcon";
