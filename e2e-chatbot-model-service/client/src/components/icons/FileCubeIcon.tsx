import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface FileCubeIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const FileCubeIcon = forwardRef<SVGSVGElement, FileCubeIconProps>(
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
              d="M11.762 8.04a.75.75 0 0 1 .553.03l3.25 1.5q.045.02.09.048l.004.003q.016.011.031.024.023.014.044.032.059.05.106.111a.75.75 0 0 1 .16.462v3.5a.75.75 0 0 1-.435.68l-3.242 1.496-.006.003-.002.002-.013.005a.8.8 0 0 1-.251.062h-.102a.8.8 0 0 1-.25-.062l-.014-.005-.01-.005-3.24-1.495A.75.75 0 0 1 8 13.75v-3.5q0-.053.007-.104l.006-.03a.8.8 0 0 1 .047-.159l.007-.019.025-.048.017-.029.01-.015.023-.035.024-.03a.76.76 0 0 1 .268-.212h.002l3.25-1.5zM9.5 13.27l1.75.807V12.23l-1.75-.807zm3.25-1.04v1.847l1.75-.807v-1.848zm-2.21-1.981 1.46.675 1.46-.674L12 9.575z"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M8.75 0c.199 0 .39.08.53.22l4.5 4.5.094.114A.75.75 0 0 1 14 5.25v1.944l-1.057-.487-.199-.08a2 2 0 0 0-.244-.07V6H8.75A.75.75 0 0 1 8 5.25V1.5H3.5v12h3v.25c0 .455.138.887.38 1.25H2.75a.75.75 0 0 1-.75-.75V.75l.004-.077A.75.75 0 0 1 2.75 0zm.75 4.5h1.94L9.5 2.56z"
              clipRule="evenodd"
            />
    </svg>
  )
);
FileCubeIcon.displayName = "FileCubeIcon";
