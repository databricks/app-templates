import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface SpeechBubblePlusIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const SpeechBubblePlusIcon = forwardRef<SVGSVGElement, SpeechBubblePlusIconProps>(
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
      <path fill="currentColor" d="M7.25 9.5V7.75H5.5v-1.5h1.75V4.5h1.5v1.75h1.75v1.5H8.75V9.5z" />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M6 1a6 6 0 0 0-6 6v.25a5.75 5.75 0 0 0 5 5.701v2.299a.75.75 0 0 0 1.28.53L9.06 13H10a6 6 0 0 0 0-12zM1.5 7A4.5 4.5 0 0 1 6 2.5h4a4.5 4.5 0 1 1 0 9H8.75a.75.75 0 0 0-.53.22L6.5 13.44v-1.19a.75.75 0 0 0-.75-.75A4.25 4.25 0 0 1 1.5 7.25z"
              clipRule="evenodd"
            />
    </svg>
  )
);
SpeechBubblePlusIcon.displayName = "SpeechBubblePlusIcon";
