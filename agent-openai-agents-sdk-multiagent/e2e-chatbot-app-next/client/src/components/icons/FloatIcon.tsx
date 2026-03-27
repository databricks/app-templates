import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface FloatIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const FloatIcon = forwardRef<SVGSVGElement, FloatIconProps>(
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
              d="M0 5.25A2.25 2.25 0 0 0 2.25 3h1.5v8.5H6V13H0v-1.5h2.25V6c-.627.471-1.406.75-2.25.75zM10 5.75A2.75 2.75 0 0 1 12.75 3h.39a2.86 2.86 0 0 1 1.57 5.252l-2.195 1.44a2.25 2.25 0 0 0-1.014 1.808H16V13h-6v-1.426a3.75 3.75 0 0 1 1.692-3.135l2.194-1.44A1.36 1.36 0 0 0 13.14 4.5h-.389c-.69 0-1.25.56-1.25 1.25V6H10zM8 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2"
            />
    </svg>
  )
);
FloatIcon.displayName = "FloatIcon";
