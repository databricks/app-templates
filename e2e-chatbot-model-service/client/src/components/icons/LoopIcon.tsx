import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface LoopIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const LoopIcon = forwardRef<SVGSVGElement, LoopIconProps>(
  ({ size = 16, className, ariaLabel, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 16 17"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden={!ariaLabel}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      {...props}
    >
      <path
              fill="currentColor"
              d="M3.75 2A2.75 2.75 0 0 0 1 4.75v6.5A2.75 2.75 0 0 0 3.75 14H5.5v-1.5H3.75c-.69 0-1.25-.56-1.25-1.25v-6.5c0-.69.56-1.25 1.25-1.25h8.5c.69 0 1.25.56 1.25 1.25v6.5c0 .69-.56 1.25-1.25 1.25H9.81l.97-.97-1.06-1.06-2.78 2.78 2.78 2.78 1.06-1.06-.97-.97h2.44A2.75 2.75 0 0 0 15 11.25v-6.5A2.75 2.75 0 0 0 12.25 2z"
            />
    </svg>
  )
);
LoopIcon.displayName = "LoopIcon";
