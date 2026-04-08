import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface LightningCircleFillIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const LightningCircleFillIcon = forwardRef<SVGSVGElement, LightningCircleFillIconProps>(
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
              d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0m.763 3.927a.38.38 0 0 0-.428.13l-3.326 4.35a.384.384 0 0 0 .304.616h1.664v2.687a.383.383 0 0 0 .688.233l3.326-4.35a.384.384 0 0 0-.304-.616H9.023V4.29a.38.38 0 0 0-.26-.363"
            />
    </svg>
  )
);
LightningCircleFillIcon.displayName = "LightningCircleFillIcon";
