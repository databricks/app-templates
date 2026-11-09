import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface PipelineCodeIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const PipelineCodeIcon = forwardRef<SVGSVGElement, PipelineCodeIconProps>(
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
              d="m10.53 11.06-1.97 1.97L10.53 15l-1.06 1.06-3.03-3.03L9.47 10zM16.06 13.03l-3.03 3.03L11.97 15l1.97-1.97-1.97-1.97L13.03 10zM5 1a5.75 5.75 0 0 1 5.75 5.75V9h-1.5V6.75A4.25 4.25 0 0 0 5.5 2.53v2.793A1.75 1.75 0 0 1 6.75 7v2.25q.001.47.098.91l-1.196 1.204A5.7 5.7 0 0 1 5.25 9.25V7A.25.25 0 0 0 5 6.75H1.75A.75.75 0 0 1 1 6V1.75A.75.75 0 0 1 1.75 1zM2.5 5.25H4V2.5H2.5z"
            />
    </svg>
  )
);
PipelineCodeIcon.displayName = "PipelineCodeIcon";
