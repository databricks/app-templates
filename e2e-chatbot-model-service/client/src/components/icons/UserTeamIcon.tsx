import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface UserTeamIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const UserTeamIcon = forwardRef<SVGSVGElement, UserTeamIconProps>(
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
              d="M3.494 9.026c-.347.556-.453 1.153-.482 1.62a2.08 2.08 0 0 0-1.13.881 2.7 2.7 0 0 0-.374.973H3V14H.75a.75.75 0 0 1-.75-.75v-.75q0-.035.003-.068v-.008l.002-.013q.001-.015.005-.037l.017-.117a4.233 4.233 0 0 1 .59-1.534c.506-.795 1.4-1.554 2.877-1.697"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M8 7.5c1.782 0 2.822.841 3.383 1.723a4.2 4.2 0 0 1 .607 1.651l.005.037.001.013v.005l.001.002L12 11v2.25a.75.75 0 0 1-.75.75h-6.5a.75.75 0 0 1-.75-.75V11q0-.035.003-.068v-.008l.002-.013q.001-.015.005-.037l.017-.117a4.233 4.233 0 0 1 .59-1.534C5.178 8.34 6.218 7.5 8 7.5M8 9c-1.218 0-1.803.534-2.117 1.027a2.7 2.7 0 0 0-.383 1.017V12.5h5v-1.456l-.006-.037a2.733 2.733 0 0 0-.377-.98C9.803 9.534 9.217 9 8 9m-2.504 2.071h.001v-.003z"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              d="M12.505 9.025c1.477.143 2.372.903 2.878 1.698a4.2 4.2 0 0 1 .607 1.651l.005.037.001.013v.005l.001.002.003.069v.75a.75.75 0 0 1-.75.75H13v-1.5h1.492a2.733 2.733 0 0 0-.375-.973 2.08 2.08 0 0 0-1.13-.882c-.03-.466-.134-1.064-.482-1.62"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M2.75 3.5a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5m0 1.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5M13.25 3.5a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5m0 1.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5M8 2a2.25 2.25 0 1 1 0 4.5A2.25 2.25 0 0 1 8 2m0 1.5A.75.75 0 1 0 8 5a.75.75 0 0 0 0-1.5"
              clipRule="evenodd"
            />
    </svg>
  )
);
UserTeamIcon.displayName = "UserTeamIcon";
