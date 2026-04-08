import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface PlayMultipleIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const PlayMultipleIcon = forwardRef<SVGSVGElement, PlayMultipleIconProps>(
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
              d="M6.63 3.98a.5.5 0 0 1 .683-.182l5.4 3.117.175.118a1.5 1.5 0 0 1-.176 2.48L7.313 12.63l-.092.042a.5.5 0 0 1-.49-.849l.082-.06 5.4-3.117a.5.5 0 0 0 .058-.826l-.059-.039-5.399-3.118a.5.5 0 0 1-.183-.683m-3.517.12a.75.75 0 0 1 .75 0l6 3.464a.75.75 0 0 1 0 1.3l-6 3.464a.75.75 0 0 1-1.125-.65V4.75a.75.75 0 0 1 .375-.65"
            />
    </svg>
  )
);
PlayMultipleIcon.displayName = "PlayMultipleIcon";
