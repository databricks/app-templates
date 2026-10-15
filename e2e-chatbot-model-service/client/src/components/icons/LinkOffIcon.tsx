import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface LinkOffIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const LinkOffIcon = forwardRef<SVGSVGElement, LinkOffIconProps>(
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
              d="M14.035 11.444A4 4 0 0 0 12 4H9v1.5h3a2.5 2.5 0 0 1 .917 4.826zM14 13.53 2.47 2l-1 1 1.22 1.22A4.002 4.002 0 0 0 4 12h3v-1.5H4a2.5 2.5 0 0 1-.03-5l1.75 1.75H4v1.5h3.22L13 14.53z"
            />
            <path fill="currentColor" d="m9.841 7.25 1.5 1.5H12v-1.5z" />
    </svg>
  )
);
LinkOffIcon.displayName = "LinkOffIcon";
