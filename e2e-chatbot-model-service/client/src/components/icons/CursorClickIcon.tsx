import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CursorClickIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CursorClickIcon = forwardRef<SVGSVGElement, CursorClickIconProps>(
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
              d="M5.22 5.22a.75.75 0 0 1 .806-.167l9.5 3.761a.75.75 0 0 1-.077 1.421l-4.09 1.124-1.124 4.09a.75.75 0 0 1-1.42.077l-3.762-9.5a.75.75 0 0 1 .167-.806m4.164 7.668.643-2.337.032-.093a.75.75 0 0 1 .492-.43l2.337-.644-5.803-2.299z"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              d="M3.516 7.837.744 8.985.17 7.6 2.94 6.45zM3.519 4.156l-.574 1.386-2.771-1.15.573-1.385zM5.545 2.941l-1.386.575L3.012.744 4.397.17zM8.99.74 7.84 3.512l-1.385-.574L7.603.166z"
            />
    </svg>
  )
);
CursorClickIcon.displayName = "CursorClickIcon";
