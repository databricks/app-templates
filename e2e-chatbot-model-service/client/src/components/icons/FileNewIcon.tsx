import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface FileNewIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const FileNewIcon = forwardRef<SVGSVGElement, FileNewIconProps>(
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
              d="M2 .75A.75.75 0 0 1 2.75 0h6a.75.75 0 0 1 .53.22l4.5 4.5c.141.14.22.331.22.53V7.5h-1.5V6H8.75A.75.75 0 0 1 8 5.25V1.5H3.5v12h4V15H2.75a.75.75 0 0 1-.75-.75zm7.5 1.81 1.94 1.94H9.5z"
              clipRule="evenodd"
            />
            <path fill="currentColor" d="M11.25 15v-2.25H9v-1.5h2.25V9h1.5v2.25H15v1.5h-2.25V15z" />
    </svg>
  )
);
FileNewIcon.displayName = "FileNewIcon";
