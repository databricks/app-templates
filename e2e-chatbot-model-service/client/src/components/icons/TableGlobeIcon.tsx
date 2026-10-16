import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface TableGlobeIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const TableGlobeIcon = forwardRef<SVGSVGElement, TableGlobeIconProps>(
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
              d="M1.75 1a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75H7v-1.5h-.5V7H15V1.75a.75.75 0 0 0-.75-.75zM5 7v6.5H2.5V7zm8.5-1.5v-3h-11v3z"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M11.625 7.25a4.375 4.375 0 1 0 0 8.75 4.375 4.375 0 0 0 0-8.75M9.952 9.287a10.5 10.5 0 0 0-.185 1.588H8.85a2.88 2.88 0 0 1 1.103-1.588m1.547-.02c-.116.41-.196.963-.23 1.608h.712c-.034-.646-.114-1.198-.23-1.608a2.5 2.5 0 0 0-.126-.353q-.06.13-.126.353m0 4.716c-.116-.41-.196-.963-.23-1.608h.712c-.034.646-.114 1.198-.23 1.608-.043.15-.086.265-.126.353a2.5 2.5 0 0 1-.126-.353m1.799-4.696c.098.475.158 1.016.185 1.588h.918a2.88 2.88 0 0 0-1.103-1.588m.185 3.088h.918a2.88 2.88 0 0 1-1.103 1.588c.098-.475.158-1.016.185-1.588m-4.634 0h.918c.027.572.087 1.113.185 1.588a2.88 2.88 0 0 1-1.103-1.588"
              clipRule="evenodd"
            />
    </svg>
  )
);
TableGlobeIcon.displayName = "TableGlobeIcon";
