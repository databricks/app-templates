import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface AlignCenterIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const AlignCenterIcon = forwardRef<SVGSVGElement, AlignCenterIconProps>(
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
              d="M1 2.5h14V1H1zM11.5 5.75h-7v-1.5h7zM15 8.75H1v-1.5h14zM15 15H1v-1.5h14zM4.5 11.75h7v-1.5h-7z"
            />
    </svg>
  )
);
AlignCenterIcon.displayName = "AlignCenterIcon";
