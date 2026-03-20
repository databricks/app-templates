import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface SyncToFileIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const SyncToFileIcon = forwardRef<SVGSVGElement, SyncToFileIconProps>(
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
              d="M14.25 6.22a.75.75 0 0 1 .75.75v.53c0 3.175-2.574 5.53-5.75 5.53H4.06l.69.688A.751.751 0 0 1 3.69 14.78l-1.97-1.97a.75.75 0 0 1 0-1.06l1.97-1.97a.751.751 0 0 1 1.061 1.062l-.69.688h5.19c2.347 0 4.25-1.683 4.25-4.03v-.53a.75.75 0 0 1 .75-.75M11 1.22a.75.75 0 0 1 1.062 0l1.968 1.97c.293.262.293.737 0 1.06l-1.968 1.97A.751.751 0 0 1 11 5.158l.69-.688H6.5c-2.347 0-4.25 1.682-4.25 4.03v.53a.75.75 0 0 1-1.5 0V8.5c0-3.176 2.574-5.53 5.75-5.53h5.19L11 2.28a.75.75 0 0 1 0-1.061"
            />
    </svg>
  )
);
SyncToFileIcon.displayName = "SyncToFileIcon";
