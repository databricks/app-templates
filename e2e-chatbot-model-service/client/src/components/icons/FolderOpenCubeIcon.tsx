import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface FolderOpenCubeIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const FolderOpenCubeIcon = forwardRef<SVGSVGElement, FolderOpenCubeIconProps>(
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
              d="M10.762 8.04a.75.75 0 0 1 .553.03l3.24 1.494a1 1 0 0 1 .1.054l.004.003.016.012.06.044q.039.034.073.072a.75.75 0 0 1 .192.501v3.5a.75.75 0 0 1-.435.68l-3.242 1.496-.006.003-.002.002a.8.8 0 0 1-.156.05q-.009.001-.018.004l-.042.006q-.024.004-.048.007h-.102q-.024-.003-.049-.007l-.042-.006q-.009-.001-.018-.005a.8.8 0 0 1-.155-.05l-.01-.004-3.24-1.495A.75.75 0 0 1 7 13.75v-3.5a.8.8 0 0 1 .06-.293l.007-.019.025-.048.035-.057.037-.05.027-.034a.8.8 0 0 1 .133-.116l.022-.015a1 1 0 0 1 .098-.054l3.241-1.495zM8.5 13.27l1.75.807V12.23l-1.75-.807zm3.25-1.04v1.847l1.75-.807v-1.848zm-2.21-1.98 1.46.674 1.46-.674L11 9.575z"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M4.672 0c.73 0 1.429.29 1.944.806L7.811 2h5.439l.077.004A.75.75 0 0 1 14 2.75V5h1.25a.75.75 0 0 1 .658 1.11l-1.04 1.908-2.762-1.275a2.64 2.64 0 0 0-2.212 0l-2.86 1.32A2.64 2.64 0 0 0 5.5 10.461V12H.75a1 1 0 0 1-.094-.007q-.008 0-.017-.003l-.055-.01a1 1 0 0 1-.12-.037l-.03-.015a.7.7 0 0 1-.208-.142L.22 11.78l-.008-.01a.7.7 0 0 1-.094-.119l-.013-.018a1 1 0 0 1-.044-.088l-.01-.024a1 1 0 0 1-.04-.143l-.005-.034L0 11.285 0 11.264V.75L.004.673A.75.75 0 0 1 .75 0zM1.5 8.309 3.092 5.39A.75.75 0 0 1 3.75 5h8.75V3.5h-5a.75.75 0 0 1-.53-.22L5.556 1.866a1.25 1.25 0 0 0-.884-.366H1.5z"
              clipRule="evenodd"
            />
    </svg>
  )
);
FolderOpenCubeIcon.displayName = "FolderOpenCubeIcon";
