import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CatalogIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const CatalogIcon = forwardRef<SVGSVGElement, CatalogIconProps>(
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
              d="M14 .75a.75.75 0 0 0-.75-.75H4.5A2.5 2.5 0 0 0 2 2.5v10.75A2.75 2.75 0 0 0 4.75 16h8.5a.75.75 0 0 0 .75-.75zM3.5 4.792v8.458c0 .69.56 1.25 1.25 1.25h7.75V5h-8c-.356 0-.694-.074-1-.208m9-1.292v-2h-8a1 1 0 0 0 0 2z"
              clipRule="evenodd"
            />
    </svg>
  )
);
CatalogIcon.displayName = "CatalogIcon";
