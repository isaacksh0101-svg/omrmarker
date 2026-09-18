import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';
type Size = 'md' | 'sm';

const variantClass: Record<Variant, string> = {
  primary:
    'bg-[linear-gradient(135deg,#075df5_0%,#08aee0_100%)] text-white shadow-[0_6px_16px_rgba(7,93,245,0.22)] hover:-translate-y-0.5 hover:shadow-[0_9px_22px_rgba(7,93,245,0.28)] disabled:translate-y-0 disabled:bg-none disabled:bg-line disabled:text-ink-soft disabled:shadow-none',
  secondary:
    'border border-blue-100 bg-white text-accent-ink shadow-[0_2px_8px_rgba(27,82,160,0.06)] hover:border-blue-300 hover:bg-accent-soft disabled:border-transparent disabled:bg-line disabled:text-ink-soft',
  danger: 'bg-danger/10 text-danger hover:bg-danger hover:text-white disabled:bg-line disabled:text-ink-soft',
};

const sizeClass: Record<Size, string> = {
  md: 'px-5 py-2.5 text-sm',
  sm: 'px-3 py-1.5 text-xs',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant = 'primary', size = 'md', className = '', ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={`rounded-xl font-bold transition-all duration-200 ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100 ${sizeClass[size]} ${variantClass[variant]} ${className}`}
      {...props}
    />
  );
}
