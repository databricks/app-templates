/**
 * DbIcon — Unified icon wrapper for Lucide + DuBois icons
 *
 * Usage:
 *   import { Search, Settings } from "lucide-react"
 *   import { NotebookIcon } from "@/components/icons"
 *   import { DbIcon } from "@/components/ui/db-icon"
 *
 *   <DbIcon icon={Search} />                          // Lucide generic
 *   <DbIcon icon={NotebookIcon} />                    // DuBois specific
 *   <DbIcon icon={SparkleIcon} color="ai" size={20} /> // AI gradient fill
 *   <DbIcon icon={DangerIcon} color="danger" />        // Semantic color
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

export type IconColor = 'default' | 'muted' | 'primary' | 'danger' | 'warning' | 'success' | 'ai';

export interface DbIconProps {
  /** Lucide icon component OR DuBois SVG component */
  icon: LucideIcon | React.ComponentType<React.SVGProps<SVGSVGElement> & { size?: number | string; ariaLabel?: string }>;
  size?: number;
  color?: IconColor;
  className?: string;
  /** Accessible label. Adds role="img" when set. */
  ariaLabel?: string;
}

const colorMap: Record<Exclude<IconColor, 'ai'>, string> = {
  default:  '',
  muted:    'text-muted-foreground',
  primary:  'text-primary',
  danger:   'text-destructive',
  warning:  'text-[var(--warning)]',
  success:  'text-[var(--success)]',
};

export function DbIcon({
  icon: Icon,
  size = 16,
  color = 'default',
  className,
  ariaLabel,
}: DbIconProps) {
  if (color === 'ai') {
    return (
      <span
        className={cn('inline-flex items-center', className)}
        aria-label={ariaLabel}
        role={ariaLabel ? 'img' : undefined}
      >
        <svg width="0" height="0" className="absolute">
          <defs>
            <linearGradient id="db-ai-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="20.5%" stopColor="#4299E0" />
              <stop offset="46.91%" stopColor="#CA42E0" />
              <stop offset="79.5%" stopColor="#FF5F46" />
            </linearGradient>
          </defs>
        </svg>
        <Icon
          width={size}
          height={size}
          className="[&_path]:fill-[url(#db-ai-gradient)] [&_circle]:fill-[url(#db-ai-gradient)]"
          aria-hidden
        />
      </span>
    );
  }

  return (
    <Icon
      width={size}
      height={size}
      className={cn('shrink-0', colorMap[color], className)}
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : undefined}
      aria-hidden={!ariaLabel}
    />
  );
}
