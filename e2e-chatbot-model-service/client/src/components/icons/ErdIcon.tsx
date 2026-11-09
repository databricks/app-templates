import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ErdIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ErdIcon = forwardRef<SVGSVGElement, ErdIconProps>(
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
              d="M10 1.75a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-.75.75h-3.062l-.692.922.004.078v3l-.004.078.691.922h3.063a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1-.75-.75v-2.833l-.875-1.167h-2.25L6 11.417v2.833a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1-.75-.75v-3a.75.75 0 0 1 .75-.75h3.063l.691-.922A1 1 0 0 1 5.5 9.5v-3q0-.039.004-.078L4.813 5.5H1.75A.75.75 0 0 1 1 4.75v-3A.75.75 0 0 1 1.75 1h3.5a.75.75 0 0 1 .75.75v2.833l.875 1.167h2.25L10 4.583zm1.5.75V4h2V2.5zm0 11V12h2v1.5zM2.5 4V2.5h2V4zm0 8v1.5h2V12zM7 8.75v-1.5h2v1.5z"
              clipRule="evenodd"
            />
    </svg>
  )
);
ErdIcon.displayName = "ErdIcon";
