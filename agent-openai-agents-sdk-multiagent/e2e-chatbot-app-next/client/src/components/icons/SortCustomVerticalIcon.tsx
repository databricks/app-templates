import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface SortCustomVerticalIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const SortCustomVerticalIcon = forwardRef<SVGSVGElement, SortCustomVerticalIconProps>(
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
              d="M7.53 4.47 6.47 5.53 4.75 3.81v8.38l1.72-1.72 1.06 1.06L4 15.06.47 11.53l1.06-1.06 1.72 1.72V3.81L1.53 5.53.47 4.47 4 .94z"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M12.17 5.626c.233.073.45.18.648.312l.872-.696.935 1.173-.874.696q.129.331.16.7L15 8.059l-.333 1.462-1.09-.248a2.5 2.5 0 0 1-.447.559l.485 1.007-1.35.65-.486-1.007a2.5 2.5 0 0 1-.358.029q-.183-.002-.358-.029l-.485 1.007-1.351-.65.485-1.006a2.5 2.5 0 0 1-.447-.56l-1.09.248-.333-1.462L8.93 7.81q.03-.369.159-.7l-.873-.696.935-1.173.872.696a2.5 2.5 0 0 1 .646-.312V4.511l1.502-.001zm-.75 1.385a1 1 0 1 0 .002 1.999 1 1 0 0 0-.001-2"
              clipRule="evenodd"
            />
    </svg>
  )
);
SortCustomVerticalIcon.displayName = "SortCustomVerticalIcon";
