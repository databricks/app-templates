import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface SlidersIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const SlidersIcon = forwardRef<SVGSVGElement, SlidersIconProps>(
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
              d="M4 15v-2.354a2.751 2.751 0 0 1 0-5.292V1h1.5v6.354a2.751 2.751 0 0 1 0 5.292V15zm.75-3.75a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5M10.5 1v2.354a2.751 2.751 0 0 0 0 5.292V15H12V8.646a2.751 2.751 0 0 0 0-5.292V1zm.75 3.75a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5"
              clipRule="evenodd"
            />
    </svg>
  )
);
SlidersIcon.displayName = "SlidersIcon";
