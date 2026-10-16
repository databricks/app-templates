import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ListNumberIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ListNumberIcon = forwardRef<SVGSVGElement, ListNumberIconProps>(
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
              d="M4.76 8a2.24 2.24 0 0 1 .883 4.299l-1.431.612c-.273.117-.484.33-.604.589H7V15H2v-1.009c0-1.07.638-2.036 1.621-2.458l1.43-.613A.74.74 0 0 0 4.76 9.5h-.371a.89.89 0 0 0-.889.889H2C2 9.069 3.07 8 4.389 8zM14 12.75H9v-1.5h5zM5.25 5.5H7V7H2V5.5h1.75V2.595A3 3 0 0 1 2.25 3H2V1.5h.25A1.5 1.5 0 0 0 3.75 0h1.5zM14 4.75H9v-1.5h5z"
            />
    </svg>
  )
);
ListNumberIcon.displayName = "ListNumberIcon";
