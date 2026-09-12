import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

const variantClass: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-ink disabled:bg-line disabled:text-ink-soft',
  secondary:
    'bg-accent-soft text-accent-ink hover:bg-accent hover:text-white disabled:bg-line disabled:text-ink-soft',
  danger: 'bg-danger/10 text-danger hover:bg-danger hover:text-white disabled:bg-line disabled:text-ink-soft',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={`rounded-full px-4 py-2 text-sm font-bold transition-colors duration-150 disabled:cursor-not-allowed ${variantClass[variant]} ${className}`}
      {...props}
    />
  );
}
