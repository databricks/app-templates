import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ShortcutIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ShortcutIcon = forwardRef<SVGSVGElement, ShortcutIconProps>(
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
              d="M14.25 14H9v-1.5h4.5v-10h-10V6H2V1.75A.75.75 0 0 1 2.75 1h11.5a.75.75 0 0 1 .75.75v11.5a.75.75 0 0 1-.75.75"
            />
            <path fill="currentColor" d="M2 8h5v5H5.5v-2.872a2.251 2.251 0 0 0 .75 4.372V16A3.75 3.75 0 0 1 3.7 9.5H2z" />
    </svg>
  )
);
ShortcutIcon.displayName = "ShortcutIcon";
