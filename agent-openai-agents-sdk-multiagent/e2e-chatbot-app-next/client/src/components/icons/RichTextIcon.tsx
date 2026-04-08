import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface RichTextIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const RichTextIcon = forwardRef<SVGSVGElement, RichTextIconProps>(
  ({ size = 16, className, ariaLabel, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden={!ariaLabel}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      {...props}
    >
      <path
              fill="currentColor"
              d="M16 16H2v-1.5h14zM16 12.75H2v-1.5h14zM9 3.5H6.25v6.25h-1.5V3.5H2V2h7zM16 9.75h-5.5v-1.5H16zM16 6.75h-5.5v-1.5H16zM16 3.5h-5.5V2H16z"
            />
    </svg>
  )
);
RichTextIcon.displayName = "RichTextIcon";
