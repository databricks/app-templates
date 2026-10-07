import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface TokenIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const TokenIcon = forwardRef<SVGSVGElement, TokenIconProps>(
  ({ size = 16, className, ariaLabel, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden={!ariaLabel}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      {...props}
    >
      <mask id="TokenIcon_svg__a" fill="#fff">
              <path d="M5.596 10.799a5 5 0 1 0 .082-9.621l.258.94a4.025 4.025 0 1 1-.066 7.745z" />
            </mask>
            <path
              stroke="currentColor"
              strokeWidth={2}
              d="M5.596 10.799a5 5 0 1 0 .082-9.621l.258.94a4.025 4.025 0 1 1-.066 7.745z"
              mask="url(#TokenIcon_svg__a)"
            />
            <circle cx={5} cy={6} r={4.5} stroke="currentColor" />
            <circle cx={5} cy={6} r={1.5} stroke="currentColor" />
    </svg>
  )
);
TokenIcon.displayName = "TokenIcon";
