import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

const variantClass: Record<Variant, string> = {
  primary:
    'bg-accent text-white shadow-[0_1px_2px_rgba(16,24,40,0.08)] hover:bg-accent-ink hover:shadow-[0_2px_6px_rgba(50,88,206,0.28)] disabled:bg-line disabled:text-ink-soft disabled:shadow-none',
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
      className={`rounded-full px-5 py-2.5 text-sm font-bold transition-all duration-200 ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100 ${variantClass[variant]} ${className}`}
      {...props}
    />
  );
}
