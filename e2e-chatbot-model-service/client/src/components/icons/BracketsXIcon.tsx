import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface BracketsXIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const BracketsXIcon = forwardRef<SVGSVGElement, BracketsXIconProps>(
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
      <g fill="currentColor" clipPath="url(#BracketsXIcon_svg__a)">
              <path d="M1.75 4.75A2.75 2.75 0 0 1 4.5 2H5v1.5h-.5c-.69 0-1.25.56-1.25 1.25v1c0 .93-.462 1.752-1.168 2.25a2.75 2.75 0 0 1 1.168 2.25v1c0 .69.56 1.25 1.25 1.25H5V14h-.5a2.75 2.75 0 0 1-2.75-2.75v-1C1.75 9.56 1.19 9 .5 9H0V7h.5c.69 0 1.25-.56 1.25-1.25zM11.5 2a2.75 2.75 0 0 1 2.75 2.75v1c0 .69.56 1.25 1.25 1.25h.5v2h-.5c-.69 0-1.25.56-1.25 1.25v1A2.75 2.75 0 0 1 11.5 14H11v-1.5h.5c.69 0 1.25-.56 1.25-1.25v-1c0-.93.462-1.752 1.168-2.25a2.75 2.75 0 0 1-1.168-2.25v-1c0-.69-.56-1.25-1.25-1.25H11V2z" />
              <path d="M4.97 6.03 6.94 8 4.97 9.97l1.06 1.06L8 9.06l1.97 1.97 1.06-1.06L9.06 8l1.97-1.97-1.06-1.06L8 6.94 6.03 4.97z" />
            </g>
            <defs>
              <clipPath>
                <path fill="#fff" d="M0 0h16v16H0z" />
              </clipPath>
            </defs>
    </svg>
  )
);
BracketsXIcon.displayName = "BracketsXIcon";
