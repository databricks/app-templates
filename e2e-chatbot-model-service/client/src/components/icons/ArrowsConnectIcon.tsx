import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ArrowsConnectIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const ArrowsConnectIcon = forwardRef<SVGSVGElement, ArrowsConnectIconProps>(
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
              d="M5 9H3.5V7.56l-.634.634a1.25 1.25 0 0 0-.366.884V15H1V9.078c0-.73.29-1.429.806-1.944l.633-.634H1V5h4zM10.78 10.22l-1.06 1.06-.97-.97V15h-1.5v-4.69l-.97.97-1.06-1.06L8 7.44zM15 6.5h-1.44l.634.634A2.75 2.75 0 0 1 15 9.078V15h-1.5V9.078c0-.331-.132-.65-.366-.884L12.5 7.56V9H11V5h4z"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M8 0a2.75 2.75 0 1 1 0 5.5A2.75 2.75 0 0 1 8 0m0 1.5A1.25 1.25 0 1 0 8 4a1.25 1.25 0 0 0 0-2.5"
              clipRule="evenodd"
            />
    </svg>
  )
);
ArrowsConnectIcon.displayName = "ArrowsConnectIcon";
