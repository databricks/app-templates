import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface FolderCubeIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const FolderCubeIcon = forwardRef<SVGSVGElement, FolderCubeIconProps>(
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
              d="M4.672 2c.73 0 1.429.29 1.944.806L7.811 4h7.439l.077.004A.75.75 0 0 1 16 4.75v3.367l-3.057-1.41-.199-.08a2.25 2.25 0 0 0-1.254-.068l-.205.057-.077.029-.076.03-.075.032-3.25 1.5-.005.002a2 2 0 0 0-.145.073l-.12.072-.053.036a2.3 2.3 0 0 0-.476.437l-.002.002-.007.008c-.01.012-.04.049-.074.096l-.031.046-.04.058-.015.026-.023.037-.04.07-.026.049-.024.049-.023.047-.025.059-.053.137-.043.138-.045.2.005-.027-.009.041-.012.077q-.022.166-.021.31v3.5q0 .126.016.25H.75a.75.75 0 0 1-.75-.75V2.75l.004-.077A.75.75 0 0 1 .75 2z"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M11.762 8.04a.75.75 0 0 1 .553.03l3.25 1.5q.045.02.09.048l.004.003q.016.011.031.024.023.014.044.032.059.05.106.111a.75.75 0 0 1 .16.462v3.5a.75.75 0 0 1-.435.68l-3.242 1.496-.006.003-.002.002-.013.005a.8.8 0 0 1-.251.062h-.102a.8.8 0 0 1-.25-.062l-.014-.005-.01-.005-3.24-1.495A.75.75 0 0 1 8 13.75v-3.5q0-.053.007-.104l.006-.03a.8.8 0 0 1 .047-.159l.007-.019.025-.048.017-.029.01-.015.023-.035.024-.03a.8.8 0 0 1 .162-.151l.018-.012a1 1 0 0 1 .088-.049h.002l3.25-1.5zM9.5 13.27l1.75.807V12.23l-1.75-.807zm3.25-1.04v1.847l1.75-.807v-1.848zm-2.21-1.981 1.46.675 1.46-.674L12 9.575z"
              clipRule="evenodd"
            />
    </svg>
  )
);
FolderCubeIcon.displayName = "FolderCubeIcon";
