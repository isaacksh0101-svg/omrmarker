import type { HTMLAttributes } from 'react';

export function Card({ children, className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-[1.75rem] border border-blue-100/80 bg-white/95 p-6 shadow-[0_10px_32px_rgba(27,82,160,0.07),0_1px_2px_rgba(27,82,160,0.05)] backdrop-blur-sm ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
