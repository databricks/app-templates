import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CustomAppIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CustomAppIcon = forwardRef<SVGSVGElement, CustomAppIconProps>(
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
              d="M1.751 4a.75.75 0 0 0-.583 1.222L2.81 7.25H.751a.75.75 0 0 0-.583 1.222l4.25 5.25a.75.75 0 0 0 .583.278h9.25a.75.75 0 0 0 .597-1.204L13.29 10.75h1.961a.75.75 0 0 0 .583-1.222l-2.237-2.764c-.364.345-.786.63-1.25.84L13.68 9.25H6.36L3.324 5.5H6.47A4.5 4.5 0 0 1 6.03 4zm3.667 6.472a.75.75 0 0 0 .583.278h5.405l1.332 1.75h-7.38L2.325 8.75H4v-.03z"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              d="M10.501 0a.875.875 0 0 0-.862.725l-.178 1.023a.875.875 0 0 1-.712.712l-1.023.178a.875.875 0 0 0 0 1.724l1.023.178a.875.875 0 0 1 .712.712l.178 1.023a.875.875 0 0 0 1.725 0l.177-1.023a.875.875 0 0 1 .712-.712l1.023-.178a.876.876 0 0 0 0-1.724l-1.023-.178a.875.875 0 0 1-.712-.712L11.364.725A.875.875 0 0 0 10.5 0"
            />
    </svg>
  )
);
CustomAppIcon.displayName = "CustomAppIcon";
