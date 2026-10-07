import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface JoinOperatorIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const JoinOperatorIcon = forwardRef<SVGSVGElement, JoinOperatorIconProps>(
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
              d="M10.25 2.25A5.75 5.75 0 1 1 8 13.292 5.75 5.75 0 1 1 8 2.707a5.7 5.7 0 0 1 2.25-.457m0 1.5q-.298 0-.586.04a5.73 5.73 0 0 1 1.167 6.897q-.28.062-.581.063a2.7 2.7 0 0 1-1.085-.223 4.22 4.22 0 0 0 .827-2.77l-.008-.099a4 4 0 0 0-.02-.198q0-.018-.004-.036a4.2 4.2 0 0 0-.265-1.002l-.017-.046a4 4 0 0 0-.347-.663l-.031-.05a4 4 0 0 0-.29-.388l-.055-.064-.101-.112-.066-.07a4 4 0 0 0-.137-.133l-.03-.029A4.27 4.27 0 0 0 6.334 3.79l-.031-.004a4 4 0 0 0-.208-.021l-.091-.007a4.25 4.25 0 1 0 .331 8.451A5.73 5.73 0 0 1 4.5 8c0-.971.242-1.885.667-2.687a2.76 2.76 0 0 1 1.667.159 4.23 4.23 0 0 0-.827 2.77l.008.099q.006.099.02.198 0 .018.004.036.036.263.102.513l.014.05q.024.087.052.173l.03.088c.17.492.43.943.76 1.333l.024.03q.069.079.14.155l.036.038a4.23 4.23 0 0 0 2.735 1.281l.04.003.06.005.218.006a4.25 4.25 0 0 0 0-8.5"
              clipRule="evenodd"
            />
    </svg>
  )
);
JoinOperatorIcon.displayName = "JoinOperatorIcon";
