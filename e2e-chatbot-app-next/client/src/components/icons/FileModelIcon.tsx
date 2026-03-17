import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface FileModelIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const FileModelIcon = forwardRef<SVGSVGElement, FileModelIconProps>(
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
              d="M2.75 1a.75.75 0 0 0-.75.75V16h1.5V2.5H8v3.75c0 .414.336.75.75.75h3.75v3H14V6.25a.75.75 0 0 0-.22-.53l-4.5-4.5A.75.75 0 0 0 8.75 1zm8.69 4.5L9.5 3.56V5.5z"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M11.75 11.5a2.25 2.25 0 1 1-2.03 1.28l-.5-.5a2.25 2.25 0 1 1 1.06-1.06l.5.5c.294-.141.623-.22.97-.22m.75 2.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0M8.25 9.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5"
              clipRule="evenodd"
            />
    </svg>
  )
);
FileModelIcon.displayName = "FileModelIcon";
