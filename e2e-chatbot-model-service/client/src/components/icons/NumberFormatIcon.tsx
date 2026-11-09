import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface NumberFormatIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const NumberFormatIcon = forwardRef<SVGSVGElement, NumberFormatIconProps>(
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
              d="M2.738 10.5H4V12H0v-1.5h1.238V6.29a2.5 2.5 0 0 1-1 .21H0V5h.238a1 1 0 0 0 1-1h1.5zM7.75 4A2.25 2.25 0 0 1 10 6.25v.292c0 1.024-.579 1.96-1.495 2.419l-.814.407A1.25 1.25 0 0 0 7 10.486v.014h3V12H5.5v-1.514a2.75 2.75 0 0 1 1.52-2.46l.814-.407c.408-.204.666-.62.666-1.077V6.25a.75.75 0 0 0-1.5 0v.25H5.5v-.25A2.25 2.25 0 0 1 7.75 4M13.615 4A2.39 2.39 0 0 1 16 6.386c0 .627-.246 1.194-.644 1.617.399.425.644.994.644 1.622a2.375 2.375 0 1 1-4.75 0V9.5h1.5v.125a.875.875 0 1 0 .875-.875h-.622L13 8l-.004-.75h.633a.87.87 0 0 0 .871-.871.88.88 0 0 0-.879-.879.87.87 0 0 0-.871.87v.133l-1.5-.006v-.133A2.363 2.363 0 0 1 13.615 4"
            />
    </svg>
  )
);
NumberFormatIcon.displayName = "NumberFormatIcon";
