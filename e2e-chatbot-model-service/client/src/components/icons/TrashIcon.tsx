import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface TrashIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const TrashIcon = forwardRef<SVGSVGElement, TrashIconProps>(
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
              d="M6 0a.75.75 0 0 0-.712.513L4.46 3H1v1.5h1.077l1.177 10.831A.75.75 0 0 0 4 16h8a.75.75 0 0 0 .746-.669L13.923 4.5H15V3h-3.46L10.713.513A.75.75 0 0 0 10 0zm3.96 3-.5-1.5H6.54L6.04 3zM3.585 4.5l1.087 10h6.654l1.087-10z"
              clipRule="evenodd"
            />
    </svg>
  )
);
TrashIcon.displayName = "TrashIcon";
