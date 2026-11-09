import { cn } from '@/lib/utils';

function Shimmer({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      style={{
        backgroundImage:
          'linear-gradient(90deg, var(--shimmer-text-gradient-low) 0%, var(--shimmer-text-gradient-high) 35%, var(--shimmer-text-gradient-low) 50%, var(--shimmer-text-gradient-low) 65%, var(--shimmer-text-gradient-low) 100%)',
        backgroundSize: '200% 100%',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
      }}
      className={cn('animate-shimmer-text text-transparent', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export { Shimmer };
