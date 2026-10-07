import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface DatabaseClockIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const DatabaseClockIcon = forwardRef<SVGSVGElement, DatabaseClockIconProps>(
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
              d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8m-.75 4c0 .199.08.39.22.53l1.5 1.5 1.06-1.06-1.28-1.28V9.5h-1.5z"
              clipRule="evenodd"
            />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M8 1c1.79 0 3.442.26 4.674.703.613.22 1.161.501 1.571.85.407.346.755.832.755 1.447v3.39a5.5 5.5 0 0 0-1.5-.682v-.77a7 7 0 0 1-.826.359C11.442 6.74 9.789 7 8 7s-3.442-.26-4.674-.703a7 7 0 0 1-.826-.36V8c0 .007.002.113.228.305.222.19.589.394 1.107.58.843.304 1.982.52 3.28.589a5.5 5.5 0 0 0-.513 1.47c-1.244-.098-2.373-.322-3.276-.647a7 7 0 0 1-.826-.36V12c0 .007.002.113.228.305.222.19.589.394 1.107.58.75.27 1.735.471 2.857.561.151.554.387 1.072.692 1.542-1.55-.052-2.969-.299-4.058-.691-.612-.22-1.161-.501-1.571-.85C1.348 13.101 1 12.615 1 12V4c0-.615.348-1.101.755-1.447.41-.349.959-.63 1.571-.85C4.558 1.26 6.211 1 8 1m0 1.5c-1.662 0-3.135.244-4.165.614-.518.187-.885.392-1.107.581-.226.192-.228.298-.228.305s.002.113.228.305c.222.19.589.394 1.107.58C4.865 5.258 6.338 5.5 8 5.5s3.135-.244 4.165-.614c.518-.187.885-.392 1.108-.581.225-.192.227-.298.227-.305s-.002-.113-.227-.305c-.223-.19-.59-.394-1.108-.58C11.135 2.742 9.662 2.5 8 2.5"
              clipRule="evenodd"
            />
    </svg>
  )
);
DatabaseClockIcon.displayName = "DatabaseClockIcon";
