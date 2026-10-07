import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface BracketsErrorIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const BracketsErrorIcon = forwardRef<SVGSVGElement, BracketsErrorIconProps>(
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
              d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8m0 2.94-1.22-1.22-1.06 1.06L10.94 12l-1.22 1.22 1.06 1.06L12 13.06l1.22 1.22 1.06-1.06L13.06 12l1.22-1.22-1.06-1.06z"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              d="M6 2.5h-.5c-.69 0-1.25.56-1.25 1.25v1c0 .931-.464 1.753-1.173 2.25A2.74 2.74 0 0 1 4.25 9.25v1c0 .69.56 1.25 1.25 1.25H6V13h-.5a2.75 2.75 0 0 1-2.75-2.75v-1C2.75 8.56 2.19 8 1.5 8H1V6h.5c.69 0 1.25-.56 1.25-1.25v-1A2.75 2.75 0 0 1 5.5 1H6zM10.5 1a2.75 2.75 0 0 1 2.75 2.75v1c0 .69.56 1.25 1.25 1.25h.5v1.691a5.2 5.2 0 0 0-2.339-.898 2.74 2.74 0 0 1-.911-2.043v-1c0-.69-.56-1.25-1.25-1.25H10V1z"
            />
    </svg>
  )
);
BracketsErrorIcon.displayName = "BracketsErrorIcon";
