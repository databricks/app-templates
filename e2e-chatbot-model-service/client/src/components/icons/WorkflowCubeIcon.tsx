import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface WorkflowCubeIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const WorkflowCubeIcon = forwardRef<SVGSVGElement, WorkflowCubeIconProps>(
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
              d="M11.686 8.07a.75.75 0 0 1 .629 0l3.25 1.5q.045.02.09.048a.8.8 0 0 1 .153.132l.029.036.033.044a.7.7 0 0 1 .116.286l.006.03a1 1 0 0 1 .008.104v3.5a.75.75 0 0 1-.435.68l-3.242 1.496-.006.003-.002.002-.013.005a.8.8 0 0 1-.253.062h-.099a.8.8 0 0 1-.252-.062l-.013-.005-.01-.005-3.24-1.495A.75.75 0 0 1 8 13.75v-3.5q0-.053.007-.104l.006-.03a.8.8 0 0 1 .047-.159l.007-.019.025-.048.015-.027.022-.033q.016-.023.033-.044l.03-.036a.8.8 0 0 1 .242-.18h.002zM9.5 13.27l1.75.807V12.23l-1.75-.807zm3.25-1.04v1.847l1.75-.807v-1.848zm-2.21-1.98 1.46.674 1.46-.674L12 9.575z"
            />
            <path
              fill="currentColor"
              d="M6.564 4.89a.75.75 0 0 1 .873 0l2.933 2.094-1.57.724L7 6.422 4.79 8l1.94 1.385c-.149.332-.23.698-.23 1.076v.602L3.268 8.756a1.873 1.873 0 0 0 .107 3.745H6.5v1.04q0 .235.042.46H3.375a3.375 3.375 0 0 1-.12-6.748z"
            />
            <path
              fill="currentColor"
              d="M2.75 0c1.258 0 2.317.846 2.644 2h5.231a3.375 3.375 0 0 1 2.974 4.97l-.493-.227a2.6 2.6 0 0 0-.986-.24A1.875 1.875 0 0 0 10.625 3.5H5.394A2.749 2.749 0 0 1 0 2.75 2.75 2.75 0 0 1 2.75 0m0 1.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5"
            />
    </svg>
  )
);
WorkflowCubeIcon.displayName = "WorkflowCubeIcon";
