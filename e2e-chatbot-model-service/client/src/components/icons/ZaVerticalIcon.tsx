import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ZaVerticalIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ZaVerticalIcon = forwardRef<SVGSVGElement, ZaVerticalIconProps>(
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
              d="M7.996 8a.75.75 0 0 0-.695.468L4.65 15h1.619l.406-1h2.643l.406 1h1.619L8.69 8.468A.75.75 0 0 0 7.996 8m.713 4.5H7.284l.712-1.756zM8.664 1.5H4.996V0h5.25a.75.75 0 0 1 .58 1.225L7.33 5.5h3.667V7h-5.25a.75.75 0 0 1-.58-1.225z"
              clipRule="evenodd"
            />
    </svg>
  )
);
ZaVerticalIcon.displayName = "ZaVerticalIcon";
