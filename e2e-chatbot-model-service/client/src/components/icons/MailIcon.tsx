import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface MailIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const MailIcon = forwardRef<SVGSVGElement, MailIconProps>(
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
              d="M.75 2a.75.75 0 0 0-.75.75v10.5c0 .414.336.75.75.75h14.5a.75.75 0 0 0 .75-.75V2.75a.75.75 0 0 0-.75-.75zm.75 2.347V12.5h13V4.347L9.081 8.604a1.75 1.75 0 0 1-2.162 0zM13.15 3.5H2.85l4.996 3.925a.25.25 0 0 0 .308 0z"
              clipRule="evenodd"
            />
    </svg>
  )
);
MailIcon.displayName = "MailIcon";
