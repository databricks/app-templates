import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface FolderOpenCloudIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const FolderOpenCloudIcon = forwardRef<SVGSVGElement, FolderOpenCloudIconProps>(
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
              d="M10.39 7.313a3.487 3.487 0 0 1 3.47 3.153c1.247.288 2.14 1.412 2.14 2.73C16 14.728 14.795 16 13.23 16l-.066-.002-.036.002H7.65a.8.8 0 0 1-.173-.023 3.143 3.143 0 0 1-.43-6.171 3.49 3.49 0 0 1 3.342-2.493m0 1.5a1.99 1.99 0 0 0-1.974 1.742.75.75 0 0 1-.565.636l-.132.02a1.646 1.646 0 0 0-.015 3.285q.012.001.024.004h5.343a1 1 0 0 1 .093-.002l.066.002c.704 0 1.27-.567 1.27-1.304 0-.736-.566-1.303-1.27-1.303h-.102a.75.75 0 0 1-.75-.75V10.8c0-1.098-.89-1.988-1.988-1.989"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M15.249 5a.75.75 0 0 1 .66 1.11l-1.31 2.397C13.792 7.017 12.18 6 10.32 6 8.393 6 6.73 7.09 5.952 8.669c-1.377.595-2.388 1.84-2.617 3.331H.749l-.003-.001a1 1 0 0 1-.09-.006q-.008 0-.017-.003l-.055-.01a1 1 0 0 1-.12-.037l-.03-.015a.7.7 0 0 1-.212-.147l-.008-.008a1 1 0 0 1-.078-.094l-.014-.02q-.008-.014-.018-.026a1 1 0 0 1-.043-.088l-.01-.024a1 1 0 0 1-.04-.143l-.005-.034L0 11.27 0 11.264V.75L.004.673A.75.75 0 0 1 .75 0h3.922c.73 0 1.429.29 1.944.806L7.811 2h5.439l.077.004A.75.75 0 0 1 14 2.75V5zM12.5 5V3.5h-5a.75.75 0 0 1-.53-.22L5.556 1.866a1.25 1.25 0 0 0-.884-.366H1.5v6.807L3.09 5.39A.75.75 0 0 1 3.75 5z"
              clipRule="evenodd"
            />
    </svg>
  )
);
FolderOpenCloudIcon.displayName = "FolderOpenCloudIcon";
