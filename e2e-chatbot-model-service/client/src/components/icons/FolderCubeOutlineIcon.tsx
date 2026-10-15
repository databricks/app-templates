import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface FolderCubeOutlineIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const FolderCubeOutlineIcon = forwardRef<SVGSVGElement, FolderCubeOutlineIconProps>(
  ({ size = 16, className, ariaLabel, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 17 16"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden={!ariaLabel}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      {...props}
    >
      <path
              fill="currentColor"
              d="M.75 2a.75.75 0 0 0-.75.75v10.5c0 .414.336.75.75.75H7.5v-1.5h-6v-9h3.172c.331 0 .649.132.883.366L6.97 5.28c.14.141.331.22.53.22h7V8H16V4.75a.75.75 0 0 0-.75-.75H7.81L6.617 2.805A2.75 2.75 0 0 0 4.672 2z"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M12.762 8.039a.75.75 0 0 1 .553.03l3.25 1.5q.045.02.09.049l.004.003.031.023q.023.015.044.033.059.05.106.11a.75.75 0 0 1 .16.463v3.5a.75.75 0 0 1-.436.68l-3.24 1.495-.007.003-.002.002-.013.005a.8.8 0 0 1-.251.063h-.102a.8.8 0 0 1-.25-.063l-.014-.005-.01-.005-3.24-1.495A.75.75 0 0 1 9 13.75v-3.5q0-.053.007-.104l.006-.03a.8.8 0 0 1 .047-.16l.007-.018.025-.049.017-.028.01-.016.023-.035.024-.03a.8.8 0 0 1 .162-.15l.018-.012a1 1 0 0 1 .088-.049h.002l3.25-1.5zm-2.262 5.23 1.75.808v-1.848l-1.75-.807zm3.25-1.04v1.848l1.75-.808v-1.847zm-2.21-1.98 1.46.675 1.46-.674L13 9.575z"
              clipRule="evenodd"
            />
    </svg>
  )
);
FolderCubeOutlineIcon.displayName = "FolderCubeOutlineIcon";
