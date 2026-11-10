import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface SpeechBubbleStarIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const SpeechBubbleStarIcon = forwardRef<SVGSVGElement, SpeechBubbleStarIconProps>(
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
              d="M8 3.5a.5.5 0 0 1 .476.345l.56 1.728h1.817a.5.5 0 0 1 .294.904l-1.47 1.068.562 1.728a.5.5 0 0 1-.77.559L8 8.764 6.53 9.832a.5.5 0 0 1-.769-.56l.561-1.727-1.47-1.068a.5.5 0 0 1 .295-.904h1.816l.561-1.728A.5.5 0 0 1 8 3.5"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M6 1a6 6 0 1 0 0 12v2.25a.75.75 0 0 0 1.28.53L10.061 13A6 6 0 0 0 10 1zM1.5 7A4.5 4.5 0 0 1 6 2.5h4a4.5 4.5 0 1 1 0 9h-.25a.75.75 0 0 0-.53.22L7.5 13.44v-1.19a.75.75 0 0 0-.75-.75H6A4.5 4.5 0 0 1 1.5 7"
              clipRule="evenodd"
            />
    </svg>
  )
);
SpeechBubbleStarIcon.displayName = "SpeechBubbleStarIcon";
