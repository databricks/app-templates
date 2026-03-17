import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface McpIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const McpIcon = forwardRef<SVGSVGElement, McpIconProps>(
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
      <g fill="currentColor" fillRule="evenodd" clipPath="url(#McpIcon_svg__a)" clipRule="evenodd">
              <path d="M10.459 1.562a1.725 1.725 0 0 0-2.407 0L1.635 7.855a.575.575 0 0 1-.925-.18.55.55 0 0 1 .123-.606L7.25.775a2.875 2.875 0 0 1 4.01 0 2.74 2.74 0 0 1 .803 2.36 2.87 2.87 0 0 1 2.406.787l.034.033a2.743 2.743 0 0 1 0 3.934L8.699 13.58a.18.18 0 0 0 0 .262l1.192 1.17a.55.55 0 0 1 0 .786.576.576 0 0 1-.802 0L7.897 14.63a1.28 1.28 0 0 1 0-1.836L13.7 7.101a1.645 1.645 0 0 0 0-2.36l-.034-.032a1.725 1.725 0 0 0-2.404-.002L6.48 9.397H6.48l-.065.065a.575.575 0 0 1-.926-.18.55.55 0 0 1 .123-.607l4.849-4.755a1.645 1.645 0 0 0-.002-2.358" />
              <path d="M9.657 3.135a.55.55 0 0 0 0-.786.575.575 0 0 0-.803 0L4.108 7.003a2.743 2.743 0 0 0 0 3.934 2.876 2.876 0 0 0 4.01 0l4.747-4.655a.55.55 0 0 0 0-.787.575.575 0 0 0-.802 0L7.317 10.15a1.725 1.725 0 0 1-2.407 0 1.647 1.647 0 0 1 0-2.36z" />
            </g>
            <defs>
              <clipPath>
                <path fill="#fff" d="M0 0h16v16H0z" />
              </clipPath>
            </defs>
    </svg>
  )
);
McpIcon.displayName = "McpIcon";
