import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CloudUploadIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CloudUploadIcon = forwardRef<SVGSVGElement, CloudUploadIconProps>(
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
              d="M8 2a4.75 4.75 0 0 0-4.606 3.586 4.251 4.251 0 0 0 .427 8.393A.8.8 0 0 0 4 14v-1.511a2.75 2.75 0 0 1 .077-5.484.75.75 0 0 0 .697-.657 3.25 3.25 0 0 1 6.476.402v.5c0 .414.336.75.75.75h.25a2.25 2.25 0 1 1-.188 4.492L12 12.49V14l.077-.004q.086.004.173.004a3.75 3.75 0 0 0 .495-7.468A4.75 4.75 0 0 0 8 2"
            />
            <path fill="currentColor" d="m8.75 8.81 2.22 2.22 1.06-1.06L8 5.94 3.97 9.97l1.06 1.06 2.22-2.22V14h1.5z" />
    </svg>
  )
);
CloudUploadIcon.displayName = "CloudUploadIcon";
