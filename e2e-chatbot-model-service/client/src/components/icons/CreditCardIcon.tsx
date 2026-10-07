import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CreditCardIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CreditCardIcon = forwardRef<SVGSVGElement, CreditCardIconProps>(
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
      <path fill="currentColor" d="M13 9H9v1.5h4z" />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M1.75 2A1.75 1.75 0 0 0 0 3.75v8.5C0 13.216.784 14 1.75 14h12.5A1.75 1.75 0 0 0 16 12.25v-8.5A1.75 1.75 0 0 0 14.25 2zM1.5 3.75a.25.25 0 0 1 .25-.25h12.5a.25.25 0 0 1 .25.25V5.5h-13zM1.5 7h13v5.25a.25.25 0 0 1-.25.25H1.75a.25.25 0 0 1-.25-.25z"
              clipRule="evenodd"
            />
    </svg>
  )
);
CreditCardIcon.displayName = "CreditCardIcon";
