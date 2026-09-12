import type { HTMLAttributes } from 'react';

export function Card({ children, className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-2xl border border-line bg-panel p-5 shadow-sm ${className}`} {...rest}>
      {children}
    </div>
  );
}
