import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface FolderOpenBranchIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const FolderOpenBranchIcon = forwardRef<SVGSVGElement, FolderOpenBranchIconProps>(
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
              d="M9 7a2 2 0 0 1 1.786 2.895l.074.135c.307.519.788.901 1.346 1.09A1.998 1.998 0 0 1 16 12a2 2 0 0 1-3.892.646A3.98 3.98 0 0 1 9.75 11.07v1.077a2 2 0 1 1-1.5 0v-1.294A1.999 1.999 0 0 1 9 7m0 6.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1m5-2a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1m-5-3a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M15.25 5a.75.75 0 0 1 .658 1.11l-1.33 2.438a3.52 3.52 0 0 0-2.082.29A3.5 3.5 0 1 0 6.551 11.5q-.235.23-.423.5H.75a1 1 0 0 1-.095-.007l-.011-.002a.8.8 0 0 1-.167-.045q-.025-.01-.048-.021a.7.7 0 0 1-.203-.139L.22 11.78l-.008-.01a.7.7 0 0 1-.097-.123l-.01-.014a1 1 0 0 1-.044-.088l-.01-.024a.8.8 0 0 1-.05-.24L0 11.263V.75L.004.673A.75.75 0 0 1 .75 0h3.922c.73 0 1.429.29 1.944.806L7.811 2h5.439l.077.004A.75.75 0 0 1 14 2.75V5zM12.5 5V3.5h-5a.75.75 0 0 1-.53-.22L5.556 1.866a1.25 1.25 0 0 0-.884-.366H1.5v6.809L3.092 5.39A.75.75 0 0 1 3.75 5z"
              clipRule="evenodd"
            />
    </svg>
  )
);
FolderOpenBranchIcon.displayName = "FolderOpenBranchIcon";
