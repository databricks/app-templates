import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface BookmarkFillIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const BookmarkFillIcon = forwardRef<SVGSVGElement, BookmarkFillIconProps>(
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
              d="M2.75 0A.75.75 0 0 0 2 .75v14.5a.75.75 0 0 0 1.28.53L8 11.06l4.72 4.72a.75.75 0 0 0 1.28-.53V.75a.75.75 0 0 0-.75-.75z"
            />
    </svg>
  )
);
BookmarkFillIcon.displayName = "BookmarkFillIcon";
