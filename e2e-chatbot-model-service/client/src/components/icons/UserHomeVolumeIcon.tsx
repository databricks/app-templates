import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface UserHomeVolumeIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const UserHomeVolumeIcon = forwardRef<SVGSVGElement, UserHomeVolumeIconProps>(
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
              d="M.75 2a.75.75 0 0 0-.75.75v10.5c0 .414.336.75.75.75H6v-1.5H1.5v-9h3.172c.331 0 .649.132.883.366L6.97 5.28c.14.141.331.22.53.22h7V8H16V4.75a.75.75 0 0 0-.75-.75H7.81L6.617 2.805A2.75 2.75 0 0 0 4.672 2z"
            />
            <path
              fill="currentColor"
              d="M11.75 8.5a2.501 2.501 0 0 1 1.594 4.426 4.76 4.76 0 0 1 1.969 1.332.75.75 0 0 1-1.126.993 3.24 3.24 0 0 0-2.437-1.1c-.97 0-1.84.424-2.438 1.1a.75.75 0 0 1-1.125-.993 4.76 4.76 0 0 1 1.968-1.332A2.5 2.5 0 0 1 11.75 8.5m0 1.501a1 1 0 1 0 0 2 1 1 0 0 0 0-2"
            />
    </svg>
  )
);
UserHomeVolumeIcon.displayName = "UserHomeVolumeIcon";
