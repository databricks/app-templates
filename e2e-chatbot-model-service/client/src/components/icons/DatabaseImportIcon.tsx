import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface DatabaseImportIconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon size in pixels. Default: 16 (DuBois standard). */
  size?: number | string;
  className?: string;
  /** Accessible label. When set, icon gets role="img". */
  ariaLabel?: string;
}

export const DatabaseImportIcon = forwardRef<SVGSVGElement, DatabaseImportIconProps>(
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
      <path fill="currentColor" d="m9.72 4.22-.97.97V1h-1.5v4.19l-.97-.97-1.06 1.06L8 8.06l2.78-2.78z" />
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M10.5 1.18c.809.12 1.546.297 2.174.523.613.22 1.161.501 1.571.85.407.346.755.832.755 1.447v8c0 .615-.348 1.101-.755 1.447-.41.349-.958.63-1.571.85C11.442 14.74 9.789 15 8 15s-3.442-.26-4.674-.703c-.612-.22-1.161-.501-1.571-.85C1.348 13.101 1 12.615 1 12V4c0-.615.348-1.101.755-1.447.41-.349.959-.63 1.571-.85A11.5 11.5 0 0 1 5.5 1.18V2.7a9.7 9.7 0 0 0-1.665.414c-.518.187-.885.392-1.107.581-.226.192-.228.298-.228.305s.002.113.228.305c.222.19.589.394 1.107.58q.081.028.165.054v1.567a9 9 0 0 1-.674-.21 7 7 0 0 1-.826-.359V8c0 .007.002.113.228.305.222.19.589.394 1.107.58C4.865 9.258 6.338 9.5 8 9.5s3.135-.243 4.165-.614c.518-.187.885-.392 1.108-.581.225-.192.227-.298.227-.305V5.938a7 7 0 0 1-.826.359 9 9 0 0 1-.674.209V4.939q.084-.026.165-.053c.518-.187.885-.392 1.108-.581.225-.192.227-.298.227-.305s-.002-.113-.227-.305c-.223-.19-.59-.394-1.108-.58a9.7 9.7 0 0 0-1.665-.416zm3 8.757a7 7 0 0 1-.826.36C11.442 10.74 9.789 11 8 11s-3.442-.26-4.674-.703a7 7 0 0 1-.826-.36V12c0 .007.002.113.228.305.222.19.589.394 1.107.58 1.03.372 2.503.615 4.165.615s3.135-.243 4.165-.614c.518-.187.885-.392 1.108-.581.225-.192.227-.298.227-.305z"
              clipRule="evenodd"
            />
    </svg>
  )
);
DatabaseImportIcon.displayName = "DatabaseImportIcon";
