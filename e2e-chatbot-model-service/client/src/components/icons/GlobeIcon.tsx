import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface GlobeIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const GlobeIcon = forwardRef<SVGSVGElement, GlobeIconProps>(
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
      <g clipPath="url(#GlobeIcon_svg__a)">
              <path
                fill="currentColor"
                fillRule="evenodd"
                d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8m5.354-5.393q.132-.347.287-.666A6.51 6.51 0 0 0 1.543 7.25h2.971c.067-1.777.368-3.399.84-4.643m.661 4.643c.066-1.627.344-3.062.742-4.11.23-.607.485-1.046.73-1.32.247-.274.421-.32.513-.32s.266.046.512.32.501.713.731 1.32c.398 1.048.676 2.483.742 4.11zm3.97 1.5h-3.97c.066 1.627.344 3.062.742 4.11.23.607.485 1.046.73 1.32.247.274.421.32.513.32s.266-.046.512-.32.501-.713.731-1.32c.398-1.048.676-2.483.742-4.11m1.501-1.5c-.067-1.777-.368-3.399-.84-4.643a8 8 0 0 0-.287-.666 6.51 6.51 0 0 1 4.098 5.309zm2.971 1.5h-2.971c-.067 1.777-.368 3.399-.84 4.643a8 8 0 0 1-.287.666 6.51 6.51 0 0 0 4.098-5.309m-9.943 0H1.543a6.51 6.51 0 0 0 4.098 5.309 8 8 0 0 1-.287-.666c-.472-1.244-.773-2.866-.84-4.643"
                clipRule="evenodd"
              />
            </g>
            <defs>
              <clipPath>
                <path fill="#fff" d="M0 16h16V0H0z" />
              </clipPath>
            </defs>
    </svg>
  )
);
GlobeIcon.displayName = "GlobeIcon";
