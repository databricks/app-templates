import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface PipelineCubeIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const PipelineCubeIcon = forwardRef<SVGSVGElement, PipelineCubeIconProps>(
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
              d="M11.686 8.07c.199-.093.43-.093.629 0l3.24 1.494a1 1 0 0 1 .1.054l.02.015q.074.051.133.116.014.016.027.034l.037.05.018.028a.7.7 0 0 1 .082.189.8.8 0 0 1 .028.2v3.5a.75.75 0 0 1-.435.68l-3.242 1.496-.006.003-.002.002a.8.8 0 0 1-.156.05q-.009.001-.018.004l-.042.006q-.024.004-.048.007h-.102q-.024-.003-.049-.007l-.042-.006q-.009-.001-.018-.005a.8.8 0 0 1-.155-.05l-.01-.004-3.24-1.495A.75.75 0 0 1 8 13.75v-3.5a.8.8 0 0 1 .06-.293l.007-.019.025-.048.035-.057.037-.05.027-.034a.8.8 0 0 1 .133-.116l.022-.015a1 1 0 0 1 .098-.054zM9.5 13.27l1.75.807V12.23l-1.75-.807zm3.25-1.04v1.847l1.75-.807v-1.848zm-2.21-1.98 1.46.674 1.46-.674L12 9.575z"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M5 1a5.75 5.75 0 0 1 5.75 5.75v.175l-1.5.692V6.75A4.25 4.25 0 0 0 5.5 2.53v2.793A1.75 1.75 0 0 1 6.75 7v6.122a5.73 5.73 0 0 1-1.5-3.872V7A.25.25 0 0 0 5 6.75H1.75A.75.75 0 0 1 1 6V1.75A.75.75 0 0 1 1.75 1zM2.5 5.25H4V2.5H2.5z"
              clipRule="evenodd"
            />
    </svg>
  )
);
PipelineCubeIcon.displayName = "PipelineCubeIcon";
