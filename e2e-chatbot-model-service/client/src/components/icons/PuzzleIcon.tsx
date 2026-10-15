import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface PuzzleIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const PuzzleIcon = forwardRef<SVGSVGElement, PuzzleIconProps>(
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
              d="M7.25 11a2.75 2.75 0 0 1 2.737 2.5h1.763l.05-.005a.25.25 0 0 0 .195-.194L12 13.25v-2.566a.75.75 0 0 1 .938-.727q.163.043.312.043l.128-.007a1.25 1.25 0 1 0-.44-2.451.75.75 0 0 1-.938-.727V4.25a.25.25 0 0 0-.2-.245L11.75 4H9.185a.75.75 0 0 1-.727-.937A1.25 1.25 0 1 0 6 2.75l.01.154q.011.078.032.158A.75.75 0 0 1 5.315 4H2.75a.25.25 0 0 0-.25.25v1.763a2.749 2.749 0 0 1 0 5.473v1.764l.005.05a.25.25 0 0 0 .245.2h1.763A2.75 2.75 0 0 1 7.25 11m6.25-4.987a2.749 2.749 0 0 1 0 5.473v1.764l-.009.179a1.75 1.75 0 0 1-1.562 1.562L11.75 15H9.185a.75.75 0 0 1-.727-.937A1.25 1.25 0 1 0 6 13.75l.01.154q.011.078.032.158a.75.75 0 0 1-.727.937H2.75a1.75 1.75 0 0 1-1.741-1.571L1 13.25v-2.566a.75.75 0 0 1 .938-.727Q2.1 10 2.25 10l.128-.007a1.25 1.25 0 1 0-.44-2.451A.75.75 0 0 1 1 6.815V4.25c0-.966.784-1.75 1.75-1.75h1.763a2.749 2.749 0 0 1 5.474 0h1.763c.966 0 1.75.784 1.75 1.75z"
            />
    </svg>
  )
);
PuzzleIcon.displayName = "PuzzleIcon";
