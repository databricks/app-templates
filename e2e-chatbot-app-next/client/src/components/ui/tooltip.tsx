import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '@/lib/utils';

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipArrow = TooltipPrimitive.Arrow;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & { usePortal?: boolean }
>(({ className, sideOffset = 4, usePortal = true, ...props }, ref) => {
  const tooltipContent = <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      'z-50 overflow-hidden rounded-lg bg-tooltip px-2 py-1.5 text-tooltip-foreground text-base font-medium',
      className,
    )}
    {...props}
  >
    {props.children}
    <TooltipArrow className='fill-tooltip' />
  </TooltipPrimitive.Content>;

  if (usePortal) {
    return (
      <TooltipPrimitive.Portal>
        {tooltipContent}
      </TooltipPrimitive.Portal>
    );
  }

  return tooltipContent
});
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TooltipArrow };
