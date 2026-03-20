import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface LetterFormatIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const LetterFormatIcon = forwardRef<SVGSVGElement, LetterFormatIconProps>(
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
              d="M3.03 4a1 1 0 0 1 .976.78l.015.092L4.942 12H3.43l-.194-1.5h-1.47L1.57 12H.058l.92-7.128.016-.092A1 1 0 0 1 1.97 4zM1.958 9h1.084l-.451-3.5h-.182zM7.75 4A2.25 2.25 0 0 1 10 6.25v.25c0 .453-.136.874-.367 1.228.527.411.867 1.051.867 1.772v.25A2.25 2.25 0 0 1 8.25 12h-1.5a.75.75 0 0 1-.75-.75v-6.5A.75.75 0 0 1 6.75 4zm-.25 6.5h.75A.75.75 0 0 0 9 9.75V9.5a.75.75 0 0 0-.75-.75H7.5zm0-3.25h.25a.75.75 0 0 0 .75-.75v-.25a.75.75 0 0 0-.75-.75H7.5z"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              d="M13.75 4A2.25 2.25 0 0 1 16 6.25v.25h-1.5v-.25a.75.75 0 0 0-1.5 0v3.5a.75.75 0 0 0 1.5 0V9.5H16v.25a2.25 2.25 0 0 1-4.5 0v-3.5A2.25 2.25 0 0 1 13.75 4"
            />
    </svg>
  )
);
LetterFormatIcon.displayName = "LetterFormatIcon";
