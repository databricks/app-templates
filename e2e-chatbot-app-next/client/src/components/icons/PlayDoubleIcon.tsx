import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface PlayDoubleIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const PlayDoubleIcon = forwardRef<SVGSVGElement, PlayDoubleIconProps>(
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
              d="M2.371 3.853a.75.75 0 0 1 .745-.007l6.25 3.5a.75.75 0 0 1 0 1.308l-6.25 3.5A.75.75 0 0 1 2 11.5v-7l.007-.099a.75.75 0 0 1 .364-.548"
            />
            <path
              fill="currentColor"
              d="M14.636 7.357a.75.75 0 0 1 0 1.287l-5.833 3.5-.772-1.287L12.792 8 7.864 5.044l.772-1.287z"
            />
    </svg>
  )
);
PlayDoubleIcon.displayName = "PlayDoubleIcon";
