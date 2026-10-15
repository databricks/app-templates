import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CertifiedIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CertifiedIcon = forwardRef<SVGSVGElement, CertifiedIconProps>(
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
      <g fill="currentColor" clipPath="url(#CertifiedIcon_svg__a)">
              <path d="M14.5 8a1.5 1.5 0 0 0-.8-1.327l-1.096-.58.364-1.186c.14-.455.06-.956-.233-1.344l-.138-.16a1.5 1.5 0 0 0-1.505-.372l-1.185.365-.58-1.096a1.499 1.499 0 0 0-2.654 0l-.58 1.096-1.186-.365a1.5 1.5 0 0 0-1.344.234l-.16.138a1.5 1.5 0 0 0-.372 1.505l.365 1.185-1.096.58a1.5 1.5 0 0 0-.785 1.116L1.5 8c0 .572.32 1.072.8 1.326l1.096.581-.365 1.185a1.5 1.5 0 0 0 .372 1.505l.16.138c.388.293.89.373 1.344.233l1.186-.364.58 1.095c.254.48.755.801 1.327.801V16a3 3 0 0 1-2.652-1.599 2.998 2.998 0 0 1-3.75-3.75 2.999 2.999 0 0 1 0-5.302 3 3 0 0 1 3.75-3.751 3 3 0 0 1 5.303 0 3 3 0 0 1 3.75 3.75 2.999 2.999 0 0 1 0 5.303 2.999 2.999 0 0 1-3.75 3.75A3 3 0 0 1 8 16v-1.5c.57 0 1.07-.32 1.325-.8l.581-1.098 1.186.366a1.5 1.5 0 0 0 1.505-.371l.138-.16c.293-.388.373-.89.233-1.344l-.366-1.187 1.097-.58c.48-.254.801-.754.801-1.326" />
              <path d="M9.856 5.587 11 6.732 7.19 10.54 5 8.35l1.144-1.145 1.047 1.046z" />
            </g>
            <defs>
              <clipPath>
                <path fill="#fff" d="M0 0h16v16H0z" />
              </clipPath>
            </defs>
    </svg>
  )
);
CertifiedIcon.displayName = "CertifiedIcon";
