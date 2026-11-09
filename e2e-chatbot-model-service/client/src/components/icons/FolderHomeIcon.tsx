import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface FolderHomeIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const FolderHomeIcon = forwardRef<SVGSVGElement, FolderHomeIconProps>(
  ({ size = 16, className, ariaLabel, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 16 20"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden={!ariaLabel}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      {...props}
    >
      <path
              fill="currentColor"
              d="M.75 4a.75.75 0 0 0-.75.75v10.5c0 .414.336.75.75.75h6.22v-1.5H1.5v-9h3.172c.331 0 .649.132.883.366L6.97 7.28c.14.141.331.22.53.22h7V10H16V6.75a.75.75 0 0 0-.75-.75H7.81L6.617 4.805A2.75 2.75 0 0 0 4.672 4z"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M12.457 9.906a.75.75 0 0 0-.914 0l-3.25 2.5A.75.75 0 0 0 8 13v4.25c0 .414.336.75.75.75h6.5a.75.75 0 0 0 .75-.75V13a.75.75 0 0 0-.293-.594zM9.5 16.5v-3.13l2.5-1.924 2.5 1.923V16.5h-1.75V14h-1.5v2.5z"
              clipRule="evenodd"
            />
    </svg>
  )
);
FolderHomeIcon.displayName = "FolderHomeIcon";
