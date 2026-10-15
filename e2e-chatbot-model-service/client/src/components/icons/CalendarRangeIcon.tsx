import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CalendarRangeIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CalendarRangeIcon = forwardRef<SVGSVGElement, CalendarRangeIconProps>(
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
      <g fill="currentColor" clipPath="url(#CalendarRangeIcon_svg__a)">
              <path
                fillRule="evenodd"
                d="M6 2h4V0h1.5v2h2.75a.75.75 0 0 1 .75.75V8.5h-1.5V7h-11v6.5H8V15H1.75a.75.75 0 0 1-.75-.75V2.75A.75.75 0 0 1 1.75 2H4.5V0H6zM2.5 5.5h11v-2h-11z"
                clipRule="evenodd"
              />
              <path d="M10.47 9.47 7.94 12l2.53 2.53 1.06-1.06-.72-.72h2.38l-.72.72 1.06 1.06L16.06 12l-2.53-2.53-1.06 1.06.72.72h-2.38l.72-.72z" />
            </g>
            <defs>
              <clipPath>
                <path fill="#fff" d="M0 0h16v16H0z" />
              </clipPath>
            </defs>
    </svg>
  )
);
CalendarRangeIcon.displayName = "CalendarRangeIcon";
