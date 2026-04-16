import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface BackupIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const BackupIcon = forwardRef<SVGSVGElement, BackupIconProps>(
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
              d="M15.812 3.892v7.74a2.5 2.5 0 0 1-2.5 2.5h-9.1l-.255-.012a2.5 2.5 0 0 1-2.244-2.487V3.892l2-2.636h10.099zm-12.6 7.74a1 1 0 0 0 1 1h9.1a1 1 0 0 0 1-1V4.969h-11.1zm6.3-2.277 1.19-1.19 1.06 1.06-3 3.002L5.76 9.226l1.06-1.061 1.19 1.19v-3.86h1.5zM3.917 3.468h9.69l-.54-.712H4.458z"
            />
    </svg>
  )
);
BackupIcon.displayName = "BackupIcon";
