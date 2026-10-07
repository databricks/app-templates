import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ItalicIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ItalicIcon = forwardRef<SVGSVGElement, ItalicIconProps>(
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
              d="M9.648 4.5H12V3H6v1.5h2.102l-1.75 7H4V13h6v-1.5H7.898z"
              clipRule="evenodd"
            />
    </svg>
  )
);
ItalicIcon.displayName = "ItalicIcon";
