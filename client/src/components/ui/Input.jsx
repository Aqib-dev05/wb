import { forwardRef, useId } from 'react';
import { cn } from '../../utils/format.js';

export const Input = forwardRef(function Input({ label, error, hint, className, ...props }, ref) {
  const id = useId();
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        className={cn(
          'h-10 w-full rounded-lg border bg-surface px-3 text-sm text-ink placeholder:text-muted/70 transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25',
          error ? 'border-danger' : 'border-line'
        )}
        {...props}
      />
      {(error || hint) && (
        <p id={`${id}-msg`} className={cn('mt-1.5 text-xs', error ? 'text-danger' : 'text-muted')}>
          {error || hint}
        </p>
      )}
    </div>
  );
});
