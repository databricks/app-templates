import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface RunIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const RunIcon = forwardRef<SVGSVGElement, RunIconProps>(
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
              d="M15 13.225 12.232 16l-1.056-1.059.965-.967h-7.78A3.365 3.365 0 0 1 1 10.604a3.365 3.365 0 0 1 3.36-3.368h7.22a1.87 1.87 0 0 0 1.866-1.871 1.87 1.87 0 0 0-1.867-1.872H6.37A2.74 2.74 0 0 1 3.738 5.49 2.74 2.74 0 0 1 1 2.745 2.74 2.74 0 0 1 3.738 0C4.991 0 6.045.845 6.37 1.996h5.21a3.365 3.365 0 0 1 3.36 3.369 3.365 3.365 0 0 1-3.36 3.368H4.36a1.87 1.87 0 0 0-1.866 1.872 1.87 1.87 0 0 0 1.866 1.871h7.781l-.965-.968 1.056-1.058zM2.494 2.745c0 .689.557 1.247 1.244 1.247.688 0 1.245-.558 1.245-1.247s-.557-1.248-1.245-1.248c-.687 0-1.244.559-1.244 1.248"
            />
    </svg>
  )
);
RunIcon.displayName = "RunIcon";
