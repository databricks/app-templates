import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ShieldOffIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ShieldOffIcon = forwardRef<SVGSVGElement, ShieldOffIconProps>(
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
              d="M13.378 11.817A5.75 5.75 0 0 0 14 9.215V1.75a.75.75 0 0 0-.75-.75H2.75a.8.8 0 0 0-.17.02L4.06 2.5h8.44v6.715c0 .507-.09 1.002-.26 1.464z"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="m1.97 2.53-1 1L2 4.56v4.655a5.75 5.75 0 0 0 2.723 4.889l2.882 1.784a.75.75 0 0 0 .79 0l2.882-1.784.162-.104 1.53 1.53 1-1zM3.5 9.215V6.06l6.852 6.851L8 14.368l-2.487-1.54A4.25 4.25 0 0 1 3.5 9.215"
              clipRule="evenodd"
            />
    </svg>
  )
);
ShieldOffIcon.displayName = "ShieldOffIcon";
