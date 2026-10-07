import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CameraIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CameraIcon = forwardRef<SVGSVGElement, CameraIconProps>(
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
              d="M14.5 4.75a.25.25 0 0 0-.25-.25h-3.106a.75.75 0 0 1-.652-.378l-.855-1.496a.25.25 0 0 0-.152-.117L9.42 2.5H6.58a.25.25 0 0 0-.217.126l-.855 1.496a.75.75 0 0 1-.652.378H1.75a.25.25 0 0 0-.25.25v7.5l.005.05a.25.25 0 0 0 .245.2h12.5a.25.25 0 0 0 .245-.2l.005-.05zm-4.75 3.5a1.75 1.75 0 1 0-3.5 0 1.75 1.75 0 0 0 3.5 0m1.5 0a3.25 3.25 0 1 1-6.5 0 3.25 3.25 0 0 1 6.5 0m4.75 4-.009.179A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25v-7.5C0 3.784.784 3 1.75 3h2.67l.64-1.118A1.75 1.75 0 0 1 6.58 1h2.84c.628 0 1.208.337 1.52.882L11.58 3h2.67c.966 0 1.75.784 1.75 1.75z"
            />
    </svg>
  )
);
CameraIcon.displayName = "CameraIcon";
