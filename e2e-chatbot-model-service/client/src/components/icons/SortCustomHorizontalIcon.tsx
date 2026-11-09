import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface SortCustomHorizontalIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const SortCustomHorizontalIcon = forwardRef<SVGSVGElement, SortCustomHorizontalIconProps>(
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
              d="M8.75 9.137q.35.11.647.311l.872-.695.935 1.173-.874.696q.129.331.16.698l1.09.248-.334 1.463-1.09-.248a2.5 2.5 0 0 1-.447.559l.485 1.007-1.35.651-.486-1.007A3 3 0 0 1 8 14.02a2.5 2.5 0 0 1-.358-.027L7.157 15l-1.351-.65.484-1.006a2.5 2.5 0 0 1-.446-.56l-1.09.248-.333-1.462 1.088-.249q.031-.367.16-.698l-.873-.697.935-1.172.873.695q.296-.2.645-.311L7.25 8.02h1.501zM8 10.52a1 1 0 1 0 .002 2.002A1 1 0 0 0 8 10.521"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              d="m15.06 4-3.53 3.53-1.06-1.06 1.72-1.72H3.81l1.72 1.72-1.06 1.06L.94 4 4.47.47l1.06 1.06-1.72 1.72h8.38l-1.72-1.72L11.53.47z"
            />
    </svg>
  )
);
SortCustomHorizontalIcon.displayName = "SortCustomHorizontalIcon";
